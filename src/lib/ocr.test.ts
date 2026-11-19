import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { OCR_IMAGE_RE, recognizeText } from "./ocr";

/** One page with two lines of large Helvetica, as a PDF sips can rasterize. */
function textPDF(lines: string[]): Buffer {
  const stream = lines
    .map((line, i) => `BT /F1 36 Tf 40 ${300 - i * 60} Td (${line}) Tj ET`)
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 400] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

test("the image formats a capture can hold are the ones text is read from", () => {
  for (const name of ["content.png", "content.JPG", "content.jpeg", "x.heic"])
    assert.ok(OCR_IMAGE_RE.test(name), name);
  for (const name of ["content.pdf", "content.txt", "content.md", "png"])
    assert.ok(!OCR_IMAGE_RE.test(name), name);
});

// Drives macOS's Vision framework through osascript, so it stays out of CI,
// like the other tests that run real system tools.
test(
  "text in an image is recognized; an image without text gives nothing",
  { skip: !!process.env.CI, timeout: 90_000 },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cptr-ocr-test-"));
    try {
      // JPEG, not PNG: sips renders a PDF page onto a transparent
      // background, and black text on transparency cannot be read.
      const image = (name: string, lines: string[]) => {
        const pdf = path.join(dir, `${name}.pdf`);
        const out = path.join(dir, `${name}.jpg`);
        fs.writeFileSync(pdf, textPDF(lines));
        execFileSync("sips", ["-s", "format", "jpeg", pdf, "--out", out], {
          stdio: "ignore",
        });
        return out;
      };
      const text = await recognizeText(
        image("words", ["Deliberate capture", "Second line 2026"]),
      );
      assert.equal(text, "Deliberate capture\nSecond line 2026");
      assert.equal(await recognizeText(image("blank", [])), undefined);
      assert.equal(
        await recognizeText(path.join(dir, "missing.jpg")),
        undefined,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
