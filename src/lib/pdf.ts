// PDFs open in a browser tab: the PDF viewer has no DOM for the Browser
// Extension to read, and headless Chrome can't screenshot it — so a PDF URL
// gets downloaded and ingested through the PDF path instead of archived as a
// web page. Authenticated PDFs (cookie-gated) can't be fetched this way;
// the error says so.

import * as path from "node:path";

export interface FetchedPDF {
  data: Buffer;
  name: string;
}

/** Downloads are held in memory and the extension worker's heap is small. */
export const PDF_DOWNLOAD_MAX_BYTES = 100 * 1024 * 1024;

/** Download `url` and return it as a PDF when it is one; undefined when the
 * URL serves an ordinary page. Detection: .pdf path → fetch directly;
 * otherwise a cheap HEAD content-type probe gates the download. */
export async function fetchPDFIfPDF(
  url: string,
): Promise<FetchedPDF | undefined> {
  const looksPDF = pdfLikeURL(url);
  if (!looksPDF) {
    try {
      const head = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        signal: AbortSignal.timeout(10_000),
      });
      const type = head.headers.get("content-type")?.toLowerCase() ?? "";
      if (!type.includes("application/pdf")) return undefined;
    } catch {
      return undefined; // HEAD refused — treat as a normal page
    }
  }

  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`PDF download failed: HTTP ${res.status}`);
  const data = await readBodyCapped(res, PDF_DOWNLOAD_MAX_BYTES);
  if (data.subarray(0, 5).toString("latin1") !== "%PDF-") {
    if (looksPDF)
      throw new Error(
        "URL did not return a PDF (login-gated? download it and capture from Finder)",
      );
    return undefined;
  }
  return {
    data,
    name: pdfFilename(url, res.headers.get("content-disposition")),
  };
}

/** The response body, refused once it exceeds `maxBytes` — checked against
 * content-length up front and again while streaming (the header can lie or
 * be absent). */
export async function readBodyCapped(
  res: Response,
  maxBytes: number,
): Promise<Buffer> {
  const tooLarge = () =>
    new Error(
      `PDF is larger than ${Math.round(maxBytes / (1024 * 1024))} MB — download it and capture from Finder`,
    );
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  if (!res.body) return Buffer.alloc(0);

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

export function pdfLikeURL(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return false;
  }
}

export function pdfFilename(
  url: string,
  contentDisposition?: string | null,
): string {
  const header = contentDisposition?.match(
    /filename\*?=(?:UTF-8''|")?([^";]+)/i,
  )?.[1];
  if (header) {
    const name = decodeLoosely(header.replace(/"+$/, "")).trim();
    if (name) return name;
  }
  try {
    const base = path.posix.basename(new URL(url).pathname);
    if (base && base !== "/") {
      return base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf`;
    }
  } catch {
    // fall through
  }
  return "document.pdf";
}

/** Percent-decode when the value is validly encoded; a literal "%" (as in
 * `filename="100% final.pdf"`) is kept as written instead of throwing. */
function decodeLoosely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
