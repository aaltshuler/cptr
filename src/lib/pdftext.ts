// Text and structure out of a PDF's text layer. unpdf (a worker-free build of
// pdf.js) reads the text; pdf2md, on the same engine, guesses headings and
// lists from font sizes.
//
// Both are loaded inside the functions, on first use, because pdf.js is the
// largest thing the extension carries. They are loaded with require() and not
// import() because pdf2md requires unpdf's CommonJS build: an import() of
// unpdf brings its ESM build in as well, and with two builds of one package
// the Raycast bundler stops packaging it as a single lazily loaded file and
// inlines pdf.js into every command.

/* eslint-disable @typescript-eslint/no-require-imports */

const PAGE_BREAK = "<!-- PAGE_BREAK -->";
const HEADING_RE = /^(#{1,6}) (.+)$/;

/** pdf2md calls every font larger than the most common one a heading. When
 * it picks the wrong "most common", the body text itself comes out as a
 * heading level: hundreds of lines holding most of the document. Real
 * heading levels hold a percent or two of it. */
const BODY_LEVEL_SHARE = 0.1;
const BODY_LEVEL_MIN_LINES = 10;
/** A line this much shorter than the measure, ending a sentence, ends a
 * paragraph. */
const SHORT_LINE = 0.85;
/** A real heading has a word in it. The large symbols of a display formula
 * ("N", "(2)", "=") come out of pdf2md as headings of their own. */
const HEADING_MIN_LETTERS = 4;
/** Scripts in which a word is one or two characters long. */
const DENSE_SCRIPT_RE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
/** arXiv's stamp down the left margin of page 1. It is set in large type, so
 * it lands in the middle of the introduction as a top-level heading. */
const ARXIV_STAMP_RE = /^arXiv:\d{4}\.\d{4,5}(v\d+)?\s+\[[\w.-]+\]\s+\d/;

/** Plain text of every page, for content.txt and search. */
export async function extractPDFText(
  data: Uint8Array,
): Promise<string | undefined> {
  const { extractText, getDocumentProxy } =
    require("unpdf") as typeof import("unpdf");
  // pdf.js takes ownership of the bytes it is given, so it gets a copy.
  const pdf = await getDocumentProxy(new Uint8Array(data), { verbosity: 0 });
  try {
    const { text } = await extractText(pdf, { mergePages: true });
    return text.trim() || undefined;
  } finally {
    await pdf.loadingTask.destroy();
  }
}

/** The PDF as Markdown, for content.md: headings and lists as far as font
 * sizes give them away. Tables come out as running text. */
export async function extractPDFMarkdown(
  data: Uint8Array,
): Promise<string | undefined> {
  const pdf2md =
    require("@opendocsg/pdf2md") as typeof import("@opendocsg/pdf2md").default;
  return tidyPDFMarkdown(await pdf2md(new Uint8Array(data)));
}

/** pdf2md's output made fit to keep: page-break markers and control
 * characters removed, headings that are not headings (formula symbols, the
 * arXiv stamp) taken out, and a body font mistaken for a heading level
 * turned back into paragraphs. */
export function tidyPDFMarkdown(raw: string): string | undefined {
  const lines = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line !== PAGE_BREAK)
    .flatMap(withoutFalseHeading);
  const bodyLevel = bodyHeadingLevel(lines);

  const out: string[] = [];
  let prose: string[] = [];
  const flushProse = () => {
    if (prose.length === 0) return;
    out.push(paragraphs(prose), "");
    prose = [];
  };
  for (const line of lines) {
    const heading = HEADING_RE.exec(line);
    if (heading && bodyLevel !== undefined && heading[1].length >= bodyLevel) {
      prose.push(heading[2].trim());
      continue;
    }
    // pdf2md puts a blank line after every heading, so a blank line between
    // two mistaken ones is not a paragraph break.
    if (line === "" && prose.length > 0) continue;
    flushProse();
    out.push(line);
  }
  flushProse();
  return (
    out
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim() || undefined
  );
}

/** A heading line that is no heading: the arXiv stamp is dropped (the plain
 * text keeps it for search), a formula symbol goes back to being text. */
function withoutFalseHeading(line: string): string[] {
  const heading = HEADING_RE.exec(line);
  if (!heading) return [line];
  const text = heading[2].trim();
  if (ARXIV_STAMP_RE.test(text)) return [];
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  if (letters < HEADING_MIN_LETTERS && !DENSE_SCRIPT_RE.test(text))
    return [text];
  return [line];
}

/** The shallowest heading level that is really body text, if any. Deeper
 * levels are smaller type still (captions, footnotes) and go with it. */
function bodyHeadingLevel(lines: string[]): number | undefined {
  const chars = new Array<number>(7).fill(0);
  const count = new Array<number>(7).fill(0);
  let total = 0;
  for (const line of lines) {
    const heading = HEADING_RE.exec(line);
    const length = (heading ? heading[2] : line).trim().length;
    total += length;
    if (heading) {
      chars[heading[1].length] += length;
      count[heading[1].length] += 1;
    }
  }
  if (total === 0) return undefined;
  for (let level = 1; level <= 6; level++) {
    if (
      count[level] >= BODY_LEVEL_MIN_LINES &&
      chars[level] / total >= BODY_LEVEL_SHARE
    )
      return level;
  }
  return undefined;
}

/** Wrapped lines of prose back into paragraphs. */
function paragraphs(lines: string[]): string {
  const lengths = lines.map((line) => line.length).sort((a, b) => a - b);
  // The measure is a typical full line, not the longest (one stray long line
  // would make every other line look short).
  const measure = lengths[Math.floor(lengths.length * 0.9)];
  const done: string[] = [];
  let current = "";
  for (const line of lines) {
    if (/\p{L}-$/u.test(current) && /^\p{Ll}/u.test(line)) {
      current = current.slice(0, -1) + line; // a word hyphenated across lines
    } else {
      current = current ? `${current} ${line}` : line;
    }
    if (line.length < measure * SHORT_LINE && /[.!?:]["”')\]]?$/.test(line)) {
      done.push(current);
      current = "";
    }
  }
  if (current) done.push(current);
  return done.join("\n\n");
}
