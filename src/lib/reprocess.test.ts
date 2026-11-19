import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { CaptureKind, TextInfo } from "./meta";
import {
  planReprocess,
  reprocessAck,
  reprocessBundles,
  ReprocessTools,
} from "./reprocess";
import { CaptureStore, Committed } from "./store";

function tempStore(): CaptureStore {
  return new CaptureStore(
    fs.mkdtempSync(path.join(os.tmpdir(), "cptr-reprocess-test-")),
  );
}

let clock = Date.UTC(2026, 6, 16, 12, 0, 0);

/** A bundle with the given files, then its text state set as an older
 * version (or a crash) would have left it. */
function bundle(
  store: CaptureStore,
  kind: CaptureKind,
  files: Record<string, string>,
  text: TextInfo,
): Committed {
  const [[primary, data], ...extras] = Object.entries(files).filter(
    ([name]) => name !== "content.txt" || kind === "selection",
  );
  const committed = store.commit(
    {
      kind,
      primary: { name: primary, data: Buffer.from(data) },
      extras: extras.map(([name, d]) => ({ name, data: Buffer.from(d) })),
      text: { status: "pending" },
    },
    new Date((clock += 1000)),
  );
  if (kind !== "selection" && files["content.txt"] !== undefined)
    fs.writeFileSync(
      path.join(committed.dir, "content.txt"),
      files["content.txt"],
    );
  const metaPath = path.join(committed.dir, "meta.json");
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  fs.writeFileSync(metaPath, JSON.stringify({ ...meta, text }));
  return committed;
}

function fakeTools(over: Partial<ReprocessTools> = {}) {
  const calls: string[] = [];
  const tools: ReprocessTools = {
    pdfText: async (data) => {
      calls.push("pdfText");
      return `text of ${Buffer.from(data).toString()}`;
    },
    pdfMarkdown: async (data) => {
      calls.push("pdfMarkdown");
      return `# md of ${Buffer.from(data).toString()}`;
    },
    ocr: async (imagePath) => {
      calls.push(`ocr ${path.basename(imagePath)}`);
      return "words in the image";
    },
    ...over,
  };
  return { tools, calls };
}

const read = (b: Committed, name: string) =>
  fs.readFileSync(path.join(b.dir, name), "utf8");
const files = (b: Committed) => fs.readdirSync(b.dir).sort();
const missing = { scope: "missing", ocr: true } as const;

test("a PDF read by the old engine gets new text and Markdown, once", async () => {
  const store = tempStore();
  const pdf = bundle(
    store,
    "pdf",
    { "content.pdf": "PDF-A", "content.txt": "gluedwords" },
    { status: "done", chars: 10, method: "pdfkit" },
  );
  const { tools, calls } = fakeTools();

  const report = await reprocessBundles(store, { ...missing, tools });
  assert.deepEqual(calls, ["pdfText", "pdfMarkdown"]);
  assert.equal(read(pdf, "content.txt"), "text of PDF-A");
  assert.equal(read(pdf, "content.md"), "# md of PDF-A");
  assert.deepEqual(store.meta(pdf.id).text, {
    status: "done",
    chars: 13,
    method: "pdfjs",
  });
  assert.deepEqual(
    { scanned: report.scanned, pdfs: report.pdfs, failed: report.failed },
    { scanned: 1, pdfs: 1, failed: 0 },
  );

  // Up to date now: a second pass touches nothing.
  const again = await reprocessBundles(store, { ...missing, tools });
  assert.equal(calls.length, 2);
  assert.equal(again.pdfs, 0);
  fs.rmSync(store.root, { recursive: true, force: true });
});

test("a current PDF without Markdown gets only the Markdown", async () => {
  const store = tempStore();
  const pdf = bundle(
    store,
    "pdf",
    { "content.pdf": "PDF-B", "content.txt": "good text" },
    { status: "done", chars: 9, method: "pdfjs" },
  );
  const { tools, calls } = fakeTools();
  await reprocessBundles(store, { ...missing, tools });
  assert.deepEqual(calls, ["pdfMarkdown"]);
  assert.equal(read(pdf, "content.txt"), "good text");
  assert.equal(read(pdf, "content.md"), "# md of PDF-B");
  fs.rmSync(store.root, { recursive: true, force: true });
});

test("a PDF with no text layer is tried once, then left alone", async () => {
  const store = tempStore();
  const scanned = bundle(
    store,
    "pdf",
    { "content.pdf": "SCAN" },
    { status: "pending" },
  );
  const { tools, calls } = fakeTools({ pdfText: async () => undefined });
  await reprocessBundles(store, { ...missing, tools });
  assert.deepEqual(store.meta(scanned.id).text, {
    status: "none",
    method: "pdfjs",
  });
  assert.deepEqual(files(scanned), ["content.pdf", "meta.json"]);
  await reprocessBundles(store, { ...missing, tools });
  assert.deepEqual(calls, []); // no Markdown attempt either

  // "all" tries again.
  const all = fakeTools();
  await reprocessBundles(store, { scope: "all", ocr: true, tools: all.tools });
  assert.deepEqual(all.calls, ["pdfText", "pdfMarkdown"]);
  fs.rmSync(store.root, { recursive: true, force: true });
});

test("a re-fetched page gets new text and no Markdown; a live page is left", async () => {
  const store = tempStore();
  const refetched = bundle(
    store,
    "webpage",
    { "content.png": "PNG", "page.pdf": "PAGE", "content.txt": "old" },
    { status: "done", chars: 3, method: "pdfkit" },
  );
  const live = bundle(
    store,
    "webpage",
    { "content.png": "PNG", "content.md": "# Live", "content.txt": "Live" },
    { status: "done", chars: 4, method: "dom" },
  );
  const { tools, calls } = fakeTools();
  const report = await reprocessBundles(store, { ...missing, tools });
  assert.deepEqual(calls, ["pdfText"]);
  assert.equal(read(refetched, "content.txt"), "text of PAGE");
  assert.equal(store.meta(refetched.id).text.method, "pdfjs");
  assert.equal(files(refetched).includes("content.md"), false);
  assert.equal(read(live, "content.txt"), "Live");
  assert.equal(report.pages, 1);

  // Even "all" cannot redo a live page: its source is gone.
  const all = fakeTools();
  await reprocessBundles(store, { scope: "all", ocr: true, tools: all.tools });
  assert.deepEqual(all.calls, ["pdfText"]);
  fs.rmSync(store.root, { recursive: true, force: true });
});

test("images are read once; an image without text is not read again", async () => {
  const store = tempStore();
  const region = bundle(
    store,
    "region",
    { "content.png": "PNG" },
    { status: "none" },
  );
  const photo = bundle(
    store,
    "clipboard",
    { "content.jpg": "JPG" },
    { status: "none" },
  );
  const blank = bundle(
    store,
    "screenshot",
    { "content.png": "PNG" },
    { status: "none", method: "ocr" },
  );
  const pasted = bundle(
    store,
    "selection",
    { "content.txt": "typed text" },
    { status: "done", chars: 10, method: "raycast" },
  );
  const { tools, calls } = fakeTools();
  const report = await reprocessBundles(store, { ...missing, tools });
  assert.deepEqual(calls.sort(), ["ocr content.jpg", "ocr content.png"]);
  assert.equal(read(region, "content.txt"), "words in the image");
  assert.deepEqual(store.meta(photo.id).text, {
    status: "done",
    chars: 18,
    method: "ocr",
  });
  assert.deepEqual(store.meta(blank.id).text, {
    status: "none",
    method: "ocr",
  });
  assert.equal(read(pasted, "content.txt"), "typed text");
  assert.equal(report.images, 2);
  fs.rmSync(store.root, { recursive: true, force: true });
});

test("with text recognition off, images are left; pending ones are settled", async () => {
  const store = tempStore();
  const region = bundle(
    store,
    "region",
    { "content.png": "PNG" },
    { status: "none" },
  );
  const stuck = bundle(
    store,
    "screenshot",
    { "content.png": "PNG" },
    { status: "pending" },
  );
  const { tools, calls } = fakeTools();
  const report = await reprocessBundles(store, {
    scope: "missing",
    ocr: false,
    tools,
  });
  assert.deepEqual(calls, []);
  assert.deepEqual(store.meta(region.id).text, { status: "none" });
  assert.deepEqual(store.meta(stuck.id).text, { status: "none" });
  assert.equal(report.settled, 1);
  fs.rmSync(store.root, { recursive: true, force: true });
});

test("a failing extraction is counted, settles the bundle and spares the rest", async () => {
  const store = tempStore();
  const broken = bundle(
    store,
    "pdf",
    { "content.pdf": "BROKEN" },
    { status: "pending" },
  );
  const fine = bundle(
    store,
    "pdf",
    { "content.pdf": "FINE" },
    { status: "pending" },
  );
  const { tools } = fakeTools({
    pdfText: async (data) => {
      if (Buffer.from(data).toString() === "BROKEN") throw new Error("bad");
      return "fine text";
    },
  });
  const progress: string[] = [];
  const report = await reprocessBundles(store, {
    ...missing,
    tools,
    onProgress: (done, total) => progress.push(`${done}/${total}`),
  });
  assert.equal(report.failed, 1);
  assert.equal(report.pdfs, 2);
  // Settled without a method, so the next pass tries it again.
  assert.deepEqual(store.meta(broken.id).text, { status: "none" });
  assert.equal(read(fine, "content.txt"), "fine text");
  assert.deepEqual(progress, ["0/2", "1/2", "2/2"]);
  fs.rmSync(store.root, { recursive: true, force: true });
});

test("planReprocess leaves an up-to-date bundle alone", () => {
  const plan = (
    kind: CaptureKind,
    names: string[],
    text: TextInfo,
    scope: "missing" | "all" = "missing",
  ) =>
    planReprocess(
      {
        meta: {
          v: 1,
          id: "2026-07-16/120000-abcd",
          kind,
          created: "2026-07-16T12:00:00.000+03:00",
          sha256: "0".repeat(64),
          source: {},
          text,
          tags: [],
        },
        files: ["meta.json", ...names],
      },
      { scope, ocr: true },
    );
  const done = (method: TextInfo["method"]): TextInfo => ({
    status: "done",
    chars: 1,
    method,
  });
  assert.deepEqual(
    plan("pdf", ["content.pdf", "content.txt", "content.md"], done("pdfjs")),
    [],
  );
  assert.deepEqual(
    plan("region", ["content.png", "content.txt"], done("ocr")),
    [],
  );
  assert.deepEqual(plan("selection", ["content.txt"], done("raycast")), []);
  assert.deepEqual(plan("selection", ["content.txt"], { status: "pending" }), [
    "settle",
  ]);
  assert.deepEqual(
    plan("region", ["content.png", "content.txt"], done("ocr"), "all"),
    ["ocr"],
  );
});

test("reprocessAck says what was done", () => {
  const report = {
    scanned: 40,
    pdfs: 0,
    pages: 0,
    images: 0,
    settled: 0,
    failed: 0,
  };
  assert.equal(
    reprocessAck(report),
    "✓ Nothing to reprocess — 40 captures up to date",
  );
  assert.equal(
    reprocessAck({ ...report, pdfs: 12, images: 1, failed: 1 }),
    "✓ Reprocessed 13 captures — 12 PDFs, 1 image, 1 failed",
  );
  assert.equal(
    reprocessAck({ ...report, pages: 2, settled: 1 }),
    "✓ Reprocessed 3 captures — 2 pages, 1 settled",
  );
});
