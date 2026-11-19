// Bundle scanner for the view commands. Metadata and small previews are kept
// in memory; complete content is read asynchronously only for search/copy.

import * as fs from "node:fs";
import * as path from "node:path";
import { CaptureKind, CaptureMeta } from "./meta";

export interface BundleEntry {
  meta: CaptureMeta;
  dir: string;
  thumbPath?: string;
  primaryPath?: string;
  contentPath?: string;
  contentPreview?: string;
  /** content.md, when the bundle has one (web pages, PDFs). */
  markdownPath?: string;
  /** Start of content.md, cut at a line boundary. */
  markdownPreview?: string;
  /** Set by collapseGroups on a group's primary: its hidden siblings. */
  groupDirs?: string[];
}

/** A bundle as it lies on disk: its meta and the names of its files. */
export interface BundleFiles {
  meta: CaptureMeta;
  dir: string;
  files: string[];
}

const PREVIEW_CAP_BYTES = 2_000;
const MARKDOWN_PREVIEW_CAP_BYTES = 3_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const SEARCH_CONCURRENCY = 8;
const SEARCH_CACHE_MAX_BYTES = 32 * 1024 * 1024;
export const SEARCH_READ_CAP_BYTES = 1024 * 1024;

interface SearchCacheEntry {
  signature: string;
  text: string;
  bytes: number;
}

const searchTextCache = new Map<string, SearchCacheEntry>();
const pendingSearchText = new Map<string, Promise<string>>();
let searchCacheBytes = 0;

/** Every bundle under `root`, newest first. Folders that are not bundles
 * (half-written, foreign) are skipped, never an error. */
export function* walkBundles(root: string): Generator<BundleFiles> {
  if (!fs.existsSync(root)) return;

  const days = fs
    .readdirSync(root)
    .filter((d) => DAY_RE.test(d))
    .sort()
    .reverse();

  for (const day of days) {
    const dayDir = path.join(root, day);
    let allNames: string[];
    try {
      allNames = fs.readdirSync(dayDir);
    } catch {
      continue;
    }
    sweepStaleStaging(dayDir, allNames);
    const names = allNames
      .filter((n) => !n.startsWith("."))
      .sort()
      .reverse();
    for (const name of names) {
      const dir = path.join(dayDir, name);
      try {
        const meta = JSON.parse(
          fs.readFileSync(path.join(dir, "meta.json"), "utf8"),
        ) as CaptureMeta;
        yield { meta, dir, files: fs.readdirSync(dir) };
      } catch {
        continue; // half-bundle or foreign dir — skip, never crash the view
      }
    }
  }
}

export function scanBundles(root: string, limit?: number): BundleEntry[] {
  const entries: BundleEntry[] = [];
  for (const { meta, dir, files } of walkBundles(root)) {
    try {
      const contentPath = files.includes("content.txt")
        ? path.join(dir, "content.txt")
        : undefined;
      const primary = primaryFileName(meta.kind, files);
      const markdownPath = files.includes("content.md")
        ? path.join(dir, "content.md")
        : undefined;
      const markdown = markdownPath
        ? readPrefix(markdownPath, MARKDOWN_PREVIEW_CAP_BYTES)
        : undefined;
      entries.push({
        meta,
        dir,
        thumbPath: files.includes("thumb.jpg")
          ? path.join(dir, "thumb.jpg")
          : undefined,
        primaryPath: primary ? path.join(dir, primary) : undefined,
        contentPath,
        contentPreview: contentPath
          ? readPrefix(contentPath, PREVIEW_CAP_BYTES)
          : undefined,
        markdownPath,
        markdownPreview: markdown
          ? wholeLines(markdown, MARKDOWN_PREVIEW_CAP_BYTES)
          : undefined,
      });
    } catch {
      continue; // unreadable file — skip the bundle, never crash the view
    }
    if (limit !== undefined && entries.length >= limit) break;
  }
  return entries;
}

export async function searchBundles(
  entries: BundleEntry[],
  query: string,
): Promise<BundleEntry[]> {
  const parsed = parseQuery(query);
  const { terms } = parsed;
  const filtered = hasFilters(parsed);
  if (terms.length === 0 && !filtered) return entries;

  const matches = new Array<boolean>(entries.length).fill(false);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < entries.length) {
      const index = cursor++;
      const entry = entries[index];
      matches[index] =
        passesFilters(entry, parsed) &&
        (terms.length === 0 || (await entryMatches(entry, terms)));
    }
  }

  const workers = Math.min(SEARCH_CONCURRENCY, entries.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return entries.filter((_, index) => matches[index]);
}

export interface ParsedQuery {
  /** Lowercase words; every one must occur in the metadata or the text. */
  terms: string[];
  /** `kind:` values: the capture's kind must start with one of them. */
  kinds: string[];
  /** `app:` values: the app's name or bundle id must contain one of them. */
  apps: string[];
  /** `tag:` values: the capture must carry every one of them. */
  tags: string[];
}

const FILTER_RE = /^(kind|app|tag):(.+)$/;

/** A query split into words and `kind:` / `app:` / `tag:` filters. A filter
 * word with nothing after the colon is an ordinary word. */
export function parseQuery(query: string): ParsedQuery {
  const parsed: ParsedQuery = { terms: [], kinds: [], apps: [], tags: [] };
  for (const token of query.toLowerCase().split(/\s+/).filter(Boolean)) {
    const filter = FILTER_RE.exec(token);
    if (!filter) parsed.terms.push(token);
    else if (filter[1] === "kind") parsed.kinds.push(filter[2]);
    else if (filter[1] === "app") parsed.apps.push(filter[2]);
    else parsed.tags.push(filter[2]);
  }
  return parsed;
}

/** The words of a query (its filters left out), lowercase and AND-ed. */
export function queryTerms(query: string): string[] {
  return parseQuery(query).terms;
}

function hasFilters(parsed: ParsedQuery): boolean {
  return parsed.kinds.length + parsed.apps.length + parsed.tags.length > 0;
}

function passesFilters(entry: BundleEntry, parsed: ParsedQuery): boolean {
  const { kind, source, tags } = entry.meta;
  if (parsed.kinds.length > 0 && !parsed.kinds.some((k) => kind.startsWith(k)))
    return false;
  if (parsed.apps.length > 0) {
    const app = `${source.appName ?? ""}\n${source.app ?? ""}`.toLowerCase();
    if (!parsed.apps.some((a) => app.includes(a))) return false;
  }
  const own = tags.map((tag) => tag.toLowerCase());
  return parsed.tags.every((tag) => own.includes(tag));
}

export interface Snippet {
  before: string;
  match: string;
  after: string;
}

/** The text around the first place any term occurs, case-insensitively —
 * whitespace collapsed, cut at word boundaries, "…" where it was cut. */
export function snippetAround(
  text: string,
  terms: string[],
  radius = 140,
): Snippet | undefined {
  const wanted = terms.filter(Boolean);
  if (wanted.length === 0) return undefined;
  const hit = new RegExp(wanted.map(escapeRegExp).join("|"), "i").exec(text);
  if (!hit) return undefined;

  const start = Math.max(0, hit.index - radius);
  const end = Math.min(text.length, hit.index + hit[0].length + radius);
  let before = text.slice(start, hit.index);
  let after = text.slice(hit.index + hit[0].length, end);
  // Drop the word (or surrogate half) the cut landed in.
  if (start > 0)
    before = before.replace(/^\S*\s/, "").replace(/^[\uDC00-\uDFFF]/, "");
  if (end < text.length)
    after = after.replace(/\s\S*$/, "").replace(/[\uD800-\uDBFF]$/, "");
  const flat = (part: string) => part.replace(/\s+/g, " ");
  return {
    before: (start > 0 ? "…" : "") + flat(before).trimStart(),
    match: flat(hit[0]),
    after: flat(after).trimEnd() + (end < text.length ? "…" : ""),
  };
}

/** Where `query` hits in a capture's text file (the same first 1MB search
 * covers). Undefined when only its metadata matched, or on any read error. */
export async function matchSnippet(
  contentPath: string,
  query: string,
): Promise<Snippet | undefined> {
  try {
    const text = await readPrefixAsync(contentPath, SEARCH_READ_CAP_BYTES);
    return snippetAround(text, queryTerms(query));
  } catch {
    return undefined;
  }
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function readBundleText(
  entry: BundleEntry,
): Promise<string | undefined> {
  if (!entry.contentPath) return undefined;
  return fs.promises.readFile(entry.contentPath, "utf8");
}

/** Collapse a fan-out group while keeping its deliberate selection capture. */
export function collapseGroups(entries: BundleEntry[]): BundleEntry[] {
  const primaryByGroup = new Map<string, BundleEntry>();
  for (const entry of entries) {
    const group = entry.meta.group;
    if (!group) continue;
    const current = primaryByGroup.get(group);
    if (
      !current ||
      (entry.meta.kind === "selection" && current.meta.kind !== "selection")
    ) {
      primaryByGroup.set(group, entry);
    }
  }

  const emitted = new Set<string>();
  const result: BundleEntry[] = [];
  for (const entry of entries) {
    const group = entry.meta.group;
    if (!group) {
      result.push(entry);
    } else if (!emitted.has(group)) {
      emitted.add(group);
      const primary = primaryByGroup.get(group) ?? entry;
      // The row stands for the whole group, so it knows what it's hiding
      // (deleting it must not leave the siblings behind).
      const groupDirs = entries
        .filter((e) => e.meta.group === group && e !== primary)
        .map((e) => e.dir);
      result.push(groupDirs.length > 0 ? { ...primary, groupDirs } : primary);
    }
  }
  return result;
}

const KIND_LABEL: Record<CaptureKind, string> = {
  screenshot: "Full screen",
  region: "Region",
  webpage: "Web page",
  pdf: "PDF",
  clipboard: "Clipboard",
  selection: "Selection",
};

/** Row title shared by Search and Recent. Text captures lead with their own
 * words (a selection's tab URL is context, not content); the rest with page
 * title, URL or file; image-only captures with kind + app. */
export function entryTitle(entry: BundleEntry): string {
  const { kind, source, text } = entry.meta;
  // Text recognized in an image finds the capture; it does not name it.
  const words =
    text.method === "ocr"
      ? undefined
      : entry.contentPreview
          ?.split("\n")
          .find((l) => l.trim())
          ?.trim()
          .slice(0, 80);
  const textFirst = kind === "selection" || kind === "clipboard";
  const label = KIND_LABEL[kind] as string | undefined;
  return (
    (textFirst ? words : undefined) ??
    source.windowTitle ??
    source.url ??
    source.file ??
    words ??
    (label && source.appName ? `${label} · ${source.appName}` : label) ??
    entry.meta.id
  );
}

async function entryMatches(
  entry: BundleEntry,
  terms: string[],
): Promise<boolean> {
  const metadata = [
    entry.meta.kind,
    entry.meta.source.appName,
    entry.meta.source.windowTitle,
    entry.meta.source.url,
    entry.meta.source.file,
    entry.meta.id,
    entry.meta.tags.join(" "),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  if (terms.every((term) => metadata.includes(term))) return true;
  if (!entry.contentPath) return false;

  try {
    const content = await searchableContent(entry.contentPath);
    return terms.every(
      (term) => metadata.includes(term) || content.includes(term),
    );
  } catch {
    return false;
  }
}

async function searchableContent(contentPath: string): Promise<string> {
  const pending = pendingSearchText.get(contentPath);
  if (pending) return pending;

  const load = (async () => {
    const stat = await fs.promises.stat(contentPath);
    const signature = `${stat.size}:${stat.mtimeMs}`;
    const cached = searchTextCache.get(contentPath);
    if (cached?.signature === signature) {
      searchTextCache.delete(contentPath);
      searchTextCache.set(contentPath, cached);
      return cached.text;
    }
    if (cached) evictCached(contentPath, cached);

    // Search corpus is capped per file: matches beyond the first 1MB of a
    // single capture's text aren't found (copy still reads the full file).
    const text = (
      stat.size > SEARCH_READ_CAP_BYTES
        ? await readPrefixAsync(contentPath, SEARCH_READ_CAP_BYTES)
        : await fs.promises.readFile(contentPath, "utf8")
    ).toLowerCase();
    const bytes = Buffer.byteLength(text);
    if (bytes <= SEARCH_CACHE_MAX_BYTES) {
      while (
        searchCacheBytes + bytes > SEARCH_CACHE_MAX_BYTES &&
        searchTextCache.size > 0
      ) {
        const oldestPath = searchTextCache.keys().next().value as string;
        const oldest = searchTextCache.get(oldestPath);
        if (oldest) evictCached(oldestPath, oldest);
      }
      const entry = { signature, text, bytes };
      searchTextCache.set(contentPath, entry);
      searchCacheBytes += bytes;
    }
    return text;
  })().finally(() => pendingSearchText.delete(contentPath));
  pendingSearchText.set(contentPath, load);
  return load;
}

async function readPrefixAsync(
  filePath: string,
  maxBytes: number,
): Promise<string> {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

function evictCached(contentPath: string, entry: SearchCacheEntry): void {
  searchTextCache.delete(contentPath);
  searchCacheBytes -= entry.bytes;
}

function readPrefix(filePath: string, maxBytes: number): string | undefined {
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(maxBytes);
    const bytesRead = fs.readSync(fd, buffer, 0, maxBytes, 0);
    // A byte cap can split a multibyte UTF-8 character — drop the resulting
    // trailing replacement character(s) instead of showing "�" in previews.
    const text = buffer
      .subarray(0, bytesRead)
      .toString("utf8")
      .replace(/�+$/u, "");
    return text.length > 0 ? text : undefined;
  } finally {
    fs.closeSync(fd);
  }
}

/** A prefix that hit its byte cap ends mid-line (and for markdown, maybe
 * mid-link) — keep whole lines only. A shorter read is the whole file. */
function wholeLines(text: string, capBytes: number): string {
  if (Buffer.byteLength(text) < capBytes - 4) return text;
  const lastBreak = text.lastIndexOf("\n");
  return lastBreak > 0 ? text.slice(0, lastBreak) : text;
}

/** Staging dirs from crashed commits are invisible but immortal — sweep any
 * .tmp-* older than a day while we're already listing the folder. */
export const STALE_STAGING_MS = 24 * 60 * 60 * 1000;

function sweepStaleStaging(dayDir: string, names: string[]): void {
  for (const name of names) {
    if (!name.startsWith(".tmp-")) continue;
    const staging = path.join(dayDir, name);
    try {
      if (Date.now() - fs.statSync(staging).mtimeMs > STALE_STAGING_MS) {
        fs.rmSync(staging, { recursive: true, force: true });
      }
    } catch {
      // racing an in-flight commit or already gone — leave it alone
    }
  }
}

function primaryFileName(
  kind: CaptureKind,
  files: string[],
): string | undefined {
  const preferred: Record<CaptureKind, string[]> = {
    screenshot: ["content.png"],
    region: ["content.png"],
    webpage: ["content.png", "content.md", "content.txt", "page.pdf"],
    pdf: ["content.pdf"],
    selection: ["content.txt"],
    clipboard: [
      "content.png",
      "content.jpg",
      "content.jpeg",
      "content.gif",
      "content.tiff",
      "content.tif",
      "content.heic",
      "content.webp",
      "content.txt",
    ],
  };
  return (
    preferred[kind].find((name) => files.includes(name)) ??
    files.filter((f) => f.startsWith("content.")).sort()[0]
  );
}
