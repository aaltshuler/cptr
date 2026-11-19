---
name: capture-process
description: Process and organize a cptr capture archive — folders of captured webpages, text selections, region screenshots, clipboard snippets, and PDFs with per-capture meta.json. Scans for captures not yet organized, classifies them into thematic digest markdown files in processed/, enriches entries with quotes and summaries, extracts PDFs to markdown with anydoc, and refreshes the qmd search index. Use this skill aggressively whenever the user says "organize new captures", "process captures", "organize my captures", mentions the ~/cptr folder or a cptr-style archive (YYYY-MM-DD/HHMMSS-hash folders with meta.json), asks what's new in their captures, wants captured PDFs made searchable, or asks to update/re-index their capture digests.
---

# Capture Processing

Organize a `cptr` capture archive into enriched, searchable thematic digests.

The archive root is `~/cptr` unless the user names another path. Everything below
is relative to that root.

## Archive anatomy

```
<root>/
├── YYYY-MM-DD/                  # one folder per capture day
│   └── HHMMSS-xxxx/             # one folder per capture (time + short hash)
│       ├── meta.json            # kind, source app/url, timestamp, tags, group id, sha256
│       ├── content.md           # webpages and PDFs: markdown (preferred for reading)
│       ├── content.txt          # plain text: the page, the selection, the clipboard,
│       │                        #   or the text recognized in an image
│       ├── content.png          # screenshots and regions (+ thumb.jpg)
│       ├── content.pdf          # PDF captures
│       └── page.pdf             # re-fetched webpages: full-page render
└── processed/
    ├── <topic>-capture.md       # thematic digest files (the output of this skill)
    └── papers/
        └── <slug>.md            # full text of captured PDFs, extracted with anydoc
```

`meta.json` kinds: `webpage`, `selection`, `region`, `screenshot`, `clipboard`,
`pdf` (`content.pdf` + `content.txt` + `content.md`). A re-fetched webpage carries
a `page.pdf` full-page render and no `content.md`; read its `content.txt`. A
`group` id links captures taken together (typically a selection + the page it
came from) — treat a group as one item. Selections made via Raycast may lack
trailing context; the paired webpage capture has the full text.

## Workflow

### 1. Find unprocessed captures

A capture is processed when its folder ID (e.g. `003454-9711`) appears anywhere in
`processed/*.md`. Diff the capture folders against the digests programmatically —
don't eyeball it:

```python
# ids referenced anywhere in processed/*.md vs. all capture dirs on disk
```

Report the count and a one-line inventory (kind, URL, files) before diving in.

### 2. Read each capture

- Webpage → read `content.md` (skim enough to summarize accurately; grab the lead,
  headings, and any pricing/dates/names that matter).
- Selection / clipboard → read `content.txt` in full; the user highlighted this text
  deliberately, so it is the single strongest signal of what they cared about.
- Region or full-screen screenshot → view `content.png` with the Read tool. Describe
  what it shows; screenshots often carry content that exists nowhere else in the
  archive. A `content.txt` next to it holds the text recognized in the image —
  useful for quoting, but look at the image too.
- Bare link captures (a selection that is just a URL, e.g. a YouTube link) → fetch
  metadata rather than filing a naked URL. For YouTube:
  `curl -s "https://www.youtube.com/oembed?url=<url>&format=json"` gives title,
  author, channel, thumbnail without an API key.

### 3. Classify into digests

Digest files live in `processed/` and are named `<topic>-capture.md`
(e.g. `graphs-and-data-capture.md`, `events-capture.md`).

- Fit each capture into an existing digest when the theme genuinely matches.
- A distinct substantial topic deserves its own file — don't wedge a company
  manifesto into a generic "tools" file when it represents its own theme. Multiple
  captures of one theme, or one meaty capture (a manifesto, a long report), justify
  a new digest.
- A capture of a source already in a digest (same URL revisited, a paper's abstract
  page after its PDF) is not a new entry: annotate the existing entry with the
  revisit ("captured twice across two days; clearly a key source"). Repeat captures
  are a relevance signal worth recording.
- Truly unclassifiable items (opaque clipboard strings, blank screenshots) go in an
  "Unclassified" section of the nearest digest with a note about when they were
  captured and a guess at their origin — never silently dropped.

### 4. Write enriched entries

Every capture must end up referenced in exactly one digest (plus the papers file if
it has a PDF). An entry is not a link list — it should let the user recall the
source without opening it. Include:

- **Title, URL, and capture references.** Always reference the specific file, never
  the bare folder: `2026-07-17/003454-9711/content.txt`, not `003454-9711`. Include
  the day prefix. Label what each reference is (webpage, selection, screenshot).
- **Summary** in one or two sentences — what the source is and why it's notable.
- **Verbatim quotes** from selections, blockquoted. The user selected that text on
  purpose; preserve it exactly and attribute it to its capture file.
- **Highlights** — concrete facts pulled from the content: dates, deadlines,
  scores, names, versions, prices. For events/CFPs, surface deadlines prominently
  and note how far off they are.
- **Cross-links** between related entries in different digests ("same thesis from
  the industry side — see X in Y file").
- **Sensitivity flags.** If a capture contains personal data (names, emails,
  contact lists), say so in the entry and warn against republishing.

Each digest starts with an H1, a one-line scope description, and the note that
references point to capture files under the day folders.

### 5. Extract PDFs

Convert every captured PDF to markdown in `processed/papers/` so its full text is
searchable (the digests only summarize):

```bash
anydoc <capture>/<file>.pdf          # firecrawl/anydoc — real GFM: headings, bold, links, tables
```

The capture's own `content.md` is a quick guess from font sizes (headings and
lists, no tables). It is fine for skimming; use `anydoc` for the papers folder.

Collapse any runs of 3+ blank lines, then prepend a provenance header:

```markdown
# <Paper title> (<arXiv id / DOI>)

> Full text extracted with anydoc from `<day>/<id>/<file>.pdf`.
> <Authors, venue, date, license if known.>
> Digest entry: <topic>-capture.md

---
<extracted text>
```

One file per unique paper — if the same PDF was captured twice, note the duplicate
copy's path in the header instead of converting it again. Slug the filename from
the paper, not the capture: `experience-graphs-2606.29823.md`.

If `anydoc` is missing, install it (`bun install -g @firecrawl/anydoc` or
`npm install -g @firecrawl/anydoc`), or fall back to
`mutool convert -F text` (brew `mupdf-tools`) or `pdftotext` — and say which
tool was used in the header.

### 6. Refresh the qmd index

If the archive's `processed/` folder is registered as a qmd collection:

```bash
qmd update    # re-scan collections — REQUIRED first; `qmd embed` alone
qmd embed     # does NOT detect edited files and will report "all hashes embedded"
```

Add a context line for any new subdirectory
(`qmd context add qmd://<collection>/papers "Full text of captured research papers"`)
and verify with one search that only new content can satisfy — a phrase from a
paper body or new entry, not a title. If qmd isn't installed or the collection
isn't registered, skip this step and tell the user what to run later; never
register new global collections during automated processing without being asked.

### 7. Report

Close with: what arrived (count by kind), where each item was filed and why, any
new digest files created, PDFs extracted, index status, and anything flagged
(sensitive data, unclassifiable items, dead links, deadlines discovered).

## Conventions recap

| Rule | Why |
|---|---|
| `<topic>-capture.md` naming | digests sort by topic and are recognizable at a glance |
| Reference specific files with day prefix | references stay clickable/greppable and unambiguous across days |
| Quote selections verbatim | selections are the user's own judgment of what mattered |
| New file per distinct theme | digests stay coherent; themes stay findable |
| Annotate revisits, don't duplicate | repeat capture = relevance signal, duplication = noise |
| Papers as full text + digest summary | search works at two levels: orientation and depth |
| `qmd update` before `qmd embed` | embed alone silently misses edited files |
