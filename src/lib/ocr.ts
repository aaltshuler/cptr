// Text in an image, read by macOS's Vision framework through osascript: no
// dependency, nothing leaves the machine. Kept free of @raycast/api so it is
// testable on its own.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Vision takes well under a second per screenshot; this only guards
 * against a stuck osascript holding the command open. */
export const OCR_TIMEOUT_MS = 60_000;

const RECOGNIZE_TEXT_JXA = `
ObjC.import("Vision");
function run(argv) {
  const url = $.NSURL.fileURLWithPath(argv[0]);
  const handler = $.VNImageRequestHandler.alloc.initWithURLOptions(url, $.NSDictionary.dictionary);
  const request = $.VNRecognizeTextRequest.alloc.init;
  request.recognitionLevel = 0; // accurate
  request.usesLanguageCorrection = true;
  request.automaticallyDetectsLanguage = true;
  if (!handler.performRequestsError($.NSArray.arrayWithObject(request), Ref())) return "";
  const results = request.results, lines = [];
  for (let i = 0; i < results.count; i++) {
    const best = results.objectAtIndex(i).topCandidates(1);
    if (best.count > 0) lines.push(ObjC.unwrap(best.objectAtIndex(0).string));
  }
  return lines.join("\\n");
}`;

/** Image formats Vision reads; everything a capture can hold as its image. */
export const OCR_IMAGE_RE = /\.(png|jpe?g|gif|tiff?|heic|webp)$/i;

/** The text Vision recognizes in the image at `imagePath`, one line per
 * recognized line, or undefined when it finds none. Throws when osascript
 * fails or times out, so a caller can tell "no text" from "did not run". */
export async function recognizeText(
  imagePath: string,
): Promise<string | undefined> {
  const { stdout } = await execFileAsync(
    "/usr/bin/osascript",
    ["-l", "JavaScript", "-e", RECOGNIZE_TEXT_JXA, imagePath],
    { timeout: OCR_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
  );
  return stdout.trim() || undefined;
}
