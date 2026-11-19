// Capture engines. Every engine returns a human ack line for the HUD, or
// throws an Error whose message names the fix (surfaced as a failure toast).

import {
  Clipboard,
  getSelectedFinderItems,
  getSelectedText,
} from "@raycast/api";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  browserTabURL,
  execFileAsync,
  frontWindowID,
  isBrowser,
  isFreshURL,
  newGroupID,
  prefs,
  recordURL,
  sourceInfo,
  store,
  userFrontmostApp,
} from "./support";
import {
  activeTab,
  canReadTabs,
  readActiveTab,
  TabContent,
  tabContentForURL,
} from "./browser";
import { recognizeText } from "./ocr";
import { fetchPDFIfPDF } from "./pdf";
import { extractPDFMarkdown, extractPDFText } from "./pdftext";
import {
  normalizeWebURL,
  pdfAck,
  planClipboard,
  planPageFiles,
  planSelectionContext,
} from "./plan";
import { Committed } from "./store";
import { sameDocumentURL } from "./tabs";
import { makeThumb } from "./thumb";
import { CaptureResult } from "./types";
import { renderPagePixels } from "./web";

export async function captureSelection(group?: string): Promise<CaptureResult> {
  let text: string;
  try {
    text = await getSelectedText();
  } catch {
    throw new Error(
      "No text selected (or the app doesn't expose its selection — try ⌘C then Capture Clipboard)",
    );
  }
  if (!text.trim()) throw new Error("Selection is empty");

  const source = await sourceInfo();
  // The selecting browser's own tab — never another browser's active tab.
  const tabURL = isBrowser(source.app)
    ? await browserTabURL(source.app)
    : undefined;
  if (tabURL) source.url = tabURL;

  const s = store();
  // Page context comes only from the live tab, so it needs the Browser
  // Extension — and a page archived moments ago isn't archived again.
  const context = planSelectionContext({
    enabled: prefs().archiveSelectionPage,
    explicitGroup: group,
    tabURL,
    canReadTabs: canReadTabs(),
    recentlyArchived: !!tabURL && isFreshURL(tabURL),
    newGroupID,
  });
  s.commit({
    kind: "selection",
    primary: { name: "content.txt", data: Buffer.from(text, "utf8") },
    source,
    text: { status: "done", method: "raycast" },
    ...(context.group ? { group: context.group } : {}),
  });

  // Generous fan-out: archive the page context, deduped, after the ack.
  const ack = `✓ Captured — ${text.length} chars${source.appName ? ` from ${source.appName}` : ""}`;
  if (!tabURL || !context.archivePage) return ack;
  return {
    ack,
    followUp: archiveSelectionContext(tabURL, context.group),
    followUpFailureTitle: "Selection saved, but page context failed",
  };
}

/** Page context for a browser selection, from the live tab only. A headless
 * re-fetch would be logged out and can replay one-time links, so a page the
 * Browser Extension can't read is skipped rather than re-requested. */
async function archiveSelectionContext(
  url: string,
  group: string | undefined,
): Promise<void> {
  const live = await tabContentForURL(url);
  if (live) await archivePage(url, group, live);
}

export async function captureClipboard(): Promise<CaptureResult> {
  const plan = planClipboard(await Clipboard.read(), fs.existsSync);
  if (plan.type === "empty") {
    throw new Error("Clipboard is empty (or holds concealed content)");
  }
  const source = await sourceInfo();
  const s = store();

  if (plan.type === "image") {
    const data = fs.readFileSync(plan.path);
    const thumb = await makeThumb(plan.path);
    const ocr = prefs().recognizeText !== false;
    const committed = s.commit({
      kind: "clipboard",
      primary: { name: plan.fileName, data },
      extras: thumb ? [{ name: "thumb.jpg", data: thumb }] : [],
      source: { ...source, file: plan.path },
      text: { status: ocr ? "pending" : "none" },
    });
    const ack = `✓ Captured clipboard image (${path.basename(plan.path)})`;
    return ocr ? withRecognizedText(s, committed, plan.fileName, ack) : ack;
  }
  if (plan.type === "fileRef") {
    s.commit({
      kind: "clipboard",
      primary: { name: "content.txt", data: Buffer.from(plan.path, "utf8") },
      source: { ...source, file: plan.path },
      text: { status: "done", method: "pasteboard" },
    });
    return `✓ Captured file reference`;
  }
  s.commit({
    kind: "clipboard",
    primary: { name: "content.txt", data: Buffer.from(plan.raw, "utf8") },
    source: { ...source, ...(plan.url ? { url: plan.url } : {}) },
    text: { status: "done", method: "pasteboard" },
  });
  return `✓ Captured clipboard — ${plan.raw.length} chars`;
}

export async function captureScreen(): Promise<CaptureResult> {
  const tmp = await runScreencapture(["-x", "-m"]);
  if (!tmp) throw screenPermissionError();
  return commitShot(tmp, "screenshot", "✓ Captured full screen");
}

export async function captureRegion(): Promise<CaptureResult> {
  // -i interactive (drag a rect; space = window mode; esc = cancel)
  const tmp = await runScreencapture(["-i"], { cancellable: true });
  if (tmp === "cancelled") return ""; // user's Esc is the ack
  if (!tmp) throw screenPermissionError();
  return commitShot(tmp, "region", "✓ Captured region");
}

/** Runs screencapture; returns the file path, "cancelled", or undefined on
 * failure. Cancel (Esc) exits 1 with empty stderr; permission failure exits 1
 * with "could not create image…" on stderr — the file tells the truth. */
async function runScreencapture(
  args: string[],
  options: { cancellable?: boolean } = {},
): Promise<string | "cancelled" | undefined> {
  const tmp = path.join(
    os.tmpdir(),
    `cptr-shot-${process.pid}-${randomUUID()}.png`,
  );
  let stderr = "";
  try {
    // The interactive crosshair waits on the user; everything else is
    // instant, so a stall there is a hang and gets cut off.
    const result = await execFileAsync(
      "/usr/sbin/screencapture",
      [...args, tmp],
      options.cancellable ? {} : { timeout: SCREENCAPTURE_TIMEOUT_MS },
    );
    stderr = result.stderr ?? "";
  } catch (err) {
    const failure = err as { stderr?: string; killed?: boolean };
    stderr = failure.killed
      ? `timed out after ${SCREENCAPTURE_TIMEOUT_MS / 1000} s`
      : (failure.stderr ?? "");
  }
  if (fs.existsSync(tmp)) return tmp;
  if (options.cancellable && !stderr.trim()) return "cancelled";
  console.error(
    `screencapture failed: args=${args.join(" ")} stderr=${stderr.trim() || "(empty)"}`,
  );
  lastScreencaptureStderr = stderr.trim();
  return undefined;
}

let lastScreencaptureStderr = "";
const SCREENCAPTURE_TIMEOUT_MS = 15_000;

function screenPermissionError(): Error {
  const detail = lastScreencaptureStderr ? ` [${lastScreencaptureStderr}]` : "";
  return new Error(
    `Screen capture failed${detail} — check Raycast under System Settings → Privacy & Security → Screen & System Audio Recording`,
  );
}

async function commitShot(
  tmp: string,
  kind: "screenshot" | "region",
  ack: string,
): Promise<CaptureResult> {
  try {
    const data = fs.readFileSync(tmp);
    const thumb = await makeThumb(tmp);
    const source = await sourceInfo();
    const ocr = prefs().recognizeText !== false;
    const s = store();
    const committed = s.commit({
      kind,
      primary: { name: "content.png", data },
      extras: thumb ? [{ name: "thumb.jpg", data: thumb }] : [],
      source,
      text: { status: ocr ? "pending" : "none" },
    });
    return ocr ? withRecognizedText(s, committed, "content.png", ack) : ack;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** The ack now, and the text in the bundle's image once the HUD is up. */
function withRecognizedText(
  s: ReturnType<typeof store>,
  bundle: Committed,
  imageName: string,
  ack: string,
): CaptureResult {
  return {
    ack,
    followUp: recognizeBundleText(s, bundle, imageName),
    followUpFailureTitle: "Image saved, but text recognition failed",
  };
}

async function recognizeBundleText(
  s: ReturnType<typeof store>,
  bundle: Committed,
  imageName: string,
): Promise<void> {
  try {
    const text = await recognizeText(path.join(bundle.dir, imageName));
    s.enrichText(bundle.id, text ?? null, "ocr");
  } catch (err) {
    // Settled without a method, so Reprocess Captures tries again.
    s.enrichText(bundle.id, null);
    throw err;
  }
}

export async function capturePDFs(): Promise<CaptureResult> {
  let items: { path: string }[] = [];
  try {
    items = await getSelectedFinderItems();
  } catch {
    // not in Finder — the browser-tab fallback below may still apply
  }
  const pdfs = items.filter((i) => /\.pdf$/i.test(i.path));
  if (pdfs.length === 0) {
    // A PDF open in a browser tab is the other place PDFs live.
    const url = (await activeTab())?.url;
    if (url) {
      const fetched = await fetchPDFIfPDF(url);
      if (fetched)
        return ingestPDFData(fetched.data, { url, name: fetched.name });
    }
    throw new Error(
      "Select PDF file(s) in Finder, or focus a PDF tab in the browser",
    );
  }

  // One file in memory at a time (the worker heap is small), and one bad
  // file doesn't abandon the rest.
  const s = store();
  const committed: Committed[] = [];
  const failed: string[] = [];
  for (const item of pdfs) {
    try {
      const data = fs.readFileSync(item.path);
      const thumb = await makeThumb(item.path);
      committed.push(
        s.commit({
          kind: "pdf",
          primary: { name: "content.pdf", data },
          extras: thumb ? [{ name: "thumb.jpg", data: thumb }] : [],
          source: { file: item.path },
          text: { status: "pending" },
        }),
      );
    } catch (err) {
      console.error(`PDF capture failed for ${item.path}:`, err);
      failed.push(path.basename(item.path));
    }
  }
  if (committed.length === 0) {
    throw new Error(`Could not read ${failed.join(", ")}`);
  }
  return {
    ack: pdfAck(committed.length, failed),
    followUp: enrichCommittedPDFs(s, committed),
    followUpFailureTitle: "PDFs saved, but text enrichment failed",
  };
}

/** Text for already-committed PDF bundles, read back and extracted one at a
 * time. Every bundle gets settled even if an earlier one fails. */
async function enrichCommittedPDFs(
  s: ReturnType<typeof store>,
  bundles: Committed[],
): Promise<void> {
  let firstError: unknown;
  for (const bundle of bundles) {
    try {
      const data = await fs.promises.readFile(
        path.join(bundle.dir, "content.pdf"),
      );
      await enrichPDF(s, bundle.id, data);
    } catch (err) {
      console.error(`PDF enrichment failed for ${bundle.id}:`, err);
      firstError ??= err;
    }
  }
  if (firstError) throw firstError;
}

/** Shared PDF ingest for downloaded bytes (browser-tab PDFs). */
async function ingestPDFData(
  data: Buffer,
  origin: { url?: string; file?: string; name: string },
): Promise<CaptureResult> {
  const s = store();
  const thumb = await thumbFromImageData(data, ".pdf");
  const committed = s.commit({
    kind: "pdf",
    primary: { name: "content.pdf", data },
    extras: thumb ? [{ name: "thumb.jpg", data: thumb }] : [],
    source: {
      ...(origin.url ? { url: origin.url } : {}),
      ...(origin.file ? { file: origin.file } : {}),
    },
    text: { status: "pending" },
  });
  return {
    ack: `✓ Captured PDF — ${origin.name}`,
    followUp: enrichPDF(s, committed.id, data),
    followUpFailureTitle: "PDF saved, but text enrichment failed",
  };
}

async function thumbFromImageData(
  data: Buffer,
  ext: ".pdf" | ".png",
): Promise<Buffer | undefined> {
  const tmp = path.join(
    os.tmpdir(),
    `cptr-thumb-src-${process.pid}-${randomUUID()}${ext}`,
  );
  try {
    fs.writeFileSync(tmp, data);
    return await makeThumb(tmp);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

async function enrichPDF(
  s: ReturnType<typeof store>,
  id: string,
  data: Buffer,
): Promise<void> {
  let text: string | undefined;
  try {
    text = await extractPDFText(data);
    s.enrichText(id, text ?? null, "pdfjs");
  } catch (err) {
    console.error(`PDF text extraction failed for ${id}:`, err);
    s.enrichText(id, null);
  }
  if (!text) return;
  // Structure is a bonus on top of settled text: a PDF that defeats it keeps
  // its plain text.
  try {
    const markdown = await extractPDFMarkdown(data);
    if (markdown) s.addMarkdown(id, markdown);
  } catch (err) {
    console.error(`PDF markdown extraction failed for ${id}:`, err);
  }
}

export async function captureWeb(urlOverride?: string): Promise<CaptureResult> {
  let url: string | undefined;
  let live: TabContent | undefined;
  if (urlOverride?.trim()) {
    url = normalizeWebURL(urlOverride);
    // If that URL happens to be open in a tab, prefer the live content.
    live = await tabContentForURL(url);
  } else {
    const tab = await activeTab();
    url = tab?.url;
    // PDF-viewer tabs have no readable DOM — the URL is still known.
    live = tab && (await readActiveTab(tab));
  }
  if (!url) {
    throw new Error(
      "No URL — focus a browser tab (or install the Raycast Browser Extension), or pass a URL",
    );
  }
  // Without live content the URL may serve a PDF: the viewer has no DOM to
  // archive and headless Chrome can't screenshot it, so ingest it as a PDF.
  // A readable live tab is a page — nothing re-requests its URL.
  if (!live) {
    const fetched = await fetchPDFIfPDF(url);
    if (fetched)
      return ingestPDFData(fetched.data, { url, name: fetched.name });
  }
  return archivePage(url, undefined, live);
}

/** Archive a page from one source, never mixed. Live tab: the text the user
 * sees (logged in) plus a screenshot of the browser window itself. No live
 * tab (explicit Capture Web Page only): a logged-out headless re-fetch —
 * viewport PNG, full page.pdf, and text extracted from that PDF. */
async function archivePage(
  url: string,
  group: string | undefined,
  live: TabContent | undefined,
): Promise<string> {
  const source = await sourceInfo();
  let png: Buffer | undefined;
  let renderedPDF: Buffer | undefined;
  let renderedText: string | undefined;
  if (live) {
    png = await liveWindowShot(live.url);
  } else {
    const rendered = await renderPagePixels(url, {
      browserApp: prefs().browserApp?.path,
    });
    png = rendered.png;
    renderedPDF = rendered.pdf;
    renderedText = renderedPDF
      ? await extractPDFText(renderedPDF).catch(() => undefined)
      : undefined;
  }
  const plan = planPageFiles({
    live,
    png,
    renderedPDF,
    renderedText,
    keepPDF: prefs().keepPagePDF,
  });
  const files = [...plan.files];
  if (png) {
    const thumb = await thumbFromImageData(png, ".png");
    if (thumb) files.push({ name: "thumb.jpg", data: thumb });
  }
  const [primary, ...extras] = files;

  const s = store();
  const committed = s.commit({
    kind: "webpage",
    primary,
    extras,
    source: {
      ...source,
      url: live?.url ?? url,
      ...(live?.title ? { windowTitle: live.title } : {}),
    },
    text: plan.textIsPrimary
      ? { status: "done", method: plan.method }
      : { status: "pending" },
    ...(group ? { group } : {}),
  });
  recordURL(url);
  if (!plan.textIsPrimary) {
    s.enrichText(committed.id, plan.text ?? null, plan.method);
  }
  const via = live ? "live tab" : "re-fetch";
  return `✓ Page archived (${via}) — ${plan.text?.length ?? 0} chars${live?.title ? ` · ${live.title}` : ""}`;
}

/** Pixels of the page as the user sees it: the frontmost browser's window,
 * shot only while it still shows `url` so pixels and live text agree. None
 * when no browser is frontmost — the tab could be in any window. */
async function liveWindowShot(url: string): Promise<Buffer | undefined> {
  const app = await userFrontmostApp();
  if (!isBrowser(app.bundleId)) return undefined;
  const shown = await browserTabURL(app.bundleId);
  if (!shown || !sameDocumentURL(shown, url)) return undefined;
  const windowID = await frontWindowID(app.bundleId);
  if (windowID === undefined) return undefined;
  // -l: that window only (occluding windows, Raycast's included, don't show);
  // -o: no shadow.
  const tmp = await runScreencapture(["-x", "-o", "-l", String(windowID)]);
  if (!tmp || tmp === "cancelled") return undefined;
  try {
    return fs.readFileSync(tmp);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
