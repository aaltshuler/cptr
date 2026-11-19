// Brings existing bundles up to what a fresh capture gets today: text for
// bundles left "pending" by a command that died, text and Markdown for PDFs
// read by an older engine, text for images that were never read. Free of
// @raycast/api, so the whole pass is testable against a temporary store.

import * as fs from "node:fs";
import * as path from "node:path";
import { OCR_IMAGE_RE, recognizeText } from "./ocr";
import { extractPDFMarkdown, extractPDFText } from "./pdftext";
import { BundleFiles, walkBundles } from "./scan";
import type { CaptureStore } from "./store";

/** "missing": only what a bundle lacks. "all": extract everything again,
 * replacing what is there (after an engine improved). */
export type ReprocessScope = "missing" | "all";

export type ReprocessStep =
  "pdf-text" | "pdf-markdown" | "page-text" | "ocr" | "settle";

export interface ReprocessOptions {
  scope: ReprocessScope;
  /** The "recognize text in images" setting. */
  ocr: boolean;
}

/** What one bundle needs, in the order it is done. Empty: up to date. */
export function planReprocess(
  bundle: Pick<BundleFiles, "meta" | "files">,
  options: ReprocessOptions,
): ReprocessStep[] {
  const { kind, text } = bundle.meta;
  const has = (name: string) => bundle.files.includes(name);
  const all = options.scope === "all";
  const pending = text.status === "pending";

  if (kind === "pdf" && has("content.pdf")) {
    if (all || pending || text.method !== "pdfjs")
      return ["pdf-text", "pdf-markdown"];
    return text.status === "done" && !has("content.md") ? ["pdf-markdown"] : [];
  }
  // A re-fetched page: its text comes from page.pdf. (A live-tab page has
  // content.md instead, and its source is gone.)
  if (kind === "webpage" && has("page.pdf") && !has("content.md")) {
    return all || pending || text.method !== "pdfjs" ? ["page-text"] : [];
  }
  if (options.ocr && imageName(bundle)) {
    const untried = text.status === "none" && text.method !== "ocr";
    const redo = all && (text.status !== "done" || text.method === "ocr");
    if (pending || untried || redo) return ["ocr"];
  }
  return pending ? ["settle"] : [];
}

/** The image a bundle is, when it is one: a screenshot, a region, or an
 * image file captured from the clipboard. */
export function imageName(
  bundle: Pick<BundleFiles, "meta" | "files">,
): string | undefined {
  const { kind } = bundle.meta;
  if (kind === "region" || kind === "screenshot")
    return bundle.files.includes("content.png") ? "content.png" : undefined;
  if (kind === "clipboard")
    return bundle.files.find(
      (name) => name.startsWith("content.") && OCR_IMAGE_RE.test(name),
    );
  return undefined;
}

export interface ReprocessReport {
  /** Bundles looked at. */
  scanned: number;
  /** Bundles that needed something, by what they are. */
  pdfs: number;
  pages: number;
  images: number;
  settled: number;
  /** Bundles whose extraction threw; they are left settled, not pending. */
  failed: number;
}

/** The extractors, replaceable in tests. */
export interface ReprocessTools {
  pdfText: (data: Uint8Array) => Promise<string | undefined>;
  pdfMarkdown: (data: Uint8Array) => Promise<string | undefined>;
  ocr: (imagePath: string) => Promise<string | undefined>;
}

const REAL_TOOLS: ReprocessTools = {
  pdfText: extractPDFText,
  pdfMarkdown: extractPDFMarkdown,
  ocr: recognizeText,
};

/** One pass over the store, a bundle at a time (the worker heap is small,
 * and a PDF is held in memory while it is read). */
export async function reprocessBundles(
  store: CaptureStore,
  options: ReprocessOptions & {
    onProgress?: (done: number, total: number) => void;
    tools?: ReprocessTools;
  },
): Promise<ReprocessReport> {
  const tools = options.tools ?? REAL_TOOLS;
  const report: ReprocessReport = {
    scanned: 0,
    pdfs: 0,
    pages: 0,
    images: 0,
    settled: 0,
    failed: 0,
  };
  const work: { bundle: BundleFiles; steps: ReprocessStep[] }[] = [];
  for (const bundle of walkBundles(store.root)) {
    report.scanned++;
    const steps = planReprocess(bundle, options);
    if (steps.length > 0) work.push({ bundle, steps });
  }

  let done = 0;
  for (const { bundle, steps } of work) {
    options.onProgress?.(done, work.length);
    const id = path.relative(store.root, bundle.dir).split(path.sep).join("/");
    try {
      await reprocessOne(store, id, bundle, steps, tools);
    } catch (err) {
      console.error(`reprocess failed for ${id}:`, err);
      report.failed++;
      settle(store, id, bundle);
    }
    if (steps.includes("ocr")) report.images++;
    else if (steps.includes("page-text")) report.pages++;
    else if (steps.includes("settle")) report.settled++;
    else report.pdfs++;
    done++;
  }
  options.onProgress?.(done, work.length);
  return report;
}

async function reprocessOne(
  store: CaptureStore,
  id: string,
  bundle: BundleFiles,
  steps: ReprocessStep[],
  tools: ReprocessTools,
): Promise<void> {
  const file = (name: string) => path.join(bundle.dir, name);
  const hadText = bundle.files.includes("content.txt");

  if (steps.includes("ocr")) {
    const text = await tools.ocr(file(imageName(bundle)!));
    store.enrichText(id, text ?? null, "ocr", { overwrite: true });
    return;
  }
  if (steps.includes("settle")) {
    settle(store, id, bundle);
    return;
  }

  const pdfName = steps.includes("page-text") ? "page.pdf" : "content.pdf";
  const data = await fs.promises.readFile(file(pdfName));
  let hasText = bundle.meta.text.status === "done";
  if (steps.includes("pdf-text") || steps.includes("page-text")) {
    const text = await tools.pdfText(data);
    // Text an older engine found is not thrown away because this one found
    // none: the bundle is settled as it stands.
    if (text) store.enrichText(id, text, "pdfjs", { overwrite: true });
    else if (hadText) settle(store, id, bundle);
    else store.enrichText(id, null, "pdfjs");
    hasText = !!text || hadText;
  }
  if (steps.includes("pdf-markdown") && hasText) {
    const markdown = await tools.pdfMarkdown(data);
    if (markdown) store.addMarkdown(id, markdown, { overwrite: true });
  }
}

/** Take a bundle out of "pending" with what it already holds. */
function settle(store: CaptureStore, id: string, bundle: BundleFiles): void {
  const meta = store.meta(id);
  if (meta.text.status !== "pending") return;
  const txt = path.join(bundle.dir, "content.txt");
  store.enrichText(
    id,
    fs.existsSync(txt) ? fs.readFileSync(txt, "utf8") : null,
    meta.text.method,
  );
}

/** HUD line for a finished pass. */
export function reprocessAck(report: ReprocessReport): string {
  const changed = report.pdfs + report.pages + report.images + report.settled;
  if (changed === 0) {
    return `✓ Nothing to reprocess — ${count(report.scanned, "capture")} up to date`;
  }
  const parts = [
    report.pdfs > 0 ? count(report.pdfs, "PDF") : undefined,
    report.pages > 0 ? count(report.pages, "page") : undefined,
    report.images > 0 ? count(report.images, "image") : undefined,
    report.settled > 0 ? `${report.settled} settled` : undefined,
    report.failed > 0 ? `${report.failed} failed` : undefined,
  ].filter(Boolean);
  return `✓ Reprocessed ${count(changed, "capture")} — ${parts.join(", ")}`;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
