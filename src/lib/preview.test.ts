import assert from "node:assert/strict";
import { test } from "node:test";
import { CaptureKind } from "./meta";
import {
  detailImagePath,
  detailMarkdown,
  escapeMarkdown,
  snippetMarkdown,
  stripMarkdownImages,
} from "./preview";
import { BundleEntry } from "./scan";

function entry(
  kind: CaptureKind,
  over: Partial<BundleEntry> = {},
): BundleEntry {
  return {
    dir: "/c/2026-07-16/120000-abcd",
    meta: {
      v: 1,
      id: "2026-07-16/120000-abcd",
      kind,
      created: "2026-07-16T12:00:00.000+03:00",
      sha256: "0".repeat(64),
      source: {},
      text: { status: "none" },
      tags: [],
    },
    ...over,
  };
}

test("detail shows the capture itself when it is an image, not its thumbnail", () => {
  const region = entry("region", {
    primaryPath: "/c/b/content.png",
    thumbPath: "/c/b/thumb.jpg",
  });
  assert.equal(detailImagePath(region), "/c/b/content.png");
  assert.equal(detailMarkdown(region), "![](/c/b/content.png)");
});

test("detail falls back to the thumbnail for PDFs and unlistable formats", () => {
  const pdf = entry("pdf", {
    primaryPath: "/c/b/content.pdf",
    thumbPath: "/c/b/thumb.jpg",
  });
  assert.equal(detailImagePath(pdf), "/c/b/thumb.jpg");
  const heic = entry("clipboard", {
    primaryPath: "/c/b/content.heic",
    thumbPath: "/c/b/thumb.jpg",
  });
  assert.equal(detailImagePath(heic), "/c/b/thumb.jpg");
  assert.equal(detailImagePath(entry("selection")), undefined);
});

test("web pages preview their reader markdown, other captures their text", () => {
  const page = entry("webpage", {
    primaryPath: "/c/b/content.md",
    contentPreview: "Title plain text",
    markdownPreview: "# Title\n\n![hero](https://x.com/hero.png)\n\nBody",
  });
  assert.equal(detailMarkdown(page), "# Title\n\nhero\n\nBody");

  const selection = entry("selection", { contentPreview: "picked words" });
  assert.equal(detailMarkdown(selection), "picked words");
  assert.equal(detailMarkdown(entry("region")), "*no preview*");
});

test("a search hit sits between the image and the preview", () => {
  const page = entry("webpage", {
    primaryPath: "/c/b/content.png",
    markdownPreview: "# Title",
  });
  const md = detailMarkdown(page, {
    before: "…the ",
    match: "Quick",
    after: " brown fox…",
  });
  assert.equal(
    md,
    "![](/c/b/content.png)\n\n> …the **Quick** brown fox…\n\n# Title",
  );
});

test("snippet text can't be read as markup", () => {
  assert.equal(
    snippetMarkdown({
      before: "# not *a* heading ",
      match: "x",
      after: " [l](u)",
    }),
    "> \\# not \\*a\\* heading **x** \\[l\\]\\(u\\)",
  );
  // A match with punctuation at its edge can't be bold reliably.
  assert.equal(
    snippetMarkdown({ before: "uses ", match: "c++", after: " daily" }),
    "> uses `c++` daily",
  );
  assert.equal(escapeMarkdown("a_b <c>"), "a\\_b \\<c\\>");
});

test("stripMarkdownImages drops images, keeps alt text and real links", () => {
  assert.equal(
    stripMarkdownImages(
      "Intro\n\n![chart](https://t.co/a.png)\n\n[![](https://t.co/b.png)](https://x.com)\n\n\n[site](https://x.com)",
    ),
    "Intro\n\nchart\n\n[site](https://x.com)",
  );
});

test("text recognized in an image is not repeated under the image", () => {
  const region = entry("region", {
    primaryPath: "/c/b/content.png",
    contentPath: "/c/b/content.txt",
    contentPreview: "File Edit View",
  });
  region.meta.text = { status: "done", chars: 14, method: "ocr" };
  assert.equal(detailMarkdown(region), "![](/c/b/content.png)");
  // A search hit in that text is still shown in context.
  assert.equal(
    detailMarkdown(region, { before: "File ", match: "Edit", after: " View" }),
    "![](/c/b/content.png)\n\n> File **Edit** View",
  );
});
