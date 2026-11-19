// What a capture will write and say, decided from plain inputs — pure, so the
// engines' decisions are testable without @raycast/api (same idea as tabs.ts).
// engines.ts gathers the inputs and performs the result.

import * as path from "node:path";
import { htmlToPlainText } from "./html";
import type { TextMethod } from "./meta";
import { clipboardFilePath } from "./paths";
import type { FileItem } from "./store";

/** The URL argument as an http(s) URL. A bare domain ("example.com/x") gets
 * https://; the result is normalized the way a browser shows it, so it
 * matches an open tab's URL. */
export function normalizeWebURL(input: string): string {
  const raw = input.trim();
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  let parsed: URL;
  try {
    parsed = new URL(hasScheme ? raw : `https://${raw}`);
  } catch {
    throw new Error(`Not a URL: ${raw}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Not an http(s) URL: ${raw}`);
  }
  // Without a scheme, "mailto:a@b.co" or a stray word would parse as a host.
  const plausibleHost =
    parsed.hostname.includes(".") || parsed.hostname === "localhost";
  if (!hasScheme && (!plausibleHost || parsed.username || parsed.password)) {
    throw new Error(`Not a URL: ${raw}`);
  }
  return parsed.href;
}

export interface SelectionContextPlan {
  /** Group id for the selection bundle, when it will have a sibling. */
  group?: string;
  /** Whether to archive the page the selection came from, after the ack. */
  archivePage: boolean;
}

/** A selection is grouped only when its page context will be archived with
 * it: the setting must be on, the tab readable (Browser Extension) and not
 * captured within the dedupe window. An explicit group is always kept. */
export function planSelectionContext(input: {
  /** The "archive the page behind a selection" setting. On when unset. */
  enabled?: boolean;
  explicitGroup?: string;
  tabURL?: string;
  canReadTabs: boolean;
  recentlyArchived: boolean;
  newGroupID: () => string;
}): SelectionContextPlan {
  const archivePage =
    input.enabled !== false &&
    !!input.tabURL &&
    input.canReadTabs &&
    !input.recentlyArchived;
  const group =
    input.explicitGroup ?? (archivePage ? input.newGroupID() : undefined);
  return { ...(group ? { group } : {}), archivePage };
}

export type ClipboardPlan =
  | { type: "image"; path: string; fileName: string }
  | { type: "fileRef"; path: string }
  | { type: "text"; raw: string; url?: string }
  | { type: "empty" };

const CLIPBOARD_IMAGE_RE = /\.(png|jpe?g|gif|tiff?|heic|webp)$/i;

/** How the clipboard is captured: an image file is copied in, any other
 * file is kept as a path reference, otherwise text (HTML only when there's
 * no plain text). A lone URL is also stamped as the source URL. */
export function planClipboard(
  content: { text?: string; html?: string; file?: string },
  fileExists: (p: string) => boolean,
): ClipboardPlan {
  if (content.file) {
    const p = clipboardFilePath(content.file);
    if (CLIPBOARD_IMAGE_RE.test(p) && fileExists(p)) {
      return {
        type: "image",
        path: p,
        fileName: `content${path.extname(p).toLowerCase()}`,
      };
    }
    return { type: "fileRef", path: p };
  }
  const raw =
    content.text ?? (content.html ? htmlToPlainText(content.html) : undefined);
  const text = raw?.trim();
  if (!raw || !text) return { type: "empty" };
  return {
    type: "text",
    raw,
    ...(/^https?:\/\/\S+$/.test(text) ? { url: text } : {}),
  };
}

export interface PagePlan {
  /** Bundle files in order — the first is the primary. No thumbnail yet. */
  files: FileItem[];
  /** Searchable text for content.txt, when there is any. */
  text?: string;
  method: Extract<TextMethod, "dom" | "pdfjs">;
  /** True when the text itself is the primary file (nothing else to keep). */
  textIsPrimary: boolean;
}

/** The files of a web-page bundle, from one source and never mixed. Live
 * tab: window screenshot + reader markdown, searchable by its plain text
 * (markdown when there is none). Re-fetch: viewport PNG + full page.pdf,
 * searchable by the text extracted from that PDF. With `keepPDF` off the
 * PDF is dropped once its text is out, unless it is all the render gave. */
export function planPageFiles(input: {
  live?: { markdown?: string; text?: string };
  png?: Buffer;
  renderedPDF?: Buffer;
  renderedText?: string;
  /** The "keep the full-page PDF" setting. On when unset. */
  keepPDF?: boolean;
}): PagePlan {
  const files: FileItem[] = [];
  let text: string | undefined;
  if (input.png) files.push({ name: "content.png", data: input.png });
  if (input.live) {
    text = input.live.text ?? input.live.markdown;
    if (input.live.markdown) {
      files.push({
        name: "content.md",
        data: Buffer.from(input.live.markdown, "utf8"),
      });
    }
  } else {
    text = input.renderedText;
    const onlyArtifact = !input.png && !text;
    if (input.renderedPDF && (input.keepPDF !== false || onlyArtifact)) {
      files.push({ name: "page.pdf", data: input.renderedPDF });
    }
  }
  const textIsPrimary = files.length === 0 && !!text;
  if (textIsPrimary) {
    files.push({ name: "content.txt", data: Buffer.from(text!, "utf8") });
  }
  if (files.length === 0) {
    throw new Error(
      "Page render produced nothing — check the URL, or install the Raycast Browser Extension for live-tab capture",
    );
  }
  return { files, text, method: input.live ? "dom" : "pdfjs", textIsPrimary };
}

/** HUD line for a Finder PDF capture, naming files that couldn't be read. */
export function pdfAck(captured: number, failed: string[]): string {
  const ack = `✓ Captured ${captured} PDF${captured === 1 ? "" : "s"}`;
  return failed.length === 0
    ? ack
    : `${ack} — ${failed.length} failed (${failed.join(", ")})`;
}

/** Tags as typed into the tag editor: split on commas and line breaks, a
 * leading "#" dropped, lowercased, without duplicates. */
export function parseTags(input: string): string[] {
  const tags = input
    .split(/[,\n]/)
    .map((tag) => tag.trim().replace(/^#+/, "").replace(/\s+/g, " "))
    .map((tag) => tag.toLowerCase())
    .filter(Boolean);
  return [...new Set(tags)];
}
