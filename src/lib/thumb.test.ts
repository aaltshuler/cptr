import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { makeThumb } from "./thumb";

const JPEG_MAGIC = "ffd8ff";

// 1×1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

// Smallest PDF Quick Look will render: one empty 200×200 page.
function minimalPDF(): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

function withTempFile<T>(
  name: string,
  data: Buffer,
  run: (file: string) => Promise<T>,
): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cptr-thumb-test-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, data);
  return run(file).finally(() =>
    fs.rmSync(dir, { recursive: true, force: true }),
  );
}

test(
  "image thumbnails are JPEG",
  { skip: process.platform !== "darwin" },
  async () => {
    const thumb = await withTempFile("shot.png", PNG, makeThumb);
    assert.equal(thumb?.subarray(0, 3).toString("hex"), JPEG_MAGIC);
  },
);

// Quick Look needs a GUI session, which CI runners don't reliably have.
test(
  "PDF thumbnails are JPEG too, as thumb.jpg promises",
  { skip: process.platform !== "darwin" || !!process.env.CI },
  async () => {
    const thumb = await withTempFile("doc.pdf", minimalPDF(), makeThumb);
    assert.equal(thumb?.subarray(0, 3).toString("hex"), JPEG_MAGIC);
  },
);

test("a file that can't be thumbnailed yields undefined, not an error", async (t) => {
  t.mock.method(console, "error", () => undefined); // the failure is logged
  const thumb = await withTempFile(
    "broken.png",
    Buffer.from("nope"),
    makeThumb,
  );
  assert.equal(thumb, undefined);
});
