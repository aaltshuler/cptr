// Thumbnails via macOS shell tools — no npm dependencies and no @raycast/api,
// so it's testable on its own.

import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** qlmanage in particular can hang; a stuck tool must not hang the capture. */
export const THUMB_TOOL_TIMEOUT_MS = 20_000;

/** 256px JPEG thumbnail; returns undefined on failure (thumb is optional). */
export async function makeThumb(filePath: string): Promise<Buffer | undefined> {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "cptr-thumb-"));
  try {
    let source = filePath;
    if (/\.pdf$/i.test(filePath)) {
      // Quick Look renders page 1 — but only as PNG, so it goes through sips
      // below like any other image to become the JPEG the name promises.
      await execFileAsync(
        "qlmanage",
        ["-t", "-s", "256", filePath, "-o", outDir],
        { timeout: THUMB_TOOL_TIMEOUT_MS },
      );
      const made = fs.readdirSync(outDir).find((f) => f.endsWith(".png"));
      if (!made) return undefined;
      source = path.join(outDir, made);
    }
    const output = path.join(outDir, "thumb.jpg");
    await execFileAsync(
      "sips",
      ["-Z", "256", "-s", "format", "jpeg", source, "--out", output],
      { timeout: THUMB_TOOL_TIMEOUT_MS },
    );
    return fs.readFileSync(output);
  } catch (err) {
    console.error(`thumbnail failed for ${filePath}:`, err);
    return undefined;
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}
