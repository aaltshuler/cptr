import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeWebURL,
  parseTags,
  pdfAck,
  planClipboard,
  planPageFiles,
  planSelectionContext,
} from "./plan";

test("normalizeWebURL gives bare domains https:// and browser-normal form", () => {
  assert.equal(normalizeWebURL("example.com"), "https://example.com/");
  assert.equal(
    normalizeWebURL("  example.com/a b?q=1#frag "),
    "https://example.com/a%20b?q=1#frag",
  );
  assert.equal(normalizeWebURL("https://example.com"), "https://example.com/");
  assert.equal(normalizeWebURL("HTTP://Example.com/X"), "http://example.com/X");
  assert.equal(normalizeWebURL("localhost:3000/x"), "https://localhost:3000/x");
});

test("normalizeWebURL rejects what isn't a web address", () => {
  assert.throws(() => normalizeWebURL("just words"), /Not a URL/);
  assert.throws(() => normalizeWebURL("example"), /Not a URL/);
  assert.throws(() => normalizeWebURL("mailto:a@b.co"), /Not a URL/);
  assert.throws(() => normalizeWebURL("file:///etc/hosts"), /Not an http/);
  assert.throws(() => normalizeWebURL("ftp://example.com/x"), /Not an http/);
});

const context = (over: Partial<Parameters<typeof planSelectionContext>[0]>) =>
  planSelectionContext({
    tabURL: "https://example.com/",
    canReadTabs: true,
    recentlyArchived: false,
    newGroupID: () => "g-new",
    ...over,
  });

test("a selection is grouped only when its page will be archived with it", () => {
  assert.deepEqual(context({}), { group: "g-new", archivePage: true });
  // Page archived within the dedupe window: no sibling, so no group.
  assert.deepEqual(context({ recentlyArchived: true }), { archivePage: false });
  // No Browser Extension, or not in a browser: nothing to archive.
  assert.deepEqual(context({ canReadTabs: false }), { archivePage: false });
  assert.deepEqual(context({ tabURL: undefined }), { archivePage: false });
  // The setting is off: the selection is saved on its own.
  assert.deepEqual(context({ enabled: false }), { archivePage: false });
});

test("an explicit selection group is always kept", () => {
  assert.deepEqual(context({ explicitGroup: "g-given" }), {
    group: "g-given",
    archivePage: true,
  });
  assert.deepEqual(
    context({ explicitGroup: "g-given", recentlyArchived: true }),
    { group: "g-given", archivePage: false },
  );
});

test("clipboard: image files are copied in, other files kept as a reference", () => {
  const exists = () => true;
  assert.deepEqual(planClipboard({ file: "/tmp/Shot 1.PNG" }, exists), {
    type: "image",
    path: "/tmp/Shot 1.PNG",
    fileName: "content.png",
  });
  assert.deepEqual(
    planClipboard({ file: "file:///tmp/Shot%201.jpeg" }, exists),
    { type: "image", path: "/tmp/Shot 1.jpeg", fileName: "content.jpeg" },
  );
  assert.deepEqual(planClipboard({ file: "/tmp/report.pdf" }, exists), {
    type: "fileRef",
    path: "/tmp/report.pdf",
  });
  // An image path that no longer exists can only be a reference.
  assert.deepEqual(
    planClipboard({ file: "/tmp/gone.png" }, () => false),
    { type: "fileRef", path: "/tmp/gone.png" },
  );
});

test("clipboard: text wins over HTML, a lone URL is stamped, blank is empty", () => {
  const exists = () => false;
  assert.deepEqual(
    planClipboard({ text: " hello ", html: "<b>other</b>" }, exists),
    { type: "text", raw: " hello " },
  );
  assert.deepEqual(planClipboard({ html: "<p>a<br>b</p>" }, exists), {
    type: "text",
    raw: "a\nb",
  });
  assert.deepEqual(planClipboard({ text: "https://x.com/a\n" }, exists), {
    type: "text",
    raw: "https://x.com/a\n",
    url: "https://x.com/a",
  });
  assert.deepEqual(planClipboard({ text: "see https://x.com" }, exists), {
    type: "text",
    raw: "see https://x.com",
  });
  assert.deepEqual(planClipboard({ text: "  \n" }, exists), { type: "empty" });
  assert.deepEqual(planClipboard({}, exists), { type: "empty" });
});

const names = (plan: ReturnType<typeof planPageFiles>) =>
  plan.files.map((f) => f.name);
const PNG = Buffer.from([1]);
const PDF = Buffer.from([2]);

test("page from a live tab: screenshot + markdown, searchable by its text", () => {
  const plan = planPageFiles({
    live: { markdown: "# Title", text: "Title" },
    png: PNG,
  });
  assert.deepEqual(names(plan), ["content.png", "content.md"]);
  assert.equal(plan.text, "Title");
  assert.equal(plan.method, "dom");
  assert.equal(plan.textIsPrimary, false);
});

test("page from a live tab without a screenshot leads with the markdown", () => {
  const plan = planPageFiles({ live: { markdown: "# Title" } });
  assert.deepEqual(names(plan), ["content.md"]);
  // Markdown doubles as the searchable text when there's no plain text.
  assert.equal(plan.text, "# Title");
});

test("page with only plain text keeps that text as the primary file", () => {
  const plan = planPageFiles({ live: { text: "just text" } });
  assert.deepEqual(names(plan), ["content.txt"]);
  assert.equal(plan.files[0].data.toString("utf8"), "just text");
  assert.equal(plan.textIsPrimary, true);
});

test("page from a re-fetch: viewport PNG + page.pdf, text from the PDF", () => {
  const plan = planPageFiles({ png: PNG, renderedPDF: PDF, renderedText: "t" });
  assert.deepEqual(names(plan), ["content.png", "page.pdf"]);
  assert.equal(plan.text, "t");
  assert.equal(plan.method, "pdfjs");
  assert.equal(plan.textIsPrimary, false);

  // Either artifact alone still makes a bundle.
  assert.deepEqual(names(planPageFiles({ renderedPDF: PDF })), ["page.pdf"]);
  assert.deepEqual(names(planPageFiles({ png: PNG })), ["content.png"]);
});

test("page from a re-fetch without its PDF, when the setting says so", () => {
  const plan = planPageFiles({
    png: PNG,
    renderedPDF: PDF,
    renderedText: "t",
    keepPDF: false,
  });
  assert.deepEqual(names(plan), ["content.png"]);
  assert.equal(plan.text, "t");
  assert.equal(plan.method, "pdfjs");

  // No screenshot: the text is what is left, and becomes the primary file.
  const textOnly = planPageFiles({
    renderedPDF: PDF,
    renderedText: "t",
    keepPDF: false,
  });
  assert.deepEqual(names(textOnly), ["content.txt"]);
  assert.equal(textOnly.textIsPrimary, true);

  // The PDF is all the render gave: it is kept whatever the setting.
  assert.deepEqual(names(planPageFiles({ renderedPDF: PDF, keepPDF: false })), [
    "page.pdf",
  ]);
});

test("a render that produced nothing is an error, not an empty bundle", () => {
  assert.throws(() => planPageFiles({}), /produced nothing/);
});

test("pdfAck counts captures and names the files that failed", () => {
  assert.equal(pdfAck(1, []), "✓ Captured 1 PDF");
  assert.equal(pdfAck(3, []), "✓ Captured 3 PDFs");
  assert.equal(
    pdfAck(2, ["locked.pdf"]),
    "✓ Captured 2 PDFs — 1 failed (locked.pdf)",
  );
});

test("parseTags splits, cleans and de-duplicates what was typed", () => {
  assert.deepEqual(parseTags("Agents, #memory ,  long  term\nagents,,"), [
    "agents",
    "memory",
    "long term",
  ]);
  assert.deepEqual(parseTags("  "), []);
});
