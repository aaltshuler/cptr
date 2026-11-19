// Bundle store, format v1. One folder per capture, staged in a hidden .tmp-*
// folder and renamed into place, with a meta.json sidecar. File names and
// bundle ids are validated, and every path must stay under the store root.

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  CaptureKind,
  CaptureMeta,
  GeometryInfo,
  isoWithOffset,
  SourceInfo,
  TextInfo,
} from "./meta";

export interface FileItem {
  name: string;
  data: Buffer;
}

export interface Draft {
  kind: CaptureKind;
  primary: FileItem;
  extras?: FileItem[];
  source?: SourceInfo;
  geometry?: GeometryInfo;
  text: TextInfo;
  group?: string;
}

export interface Committed {
  id: string;
  dir: string;
  meta: CaptureMeta;
}

const BUNDLE_ID_RE =
  /^\d{4}-\d{2}-\d{2}\/\d{6}-[0-9a-f]{4}(?:-(?:[2-9]|[1-9]\d+))?$/;

export class CaptureStore {
  constructor(public readonly root: string) {}

  commit(draft: Draft, now: Date = new Date()): Committed {
    const files = [draft.primary, ...(draft.extras ?? [])];
    for (const f of files) {
      if (!isValidBundleFileName(f.name))
        throw new Error(`invalid bundle file name: ${f.name}`);
    }
    const names = new Set<string>();
    for (const f of files) {
      if (names.has(f.name))
        throw new Error(`duplicate bundle file name: ${f.name}`);
      names.add(f.name);
    }

    const sha256 = createHash("sha256")
      .update(draft.primary.data)
      .digest("hex");
    const dayName = dayString(now);
    const dayDir = this.containedPath(dayName);
    fs.mkdirSync(dayDir, { recursive: true });

    const base = `${timeString(now)}-${sha256.slice(0, 4)}`;

    const text: TextInfo = { ...draft.text };
    if (text.status === "done" && text.chars === undefined) {
      text.chars = draft.primary.data.toString("utf8").length;
    }

    const metaBase: Omit<CaptureMeta, "id"> = {
      v: 1,
      kind: draft.kind,
      created: isoWithOffset(now),
      sha256,
      source: draft.source ?? {},
      ...(draft.geometry ? { geometry: draft.geometry } : {}),
      text,
      tags: [],
      ...(draft.group ? { group: draft.group } : {}),
    };

    const tmpDir = fs.mkdtempSync(
      path.join(dayDir, `.tmp-${base}-${process.pid}-`),
    );
    try {
      for (const f of files)
        fs.writeFileSync(path.join(tmpDir, f.name), f.data);
      for (let attempt = 1; attempt <= 1000; attempt++) {
        const name = attempt === 1 ? base : `${base}-${attempt}`;
        const finalDir = path.join(dayDir, name);
        if (fs.existsSync(finalDir)) continue;

        const meta: CaptureMeta = { ...metaBase, id: `${dayName}/${name}` };
        fs.writeFileSync(path.join(tmpDir, "meta.json"), encodeMeta(meta));
        try {
          fs.renameSync(tmpDir, finalDir);
          return { id: meta.id, dir: finalDir, meta };
        } catch (err) {
          // Another command can claim the same final name between existsSync
          // and renameSync. Retry with the next suffix without losing staging.
          if (isRenameCollision(err) || fs.existsSync(finalDir)) continue;
          throw err;
        }
      }
      throw new Error(
        `could not allocate a bundle name for ${dayName}/${base}`,
      );
    } catch (err) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      throw err;
    }
  }

  /** Patch meta.json with extraction results and write content.txt
   * (post-commit). An existing content.txt is kept unless `overwrite` is
   * set. With no text, `method` records what was tried, so that Reprocess
   * Captures does not try the same thing again. */
  enrichText(
    id: string,
    text: string | null,
    method?: CaptureMeta["text"]["method"],
    options: { overwrite?: boolean } = {},
  ): void {
    const dir = this.bundleDir(id);
    const meta = this.meta(id);
    if (text && text.length > 0) {
      const txtPath = path.join(dir, "content.txt");
      if (options.overwrite || !fs.existsSync(txtPath))
        atomicWrite(txtPath, text);
      meta.text = {
        status: "done",
        chars: text.length,
        ...(method ? { method } : {}),
      };
    } else {
      meta.text = { status: "none", ...(method ? { method } : {}) };
    }
    atomicWrite(path.join(dir, "meta.json"), encodeMeta(meta));
  }

  /** Add content.md to a committed bundle (post-commit, like its text). An
   * existing one is kept unless `overwrite` is set. */
  addMarkdown(
    id: string,
    markdown: string,
    options: { overwrite?: boolean } = {},
  ): void {
    const mdPath = path.join(this.bundleDir(id), "content.md");
    if (options.overwrite || !fs.existsSync(mdPath))
      atomicWrite(mdPath, markdown);
  }

  setTags(id: string, tags: string[]): void {
    const meta = this.meta(id);
    meta.tags = tags;
    atomicWrite(path.join(this.bundleDir(id), "meta.json"), encodeMeta(meta));
  }

  meta(id: string): CaptureMeta {
    const p = path.join(this.bundleDir(id), "meta.json");
    if (!fs.existsSync(p)) throw new Error(`bundle not found: ${id}`);
    return JSON.parse(fs.readFileSync(p, "utf8")) as CaptureMeta;
  }

  bundleDir(id: string): string {
    if (!BUNDLE_ID_RE.test(id)) throw new Error(`invalid bundle id: ${id}`);
    return this.containedPath(id);
  }

  /** Resolve and require containment under the store root (symlink-safe). */
  private containedPath(relative: string): string {
    const resolvedRoot = realpathOrSelf(path.resolve(this.root));
    const candidate = realpathOrSelf(path.resolve(this.root, relative));
    const prefix = resolvedRoot.endsWith(path.sep)
      ? resolvedRoot
      : resolvedRoot + path.sep;
    if (!candidate.startsWith(prefix))
      throw new Error(`path escapes store root: ${relative}`);
    return candidate;
  }
}

function realpathOrSelf(p: string): string {
  // Resolve the longest existing prefix (target may not exist yet).
  let probe = p;
  const tail: string[] = [];
  while (!fs.existsSync(probe)) {
    tail.unshift(path.basename(probe));
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  return path.join(
    fs.existsSync(probe) ? fs.realpathSync(probe) : probe,
    ...tail,
  );
}

function isValidBundleFileName(name: string): boolean {
  return (
    name.length > 0 &&
    name !== "." &&
    name !== ".." &&
    name !== "meta.json" &&
    !name.includes("/") &&
    !name.includes("\0")
  );
}

function encodeMeta(meta: CaptureMeta): string {
  // Sorted keys and pretty print: the same meta always encodes to the same
  // bytes, so rewriting it makes no noise in a diff or a sync.
  return JSON.stringify(sortKeysDeep(meta), null, 2) + "\n";
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => [k, sortKeysDeep(v)]),
    );
  }
  return value;
}

function atomicWrite(p: string, content: string): void {
  const tmp = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, p);
}

function isRenameCollision(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return code === "EEXIST" || code === "ENOTEMPTY";
}

function dayString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function timeString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
