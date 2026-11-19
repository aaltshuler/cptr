import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { CaptureKind, CaptureMeta } from "./meta";
import {
  BundleEntry,
  collapseGroups,
  entryTitle,
  matchSnippet,
  parseQuery,
  queryTerms,
  readBundleText,
  scanBundles,
  searchBundles,
  snippetAround,
  walkBundles,
} from "./scan";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cptr-scan-test-"));
}

function writeBundle(
  root: string,
  id: string,
  kind: CaptureKind,
  files: Record<string, string | Buffer>,
  group?: string,
): BundleEntry {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, data] of Object.entries(files))
    fs.writeFileSync(path.join(dir, name), data);
  const primary = Object.values(files)[0];
  const primaryData = Buffer.isBuffer(primary) ? primary : Buffer.from(primary);
  const meta: CaptureMeta = {
    v: 1,
    id,
    kind,
    created: "2026-07-16T12:00:00.000+03:00",
    sha256: createHash("sha256").update(primaryData).digest("hex"),
    source: {},
    text: files["content.txt"]
      ? { status: "done", chars: String(files["content.txt"]).length }
      : { status: "none" },
    tags: [],
    ...(group ? { group } : {}),
  };
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta));
  return { meta, dir };
}

test("search reads complete text while scans retain only a preview", async () => {
  const root = tempRoot();
  const content = `${"x".repeat(2_500)} needle-at-the-end`;
  writeBundle(root, "2026-07-16/120000-abcd", "selection", {
    "content.txt": content,
  });

  const entries = scanBundles(root);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].contentPreview?.includes("needle-at-the-end"), false);
  assert.equal((await searchBundles(entries, "needle-at-the-end")).length, 1);
  assert.equal(await readBundleText(entries[0]), content);
  fs.rmSync(root, { recursive: true, force: true });
});

test("scan chooses the recorded primary artifact deterministically by kind", () => {
  const root = tempRoot();
  writeBundle(root, "2026-07-16/120000-abcd", "webpage", {
    "content.md": "# Live page",
    "content.png": Buffer.from([1, 2, 3]),
    "content.txt": "searchable",
    "page.pdf": Buffer.from([4, 5, 6]),
  });

  const [entry] = scanBundles(root);
  assert.equal(path.basename(entry.primaryPath ?? ""), "content.png");
  fs.rmSync(root, { recursive: true, force: true });
});

test("scan has no implicit archive limit", () => {
  const root = tempRoot();
  for (let index = 0; index < 1_001; index++) {
    const hash = index.toString(16).padStart(4, "0");
    writeBundle(root, `2026-07-16/120000-${hash}`, "selection", {
      "content.txt": String(index),
    });
  }
  assert.equal(scanBundles(root).length, 1_001);
  assert.equal(scanBundles(root, 1_000).length, 1_000);
  fs.rmSync(root, { recursive: true, force: true });
});

test("group collapse keeps the deliberate selection instead of newer fan-out", () => {
  const selection = writeBundle(
    tempRoot(),
    "2026-07-16/120000-abcd",
    "selection",
    { "content.txt": "selected" },
    "g-1",
  );
  const webpage = {
    ...selection,
    meta: {
      ...selection.meta,
      id: "2026-07-16/120001-dcba",
      kind: "webpage" as const,
    },
  };
  const ungrouped = {
    ...selection,
    meta: { ...selection.meta, id: "2026-07-16/120002-eeee", group: undefined },
  };

  const collapsed = collapseGroups([webpage, ungrouped, selection]);
  assert.deepEqual(
    collapsed.map((entry) => entry.meta.id),
    [selection.meta.id, ungrouped.meta.id],
  );
  fs.rmSync(path.dirname(path.dirname(selection.dir)), {
    recursive: true,
    force: true,
  });
});

test("preview never ends with a broken multibyte character", () => {
  const root = tempRoot();
  // 1,999 ASCII bytes, then a 4-byte emoji straddling the 2,000-byte cap.
  writeBundle(root, "2026-07-16/120000-feed", "selection", {
    "content.txt": "a".repeat(1_999) + "🚀 tail",
  });
  const [entry] = scanBundles(root);
  assert.ok(entry.contentPreview);
  assert.ok(!entry.contentPreview.includes("�"));
  fs.rmSync(root, { recursive: true, force: true });
});

test("stale staging directories are swept during scan, fresh ones kept", () => {
  const root = tempRoot();
  writeBundle(root, "2026-07-16/120000-abcd", "selection", {
    "content.txt": "keep",
  });
  const dayDir = path.join(root, "2026-07-16");
  const stale = path.join(dayDir, ".tmp-old");
  const fresh = path.join(dayDir, ".tmp-new");
  fs.mkdirSync(stale);
  fs.mkdirSync(fresh);
  const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  fs.utimesSync(stale, old, old);

  scanBundles(root);
  assert.ok(!fs.existsSync(stale));
  assert.ok(fs.existsSync(fresh));
  fs.rmSync(root, { recursive: true, force: true });
});

test("search corpus is capped per file; full copy still reads everything", async () => {
  const root = tempRoot();
  const beyondCap = "y".repeat(1_100_000) + " beyond-cap-needle";
  writeBundle(root, "2026-07-16/120000-cafe", "selection", {
    "content.txt": beyondCap,
  });
  const entries = scanBundles(root);
  assert.equal((await searchBundles(entries, "beyond-cap-needle")).length, 0);
  assert.equal(
    (await readBundleText(entries[0]))?.endsWith("beyond-cap-needle"),
    true,
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test("titles: text captures lead with their words, images with kind + app", () => {
  const entry = (
    kind: CaptureKind,
    source: CaptureMeta["source"],
    contentPreview?: string,
  ): BundleEntry => ({
    meta: {
      v: 1,
      id: "2026-07-16/120000-abcd",
      kind,
      created: "2026-07-16T12:00:00.000+03:00",
      sha256: "a".repeat(64),
      source,
      text: { status: "none" },
      tags: [],
    },
    dir: "/x",
    contentPreview,
  });

  assert.equal(
    entryTitle(
      entry("selection", { url: "https://a.com/" }, "\n  quoted line  \nmore"),
    ),
    "quoted line",
  );
  assert.equal(
    entryTitle(
      entry("webpage", { url: "https://a.com/", windowTitle: "A" }, "body"),
    ),
    "A",
  );
  assert.equal(
    entryTitle(entry("region", { appName: "Figma" })),
    "Region · Figma",
  );
  assert.equal(entryTitle(entry("screenshot", {})), "Full screen");
  // Text recognized in an image finds the capture but does not name it.
  const read = entry("region", { appName: "Figma" }, "File Edit View");
  read.meta.text = { status: "done", chars: 14, method: "ocr" };
  assert.equal(entryTitle(read), "Region · Figma");
  assert.equal(entryTitle(entry("selection", {}, "x".repeat(200))).length, 80);
});

test("a collapsed group row carries the siblings it hides", () => {
  const root = tempRoot();
  writeBundle(
    root,
    "2026-07-16/120000-aaaa",
    "selection",
    { "content.txt": "picked words" },
    "g-1",
  );
  writeBundle(
    root,
    "2026-07-16/120005-bbbb",
    "webpage",
    { "content.md": "# Page", "content.txt": "Page" },
    "g-1",
  );
  writeBundle(root, "2026-07-16/110000-cccc", "region", {
    "content.png": Buffer.from([1]),
  });

  const rows = collapseGroups(scanBundles(root));
  assert.deepEqual(
    rows.map((r) => r.meta.kind),
    ["selection", "region"],
  );
  // Deleting the selection row must take the hidden page archive with it.
  assert.deepEqual(rows[0].groupDirs, [
    path.join(root, "2026-07-16/120005-bbbb"),
  ]);
  assert.equal(rows[1].groupDirs, undefined);
  fs.rmSync(root, { recursive: true, force: true });
});

test("web pages get a markdown preview cut at a line boundary", () => {
  const root = tempRoot();
  const line = "A line of reader markdown with [a link](https://x.com/y).\n";
  writeBundle(root, "2026-07-16/120000-aaaa", "webpage", {
    "content.md": line.repeat(200),
    "content.txt": "plain",
  });
  writeBundle(root, "2026-07-16/110000-bbbb", "webpage", {
    "content.md": "# Short page",
    "content.txt": "Short page",
  });
  writeBundle(root, "2026-07-16/100000-cccc", "selection", {
    "content.txt": "no markdown here",
  });

  const [long, short, selection] = scanBundles(root);
  const preview = long.markdownPreview!;
  assert.ok(preview.length > 1_000 && preview.length < 3_000);
  // Never ends inside a line (which could be half a link).
  assert.equal(preview.endsWith("(https://x.com/y)."), true);
  assert.equal(short.markdownPreview, "# Short page");
  assert.equal(selection.markdownPreview, undefined);
  fs.rmSync(root, { recursive: true, force: true });
});

test("snippetAround shows the first hit in context, any case", () => {
  const text = `${"lead ".repeat(60)}the Quick brown fox ${"tail ".repeat(60)}`;
  const snippet = snippetAround(text, ["quick"], 30)!;
  assert.equal(snippet.match, "Quick");
  assert.equal(snippet.before.startsWith("…"), true);
  assert.equal(snippet.before.endsWith("the "), true);
  assert.equal(snippet.after.startsWith(" brown fox"), true);
  assert.equal(snippet.after.endsWith("…"), true);
  // Cut at word boundaries: no half words at either end.
  assert.match(snippet.before, /^…(lead )+the $/);
  assert.match(snippet.after, /^ brown fox( tail)+…$/);
});

test("snippetAround picks the earliest of several terms and flattens whitespace", () => {
  const snippet = snippetAround("alpha\n\nbeta   gamma", ["gamma", "beta"])!;
  assert.deepEqual(snippet, {
    before: "alpha ",
    match: "beta",
    after: " gamma",
  });
});

test("snippetAround treats terms literally and reports no hit as undefined", () => {
  assert.equal(snippetAround("costs $5 (usd)", ["$5"])?.match, "$5");
  assert.equal(snippetAround("abc", ["a.c"]), undefined);
  assert.equal(snippetAround("abc", ["zzz"]), undefined);
  assert.equal(snippetAround("abc", []), undefined);
});

test("matchSnippet finds a hit deep in the file; metadata-only matches have none", async () => {
  const root = tempRoot();
  const entry = writeBundle(root, "2026-07-16/120000-abcd", "selection", {
    "content.txt": `${"filler ".repeat(1_000)}Needle here`,
  });
  const contentPath = path.join(entry.dir, "content.txt");
  assert.equal((await matchSnippet(contentPath, "needle"))?.match, "Needle");
  assert.equal(await matchSnippet(contentPath, "selection"), undefined);
  assert.equal(
    await matchSnippet(path.join(root, "missing.txt"), "needle"),
    undefined,
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test("parseQuery separates words from kind:, app: and tag: filters", () => {
  assert.deepEqual(
    parseQuery("  Memory kind:PDF app:chrome tag:agents graph "),
    {
      terms: ["memory", "graph"],
      kinds: ["pdf"],
      apps: ["chrome"],
      tags: ["agents"],
    },
  );
  // Nothing after the colon, or an unknown key: an ordinary word.
  assert.deepEqual(parseQuery("kind: node:fs").terms, ["kind:", "node:fs"]);
  assert.deepEqual(queryTerms("kind:pdf routing"), ["routing"]);
});

test("filters narrow a search by kind, app and tag; words still match text", async () => {
  const root = tempRoot();
  const make = (
    id: string,
    kind: CaptureKind,
    text: string,
    over: Partial<CaptureMeta>,
  ) => {
    const { dir, meta } = writeBundle(root, id, kind, { "content.txt": text });
    fs.writeFileSync(
      path.join(dir, "meta.json"),
      JSON.stringify({ ...meta, ...over }),
    );
  };
  make("2026-07-16/120001-aaaa", "pdf", "routing paper", {
    source: { app: "com.google.Chrome", appName: "Google Chrome" },
    tags: ["Agents", "memory"],
  });
  make("2026-07-16/120002-bbbb", "webpage", "routing blog post", {
    source: { app: "com.apple.Safari", appName: "Safari" },
    tags: ["agents"],
  });
  make("2026-07-16/120003-cccc", "selection", "an unrelated quote", {
    source: { app: "com.apple.Notes", appName: "Notes" },
  });
  const entries = scanBundles(root);
  const ids = async (query: string) =>
    (await searchBundles(entries, query))
      .map((e) => e.meta.id.slice(-4))
      .sort();

  assert.deepEqual(await ids("kind:pdf"), ["aaaa"]);
  assert.deepEqual(await ids("kind:web"), ["bbbb"]); // a prefix is enough
  assert.deepEqual(await ids("kind:pdf kind:sel"), ["aaaa", "cccc"]);
  assert.deepEqual(await ids("app:chrome"), ["aaaa"]);
  assert.deepEqual(await ids("app:com.apple"), ["bbbb", "cccc"]);
  assert.deepEqual(await ids("tag:agents"), ["aaaa", "bbbb"]);
  assert.deepEqual(await ids("tag:agents tag:memory"), ["aaaa"]);
  assert.deepEqual(await ids("routing kind:web"), ["bbbb"]);
  assert.deepEqual(await ids("routing kind:sel"), []);
  assert.deepEqual(await ids("kind:pdf app:safari"), []);
  fs.rmSync(root, { recursive: true, force: true });
});

test("walkBundles yields every bundle with its files, newest first", () => {
  const root = tempRoot();
  writeBundle(root, "2026-07-15/090000-aaaa", "selection", {
    "content.txt": "older",
  });
  writeBundle(root, "2026-07-16/120000-bbbb", "pdf", {
    "content.pdf": "%PDF",
    "content.md": "# T",
  });
  fs.mkdirSync(path.join(root, "2026-07-16", "not-a-bundle"));
  fs.mkdirSync(path.join(root, "processed"));
  const walked = [...walkBundles(root)].map((b) => [
    b.meta.id,
    b.files.sort().join(","),
  ]);
  assert.deepEqual(walked, [
    ["2026-07-16/120000-bbbb", "content.md,content.pdf,meta.json"],
    ["2026-07-15/090000-aaaa", "content.txt,meta.json"],
  ]);
  assert.equal(scanBundles(root)[0].markdownPath?.endsWith("content.md"), true);
  assert.deepEqual([...walkBundles(path.join(root, "missing"))], []);
  fs.rmSync(root, { recursive: true, force: true });
});
