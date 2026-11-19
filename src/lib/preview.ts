// What the detail pane shows for a capture — pure string building, shared by
// Search and Recent.

import type { BundleEntry, Snippet } from "./scan";

/** Formats the detail pane can show inline at full size. */
const INLINE_IMAGE_RE = /\.(png|jpe?g|gif|webp)$/i;
const PREVIEW_TEXT_CHARS = 1200;

/** The capture itself when it is an image (screenshot, region, page shot,
 * clipboard image); otherwise its 256px thumbnail (PDF first page). */
export function detailImagePath(entry: BundleEntry): string | undefined {
  return entry.primaryPath && INLINE_IMAGE_RE.test(entry.primaryPath)
    ? entry.primaryPath
    : entry.thumbPath;
}

export function detailMarkdown(entry: BundleEntry, snippet?: Snippet): string {
  const image = detailImagePath(entry);
  // Markdown (a web page's reader view, a PDF's headings and paragraphs)
  // renders as such; everything else is the start of its plain text. Text
  // recognized in an image is not repeated under the image it came from.
  const body = entry.markdownPreview
    ? stripMarkdownImages(entry.markdownPreview)
    : entry.meta.text.method === "ocr"
      ? undefined
      : entry.contentPreview?.slice(0, PREVIEW_TEXT_CHARS);
  return (
    [
      image ? `![](${image})` : undefined,
      snippet ? snippetMarkdown(snippet) : undefined,
      body?.trim() || undefined,
    ]
      .filter(Boolean)
      .join("\n\n") || "*no preview*"
  );
}

/** A search hit in context, as a blockquote with the match emphasized. */
export function snippetMarkdown(snippet: Snippet): string {
  // Bold needs a letter or digit on both edges to parse reliably next to
  // other text; anything else ("c++", "node.js)") is shown as inline code.
  const wordEdged = /^[\p{L}\p{N}](?:.*[\p{L}\p{N}])?$/su.test(snippet.match);
  const match =
    wordEdged || snippet.match.includes("`")
      ? `**${escapeMarkdown(snippet.match)}**`
      : `\`${snippet.match}\``;
  return `> ${escapeMarkdown(snippet.before)}${match}${escapeMarkdown(snippet.after)}`;
}

/** Captured text shown inside markdown must not be read as markup. */
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, "\\$&");
}

/** Reader markdown without its images: previewing an archived page should
 * not fetch remote images from the original site. Alt text is kept. */
export function stripMarkdownImages(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[\s*\]\([^)]*\)/g, "") // links left empty by a removed image
    .replace(/\n{3,}/g, "\n\n");
}
