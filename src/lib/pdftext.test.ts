import assert from "node:assert/strict";
import { test } from "node:test";
import { extractPDFMarkdown, extractPDFText, tidyPDFMarkdown } from "./pdftext";

const BODY = [
  "Agents that share what they learn repeat fewer mistakes and",
  "spend fewer tokens on problems another agent already solved.",
  "This note describes a router that picks, for each task, both",
  "a learning mechanism and the cluster of state it draws on.",
  "It was measured on four models across five matched rollouts.",
  "The gain over one global history is largest on long tasks.",
];

/** One Letter page: a 24pt title over 10pt body lines, in Helvetica. */
function textPDF(title: string, body: string[]): Buffer {
  const escape = (s: string) => s.replace(/[\\()]/g, "\\$&");
  const stream = [
    `BT /F1 24 Tf 72 720 Td (${escape(title)}) Tj ET`,
    ...body.map(
      (line, i) => `BT /F1 10 Tf 72 ${680 - i * 14} Td (${escape(line)}) Tj ET`,
    ),
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

test("extractPDFText reads every line and leaves the bytes usable", async () => {
  const pdf = textPDF("Routing as Learning", BODY);
  const before = Buffer.from(pdf);
  const text = await extractPDFText(pdf);
  assert.ok(text);
  assert.ok(text.startsWith("Routing as Learning"));
  for (const line of BODY) assert.ok(text.includes(line), line);
  assert.deepEqual(pdf, before);
});

test("extractPDFText gives nothing for a PDF without text", async () => {
  assert.equal(await extractPDFText(textPDF("", [])), undefined);
});

test("extractPDFMarkdown turns the large type into a heading", async () => {
  const markdown = await extractPDFMarkdown(
    textPDF("Routing as Learning", BODY),
  );
  assert.ok(markdown);
  const lines = markdown.split("\n");
  assert.equal(lines[0], "# Routing as Learning");
  assert.equal(lines.filter((line) => line.startsWith("#")).length, 1);
  assert.ok(markdown.includes("a router that picks, for each task"));
});

test("tidyPDFMarkdown drops page-break markers, control characters and blank runs", () => {
  assert.equal(
    tidyPDFMarkdown(
      "# Title \n\n\n\nFirst\u0000 page. \n<!-- PAGE_BREAK -->\n\n\nSecond page.\n",
    ),
    "# Title\n\nFirst page.\n\nSecond page.",
  );
});

test("tidyPDFMarkdown keeps ordinary headings and lists as they are", () => {
  const markdown = [
    "# Title",
    "",
    "## 1 Introduction",
    "",
    "A paragraph that is much longer than any of the headings above it, as body text is.",
    "",
    "- first item",
    "- second item",
    "",
    "## 2 Method",
    "",
    "Another paragraph, again longer than the headings, so they stay a small share.",
  ].join("\n");
  assert.equal(tidyPDFMarkdown(markdown), markdown);
});

test("tidyPDFMarkdown turns a body font mistaken for headings back into paragraphs", () => {
  // What pdf2md emits when the body type is larger than the most common
  // size: every wrapped line of prose is its own heading.
  const wrapped = [
    "State-of-the-art agentic systems are designed to operate at scale, with distrib-",
    "uted agents acting concurrently. Many of these agents meet related problems and",
    "could benefit from shared knowledge.",
    "Routing decides, for each task, which learning mechanism to use and which",
    "cluster of state to read. It is cheap to compute and it does not need labels,",
    "only the rewards the agents already collect while they work on their tasks.",
    "The second paragraph ends here, on a full line, and the section goes on with",
    "a few more lines so that this level holds most of the text of the document,",
    "as body text does and real headings never do in any paper we have captured.",
    "One more full line of prose is here to bring the count of lines up to ten ok",
    "and a last short one.",
  ];
  const raw = [
    "# Routed Continual Learning",
    "",
    "## 1 Introduction",
    "",
    ...wrapped.flatMap((line) => [`##### ${line} `, ""]),
    "## 2 Method",
    "",
    "###### A footnote in smaller type.",
    "",
  ].join("\n");
  assert.equal(
    tidyPDFMarkdown(raw),
    [
      "# Routed Continual Learning",
      "",
      "## 1 Introduction",
      "",
      "State-of-the-art agentic systems are designed to operate at scale, with distributed agents acting concurrently. Many of these agents meet related problems and could benefit from shared knowledge.",
      "",
      "Routing decides, for each task, which learning mechanism to use and which cluster of state to read. It is cheap to compute and it does not need labels, only the rewards the agents already collect while they work on their tasks. The second paragraph ends here, on a full line, and the section goes on with a few more lines so that this level holds most of the text of the document, as body text does and real headings never do in any paper we have captured. One more full line of prose is here to bring the count of lines up to ten ok and a last short one.",
      "",
      "## 2 Method",
      "",
      "A footnote in smaller type.",
    ].join("\n"),
  );
});

test("tidyPDFMarkdown takes out headings that are not headings", () => {
  const raw = [
    "## 1 Introduction",
    "",
    "Agent decisions can remain in memory after the facts change.",
    "",
    "# arXiv:2611.19859v1 [cs.AI] 15 Nov 2026",
    "",
    "The results do not support an unconditional replacement.",
    "",
    "### 4.3 Endpoints",
    "",
    " Am =",
    "",
    "#### 1",
    "",
    "#### N",
    "",
    "#### (2)",
    "",
    "## FAQs",
    "",
    "## 概要",
  ].join("\n");
  assert.equal(
    tidyPDFMarkdown(raw),
    [
      "## 1 Introduction",
      "",
      "Agent decisions can remain in memory after the facts change.",
      "",
      "The results do not support an unconditional replacement.",
      "",
      "### 4.3 Endpoints",
      "",
      " Am =",
      "",
      "1",
      "",
      "N",
      "",
      "(2)",
      "",
      "## FAQs",
      "",
      "## 概要",
    ].join("\n"),
  );
});

test("tidyPDFMarkdown gives nothing when nothing is left", () => {
  assert.equal(tidyPDFMarkdown("\n<!-- PAGE_BREAK -->\n\u0000\n"), undefined);
});
