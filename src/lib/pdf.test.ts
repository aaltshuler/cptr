import assert from "node:assert/strict";
import { test } from "node:test";
import { pdfFilename, pdfLikeURL, readBodyCapped } from "./pdf";

test("pdfLikeURL matches .pdf paths only", () => {
  assert.equal(pdfLikeURL("https://x.com/paper.pdf"), true);
  assert.equal(pdfLikeURL("https://x.com/paper.PDF?dl=1"), true);
  assert.equal(pdfLikeURL("https://arxiv.org/pdf/2401.00001"), false);
  assert.equal(pdfLikeURL("https://x.com/page"), false);
  assert.equal(pdfLikeURL("not a url"), false);
});

test("pdfFilename prefers content-disposition, decodes and trims", () => {
  assert.equal(
    pdfFilename("https://x.com/dl", 'attachment; filename="my paper.pdf"'),
    "my paper.pdf",
  );
  assert.equal(
    pdfFilename(
      "https://x.com/dl",
      "attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf",
    ),
    "résumé.pdf",
  );
});

test("pdfFilename falls back to URL basename, adding .pdf when missing", () => {
  assert.equal(pdfFilename("https://x.com/a/paper.pdf?x=1"), "paper.pdf");
  assert.equal(
    pdfFilename("https://arxiv.org/pdf/2401.00001"),
    "2401.00001.pdf",
  );
  assert.equal(pdfFilename("https://x.com/"), "document.pdf");
});

test("pdfFilename keeps a literal % instead of failing the capture", () => {
  assert.equal(
    pdfFilename("https://x.com/dl", 'attachment; filename="100% final.pdf"'),
    "100% final.pdf",
  );
  assert.equal(
    pdfFilename("https://x.com/dl", "attachment; filename*=UTF-8''bad%ZZ.pdf"),
    "bad%ZZ.pdf",
  );
});

test("readBodyCapped returns bodies within the cap", async () => {
  const body = await readBodyCapped(new Response("%PDF-1.7 tiny"), 1024);
  assert.equal(body.toString("latin1"), "%PDF-1.7 tiny");
});

test("readBodyCapped refuses a body that declares itself too large", async () => {
  const res = new Response("x", { headers: { "content-length": "5000" } });
  await assert.rejects(readBodyCapped(res, 1024), /larger than/);
});

test("readBodyCapped stops a stream that outgrows the cap", async () => {
  let pulled = 0;
  const endless = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled++;
      controller.enqueue(new Uint8Array(400));
    },
  });
  // No content-length at all — the cap has to hold while streaming.
  await assert.rejects(
    readBodyCapped(new Response(endless), 1024),
    /larger than/,
  );
  assert.ok(pulled < 10, `kept reading after the cap (${pulled} chunks)`);
});
