// meta.json schema v1.

export type CaptureKind =
  "screenshot" | "region" | "webpage" | "pdf" | "clipboard" | "selection";

/** Where a capture's text came from: the selection API, the clipboard, a
 * live tab's DOM, a PDF's text layer, or text recognized in an image. */
export type TextMethod =
  "raycast" | "pasteboard" | "dom" | "pdfjs" | "ocr" | LegacyTextMethod;

/** Written by versions before 0.1; still read, never written. `pdfkit` text
 * came from an older PDF engine and is re-extracted by Reprocess Captures. */
export type LegacyTextMethod = "pdfkit" | "vision-document" | "ax";

export interface SourceInfo {
  app?: string;
  appName?: string;
  windowTitle?: string;
  url?: string;
  file?: string;
}

export interface GeometryInfo {
  display: number;
  rect: [number, number, number, number];
  scale: number;
}

export interface TextEntities {
  urls: string[];
  emails: string[];
  phones: string[];
}

export interface TextInfo {
  status: "pending" | "done" | "none";
  chars?: number;
  method?: TextMethod;
  entities?: TextEntities;
}

export interface CaptureMeta {
  v: number;
  id: string;
  kind: CaptureKind;
  created: string; // ISO8601 ms + local offset, e.g. 2026-07-16T14:32:01.412+03:00
  sha256: string;
  source: SourceInfo;
  geometry?: GeometryInfo;
  text: TextInfo;
  ai?: { title?: string; tags?: string[] };
  tags: string[];
  group?: string;
}

/** Local time with its UTC offset: "2026-07-16T14:32:01.412+03:00". */
export function isoWithOffset(date: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `.${pad(date.getMilliseconds(), 3)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}
