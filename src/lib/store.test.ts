import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { CaptureStore } from "./store";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cptr-ext-test-"));
}

test("commit writes a complete bundle with decodable v1 meta", () => {
  const root = tempRoot();
  const store = new CaptureStore(root);
  const committed = store.commit({
    kind: "selection",
    primary: { name: "content.txt", data: Buffer.from("hello world") },
    source: {
      app: "com.google.Chrome",
      appName: "Google Chrome",
      url: "https://x.com",
    },
    text: { status: "done", method: "raycast" },
  });

  assert.match(committed.id, /^\d{4}-\d{2}-\d{2}\/\d{6}-[0-9a-f]{4}$/);
  assert.ok(fs.existsSync(path.join(committed.dir, "content.txt")));
  const meta = store.meta(committed.id);
  assert.equal(meta.v, 1);
  assert.equal(meta.kind, "selection");
  assert.equal(meta.sha256.length, 64);
  assert.equal(meta.text.chars, 11);
  assert.equal(meta.text.method, "raycast");
  assert.match(
    meta.created,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/,
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test("a bundle written by something else reads back unchanged", () => {
  // The format is plain files: a bundle made by another tool, or by hand,
  // is read like one of the store's own.
  const root = tempRoot();
  const dir = path.join(root, "2026-07-15", "143201-a8f3");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "content.txt"), "written by a script");
  fs.writeFileSync(
    path.join(dir, "meta.json"),
    JSON.stringify({
      created: "2026-07-15T14:32:01.412+03:00",
      id: "2026-07-15/143201-a8f3",
      kind: "clipboard",
      sha256: "a".repeat(64),
      source: { app: "com.apple.Safari", appName: "Safari" },
      tags: [],
      text: { chars: 19, method: "pasteboard", status: "done" },
      v: 1,
    }),
  );
  const store = new CaptureStore(root);
  const meta = store.meta("2026-07-15/143201-a8f3");
  assert.equal(meta.kind, "clipboard");
  assert.equal(meta.text.method, "pasteboard");
  fs.rmSync(root, { recursive: true, force: true });
});

test("same-second same-content commits get unique suffixed ids", () => {
  const root = tempRoot();
  const store = new CaptureStore(root);
  const now = new Date();
  const draft = {
    kind: "clipboard" as const,
    primary: { name: "content.txt", data: Buffer.from("dup") },
    text: { status: "done" as const, method: "pasteboard" as const },
  };
  const a = store.commit(draft, now);
  const b = store.commit(draft, now);
  const c = store.commit(draft, now);
  assert.equal(new Set([a.id, b.id, c.id]).size, 3);
  assert.equal(b.id, `${a.id}-2`);
  assert.equal(c.id, `${a.id}-3`);
  fs.rmSync(root, { recursive: true, force: true });
});

test("invalid filenames and traversal ids are rejected", () => {
  const root = tempRoot();
  const store = new CaptureStore(root);
  for (const name of ["../escape", "nested/file", "meta.json", ".", "..", ""]) {
    assert.throws(() =>
      store.commit({
        kind: "clipboard",
        primary: { name, data: Buffer.from("x") },
        text: { status: "done", method: "pasteboard" },
      }),
    );
  }
  for (const id of [
    "../outside",
    "2026-01-01/../../x",
    "2026-01-01/000000-DEAD",
    "2026-01-01/000000-dead-1",
  ]) {
    assert.throws(() => store.meta(id));
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test("no tmp staging dirs remain after commit", () => {
  const root = tempRoot();
  const store = new CaptureStore(root);
  const committed = store.commit({
    kind: "clipboard",
    primary: { name: "content.txt", data: Buffer.from("hi") },
    text: { status: "done", method: "pasteboard" },
  });
  const entries = fs.readdirSync(path.dirname(committed.dir));
  assert.ok(entries.every((e) => !e.startsWith(".tmp-")));
  fs.rmSync(root, { recursive: true, force: true });
});

test("stale deterministic staging directories do not block a commit", () => {
  const root = tempRoot();
  const store = new CaptureStore(root);
  const now = new Date(2026, 6, 16, 12, 34, 56);
  const data = Buffer.from("stale-safe");
  const hash = createHash("sha256").update(data).digest("hex");
  const dayDir = path.join(root, "2026-07-16");
  const base = `123456-${hash.slice(0, 4)}`;
  fs.mkdirSync(path.join(dayDir, `.tmp-${base}`), { recursive: true });

  const committed = store.commit(
    {
      kind: "clipboard",
      primary: { name: "content.txt", data },
      text: { status: "done", method: "pasteboard" },
    },
    now,
  );
  assert.equal(committed.id, `2026-07-16/${base}`);
  assert.ok(fs.existsSync(path.join(committed.dir, "content.txt")));
  fs.rmSync(root, { recursive: true, force: true });
});

test("concurrent processes atomically allocate unique bundle ids", async () => {
  const root = tempRoot();
  const timestamp = "2026-07-16T12:34:56.000+03:00";
  const ids = await Promise.all(
    Array.from({ length: 6 }, () => runStoreRaceWorker(root, timestamp)),
  );

  assert.equal(new Set(ids).size, ids.length);
  const dayDir = path.join(root, ids[0].split("/")[0]);
  assert.equal(
    fs.readdirSync(dayDir).filter((name) => name.startsWith(".tmp-")).length,
    0,
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test("enrichText writes content.txt and patches meta", () => {
  const root = tempRoot();
  const store = new CaptureStore(root);
  const committed = store.commit({
    kind: "webpage",
    primary: { name: "content.png", data: Buffer.from([1, 2, 3]) },
    text: { status: "pending" },
  });
  store.enrichText(committed.id, "extracted words", "dom");
  const meta = store.meta(committed.id);
  assert.equal(meta.text.status, "done");
  assert.equal(meta.text.chars, 15);
  assert.equal(
    fs.readFileSync(path.join(committed.dir, "content.txt"), "utf8"),
    "extracted words",
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test("enrichText keeps an existing content.txt unless told to overwrite", () => {
  const root = tempRoot();
  const store = new CaptureStore(root);
  const committed = store.commit({
    kind: "pdf",
    primary: { name: "content.pdf", data: Buffer.from([1, 2, 3]) },
    text: { status: "pending" },
  });
  const txt = path.join(committed.dir, "content.txt");
  store.enrichText(committed.id, "old gluedwords", "pdfkit");
  store.enrichText(committed.id, "ignored", "pdfjs");
  assert.equal(fs.readFileSync(txt, "utf8"), "old gluedwords");
  store.enrichText(committed.id, "new glued words", "pdfjs", {
    overwrite: true,
  });
  assert.equal(fs.readFileSync(txt, "utf8"), "new glued words");
  assert.deepEqual(store.meta(committed.id).text, {
    status: "done",
    chars: 15,
    method: "pdfjs",
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test("enrichText with no text records what was tried", () => {
  const root = tempRoot();
  const store = new CaptureStore(root);
  const committed = store.commit({
    kind: "region",
    primary: { name: "content.png", data: Buffer.from([1, 2, 3]) },
    text: { status: "pending" },
  });
  store.enrichText(committed.id, null, "ocr");
  assert.deepEqual(store.meta(committed.id).text, {
    status: "none",
    method: "ocr",
  });
  // A failed attempt records nothing, so it can be tried again.
  store.enrichText(committed.id, null);
  assert.deepEqual(store.meta(committed.id).text, { status: "none" });
  assert.equal(fs.existsSync(path.join(committed.dir, "content.txt")), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("addMarkdown writes content.md once and leaves meta alone", () => {
  const root = tempRoot();
  const store = new CaptureStore(root);
  const committed = store.commit({
    kind: "pdf",
    primary: { name: "content.pdf", data: Buffer.from([1, 2, 3]) },
    text: { status: "pending" },
  });
  store.addMarkdown(committed.id, "# Title\n\nBody.");
  store.addMarkdown(committed.id, "overwritten?");
  assert.equal(
    fs.readFileSync(path.join(committed.dir, "content.md"), "utf8"),
    "# Title\n\nBody.",
  );
  store.addMarkdown(committed.id, "# Better", { overwrite: true });
  assert.equal(
    fs.readFileSync(path.join(committed.dir, "content.md"), "utf8"),
    "# Better",
  );
  assert.deepEqual(fs.readdirSync(committed.dir).sort(), [
    "content.md",
    "content.pdf",
    "meta.json",
  ]);
  assert.equal(store.meta(committed.id).text.status, "pending");
  fs.rmSync(root, { recursive: true, force: true });
});

function runStoreRaceWorker(root: string, timestamp: string): Promise<string> {
  const tsx = path.resolve("node_modules/.bin/tsx");
  const worker = path.resolve("src/lib/fixtures/store-race-worker.ts");
  return new Promise((resolve, reject) => {
    const child = spawn(tsx, [worker, root, timestamp], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `worker exited ${code}`));
    });
  });
}
