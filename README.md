# cptr

Deliberate capture for macOS, as a [Raycast](https://raycast.com) extension.
Selected text, web pages, screenshots, the clipboard and PDFs are saved as
plain folders ("bundles") under `~/cptr/<date>/<id>/`, each with a
`meta.json` sidecar, and found again with full-text search.

There is no database, no daemon and no menu-bar process. Everything is a
file you can read, sync, back up or hand to another tool. cptr asks for no
permissions of its own: Raycast's runtime, hotkeys and grants do the work.

## Install

Needs macOS, Raycast 2 and Node 22.22.2 or later.

```bash
git clone https://github.com/aaltshuler/cptr.git && cd cptr
npm install
npm run build      # builds and installs into Raycast
```

Then, in Raycast:

- Give the commands aliases or hotkeys (suggestions in the table below).
- Look through the extension's [settings](#settings).
- Optionally enable Search Captures under **Manage Fallback Commands**, so
  root-search text with no match lands in the search.

Two optional pieces. Without them the affected command says what is missing
and everything else keeps working:

- **Raycast Browser Extension** reads the live tab, including logged-in
  content. Without it, a selection is saved without its page, and Capture
  Web Page falls back to a logged-out re-fetch.
- **A Chromium browser** (Chrome, Chromium, Brave or Edge, or one you pick
  in the settings) is used only for that re-fetch.

Permissions belong to Raycast, not to cptr: Accessibility for selections,
Screen Recording for screenshots, Automation for reading a browser's tab
URL. After granting one, quit and reopen Raycast.

## Commands

| command | alias | what it does |
|---|---|---|
| Capture Selection | `cs` | saves the selected text; in a browser, also the page it came from |
| Capture Web Page | `cw` | archives the frontmost browser tab, or the URL given as its argument |
| Capture Region | `cr` | saves a region you drag (Esc cancels, space switches to window mode) |
| Capture Full Screen | `cf` | saves the main display |
| Capture Clipboard | `cc` | saves the clipboard text, or a copied image file |
| Capture PDF | `cp` | archives the PDFs selected in Finder, or the PDF open in the frontmost browser tab |
| Search Captures | `sc` | full-text search across every bundle |
| Recent Captures | `rc` | the newest 100 captures, with previews |
| Reprocess Captures | | fills in text and Markdown that existing bundles lack |

Each kind has its own command because a Raycast alias or hotkey can't
pre-fill an argument. Capture is deliberate: you name the kind, nothing
guesses it.

Every capture ends in a HUD (`✓ Captured — 342 chars from Chrome`) or in a
failure toast that names the fix. A cancelled region saves nothing and says
nothing.

## Settings

| setting | default | what it changes |
|---|---|---|
| Captures Folder | `~/cptr` | where bundles are saved |
| Also archive the page a selection came from | on | off: a selection in a browser is saved on its own |
| Recognize text in images | on | off: screenshots, regions and clipboard images are saved without text |
| Keep the full-page PDF | on | off: a re-fetched page keeps its text and screenshot but not `page.pdf`, the largest file in a bundle |
| Browser for Re-Fetch | first of Chrome, Chromium, Brave, Edge | which Chromium browser renders a page that is not open in a readable tab |

## How each capture works

**Selection.** Read through Raycast's `getSelectedText()`. Some apps don't
expose their selection; the failure toast then points to Capture Clipboard.
In a [supported browser](#browsers) the tab URL is recorded as the source.
If the Browser Extension can read that tab and the page wasn't archived in
the last 10 minutes, the live page is archived right after the HUD as a
second bundle sharing a `group` id with the selection. Selection context is
never fetched from the network.

**Web page.** With no argument, the frontmost browser tab; with a URL (a
bare `example.com` gets `https://`), that page. A "Capturing page…" toast
shows while it works. There are two sources, never mixed in one bundle:

- *Live tab* (the page is open and the Browser Extension can read it):
  reader-mode Markdown, plain text, and a screenshot of the browser window
  itself, taken only while the window still shows that URL.
- *Re-fetch* (no readable tab): a URL that serves a PDF goes to PDF capture.
  Anything else is loaded logged-out by a headless browser, in one launch
  and one page load: a viewport screenshot plus a full-page `page.pdf`, with
  the text extracted from that PDF.

**Region and full screen.** macOS `screencapture`: the native crosshair for
a region, the main display for full screen. After the HUD, the text in the
image is recognized by macOS's Vision framework and saved for search.

**Clipboard.** A copied image file is copied into the bundle and its text
recognized; any other copied file is kept as a path reference; otherwise the
text is saved (HTML is converted only when there is no plain text). A
clipboard holding just a URL also gets that URL as its source.

**PDF.** Finder files are read one at a time; one that can't be read is
named in the HUD and doesn't stop the rest. A PDF in a browser tab is
downloaded logged-out, up to 100 MB. After the HUD, one bundle at a time,
the text is extracted for search and a Markdown version is written next to
it: headings and lists, as far as font sizes give them away.

Work that outlives the HUD (the page behind a selection, PDF text, text in
an image) keeps the command alive until it finishes. If it fails, a toast
says so and the capture itself is already saved.

## Search and Recent

Both views show the same row.

- **Icon:** the site's favicon for web pages, the thumbnail for images and
  PDFs, otherwise an icon for the kind.
- **Preview:** the capture at full size when it is an image; the start of
  the Markdown for a web page or a PDF, with remote images stripped so that
  previewing an archive never calls the original site; otherwise the first
  1,200 characters of text. Below it: kind, time, app, URL, file, group,
  tags and bundle id.
- **Actions:** ⏎ Copy Text · ⌘⏎ Paste Text · Open File · ⌘Y Quick Look ·
  ⌘O Open Source URL · Reveal Bundle · ⌘⇧C Copy File · ⌘⇧M Copy Markdown ·
  ⌘T Edit Tags · ⌃X Delete (to Trash). An image leads with Open File, even
  when text was recognized in it.

**Search Captures** matches every word of the query against the metadata
(kind, app, title, URL, file, id, tags) and the first 1 MB of each bundle's
text. Three filters narrow it:

| filter | matches |
|---|---|
| `kind:pdf` | captures of that kind; a prefix is enough (`kind:web`, `kind:sel`) |
| `app:chrome` | captures whose app name or bundle id contains the value |
| `tag:agents` | captures carrying that tag; several `tag:` filters must all match |

For the selected row, the hit is shown in context above the preview.
Matches are ranked by how often and how recently you used them (copy, paste
and open count); with no query the list is newest-first.

**Recent Captures** lists the newest 100 rows. A selection and its page
archive collapse into one row, and deleting that row trashes both. Raycast's
own filter runs over title, kind, app, window title, host and tags.

**Tags** are edited from either view (⌘T): pick from the tags already in
use or type new ones, separated by commas. They are stored in `meta.json`.

## Reprocess Captures

Brings existing bundles up to what a fresh capture gets:

- text and Markdown for PDFs, and text for re-fetched pages, that were read
  by an older engine;
- text for screenshots, regions and clipboard images that were never read;
- a final state for bundles left `pending` by a command that died.

It works through the archive one bundle at a time and shows its progress.
The **Scope** argument is "Missing Only" by default; "Everything" extracts
again even where text exists, which is useful after an engine improved. A
live-tab page is never redone, because its source is gone.

## Bundle format

A selection captured at 14:32:01:

```
~/cptr/2026-11-16/143201-9f3a/
  meta.json
  content.txt
```

Files by kind, next to `meta.json`:

| kind | files |
|---|---|
| selection | `content.txt` |
| clipboard | `content.txt`, or `content.<ext>` + `thumb.jpg` for an image, and `content.txt` when it holds text |
| region, screenshot | `content.png`, `thumb.jpg`, and `content.txt` when the image holds text |
| pdf | `content.pdf`, `thumb.jpg`, and once extracted `content.txt` and `content.md` |
| webpage, live tab | `content.md`, `content.txt`, and `content.png` + `thumb.jpg` when the window could be shot |
| webpage, re-fetch | `content.png`, `page.pdf`, `thumb.jpg`, `content.txt` |

- **Id:** `yyyy-MM-dd/HHmmss-<4 hex of the sha256>`, with `-2`, `-3`… on a
  collision.
- **`meta.json` (v1):** `kind`, `created` (ISO 8601 with local offset),
  `sha256` of the primary file, `source` {`app`, `appName`, `windowTitle`,
  `url`, `file`}, `text` {`status`, `chars`, `method`}, `tags`, `group`.
- **`text.status`:** `done`, `none`, or `pending` while text is still being
  extracted.
- **`text.method`:** where the text came from: `raycast` (selection),
  `pasteboard`, `dom` (live tab), `pdfjs` (a PDF's text layer) or `ocr`
  (recognized in an image). With status `none` it records what was tried.
  Bundles written before 0.1 may say `pdfkit`; Reprocess Captures updates
  them.
- **`content.md` and `content.txt`:** search and Copy Text use
  `content.txt`; the Markdown is for the preview, for reading and for Copy
  Markdown.
- **`thumb.jpg`:** a 256 px JPEG.
- **Writes are atomic:** a bundle is staged in a hidden `.tmp-*` folder and
  renamed into place, so a crash never leaves a visible half-bundle. Stale
  staging folders are removed during scans.

The schema also has `geometry` and `ai` {`title`, `tags`}; the extension
doesn't write them yet.

## Browsers

| | which browsers |
|---|---|
| Tab URL of the frontmost browser | Safari, Safari Technology Preview, Chrome, Chromium, Brave, Edge (including their beta, dev and canary builds), Arc, Vivaldi |
| Live tab content | any browser with the Raycast Browser Extension |
| Re-fetch | Chrome, Chromium, Brave or Edge in `/Applications` or `~/Applications`, or the Chromium browser picked in the settings |

**Which tab is meant.** When a listed browser is frontmost, its own tab URL
(asked through AppleScript) is the authority, because the Browser Extension
may live in a different browser. In any other app, including a browser that
is not listed (Firefox and its relatives have no AppleScript command for the
tab URL), the Browser Extension's tab is used only when it is unambiguous:
one window with one active tab. There, Capture Web Page works and a
selection is saved without its page.

Adding a browser means adding its bundle id to `BROWSER_TAB_SCRIPTS` in
`src/lib/support.ts`. Chrome is the one in daily use. The other Chromium
browsers share its AppleScript wording, and their beta, dev and canary
builds are listed by bundle id without having been tried.

## What leaves your Mac

Captures stay in the Captures Folder. Text recognition and PDF extraction
run locally, and there is no analytics. The network is used in three places:

- **Re-fetch.** Capture Web Page on a URL that is not open in a readable tab
  sends a `HEAD` request to that URL and then loads it once in a headless
  browser, logged out, with a throwaway profile.
- **PDF in a browser tab.** Capture PDF downloads the tab's URL, logged out.
- **Favicons.** Search and Recent show a web page's favicon through
  Raycast's `getFavicon` helper, which looks it up by the page's hostname.

A live tab is read through the Raycast Browser Extension and is not
requested again.

## Scripting

Raycast deeplinks run a command from outside (Raycast confirms the first
deeplink launch of each command):

```
raycast://extensions/aaltshuler/cptr/capture-clipboard?launchType=background
raycast://extensions/aaltshuler/cptr/capture-web?launchType=background&arguments={"url":"https://…"}
```

Because a bundle is a folder of plain files, anything else can read the
archive too. [`companion/capture-process`](companion/capture-process/SKILL.md)
is a skill for Claude Code that sorts new captures into thematic digest
files with quotes and summaries. It is optional and independent of the
extension: copy the folder into `~/.claude/skills/` to use it. (It is not in
a top-level `skills/` folder because Raycast reserves that name for skills
of its own AI.)

## Development

```bash
npm run dev        # ray develop: builds, installs into Raycast, watches
npm test           # node:test via tsx, everything in src/lib/*.test.ts
npx tsc --noEmit && npx eslint . && npx prettier --check "src/**/*.{ts,tsx}"
```

`npm run build` (`ray build -e dist`) is not a dry run. Like `npm run dev`,
it writes into `~/.config/raycast/extensions/cptr/`, so Raycast runs
whatever was built last. To build without installing, give it a folder:
`npx ray build -e dist -o /tmp/cptr-build`. CI runs the tests, the three
checks above and the build.

```
src/capture-*.ts          six no-view commands, one per kind
src/reprocess-captures.ts no-view command over the whole archive
src/search-captures.tsx   view commands
src/recent-captures.tsx
src/lib/
  run.ts                  command runner: HUD, failure toast, follow-up work
  engines.ts              selection · web · region · screen · clipboard · pdf
  plan.ts · tabs.ts       pure decisions: what to write, which tab is meant
  browser.ts              live tab through the Raycast Browser Extension
  web.ts                  headless-browser re-fetch (PNG + PDF)
  pdf.ts · thumb.ts       PDF download and naming · thumbnails
  pdftext.ts              PDF text (unpdf) and Markdown (pdf2md, tidied)
  ocr.ts                  text in an image (macOS Vision through osascript)
  reprocess.ts            what an existing bundle lacks, and filling it in
  store.ts · meta.ts      bundle format v1, atomic writes
  scan.ts · preview.ts    scan, search, hit snippets · preview markdown
  capture-item.tsx        the row shared by Search and Recent
  tag-form.tsx            the tag editor
```

Tests cover the modules that don't import `@raycast/api`. A decision an
engine makes belongs in one of those (`plan.ts`, `tabs.ts`, `preview.ts`,
`reprocess.ts`) so that it stays testable; `engines.ts` only gathers the
inputs and performs the result. Three tests drive real tools and skip
themselves in CI: the headless-browser render, the Quick Look PDF thumbnail
and the text recognition.

Constraints learned the hard way:

- **A dependency must survive being repackaged.** The build bundles each
  dependency into one file, `node_modules/<name>/__bundle.js`, next to the
  commands, and loads it on first use. A package with a native addon (a
  `.node` file) is refused by the build. One that reads its own files by
  path builds fine and then fails at runtime. That is why PDF text goes
  through `unpdf`, whose pdf.js build needs no worker file and no native
  canvas, why text recognition calls the system's own framework, and why
  the re-fetch drives a browser's command line instead of puppeteer. After
  adding or upgrading a dependency, build to a folder and run the packaged
  file, not the one in the repo's `node_modules`.
- **One build per package.** A dependency gets its own file only when every
  import of it resolves to the same file. `unpdf` ships an ESM and a
  CommonJS build, and `pdf2md` requires the CommonJS one, so `pdftext.ts`
  uses `require()` too. With `import()` there, pdf.js was inlined into three
  commands at 1.6 MB each.
- **The worker heap is small.** Keep the dependency footprint lean: pdf.js
  (inside `unpdf`) is 1.6 MB once packaged, and is loaded only when a PDF's
  text is extracted.
- **A headless browser writes its output and then often never exits.**
  `web.ts` polls for stable output files and kills the process; it never
  waits for exit.
- **A no-view command is unloaded the moment it settles.** Cleanup on a
  timer may never run, so it is awaited. Work that must outlive the HUD is
  returned as a `followUp` promise, which the runner awaits.

## Limits

- The re-fetch is logged-out and requests the URL again (a HEAD probe and
  one page load), so a one-time link is spent by it. It runs only for an
  explicit Capture Web Page with no readable tab.
- A PDF tab behind a login can't be downloaded; capture the file from Finder.
- The live-tab window screenshot needs Screen Recording and Automation
  access. Without them the capture keeps the text and Markdown only.
- A PDF's Markdown is a guess from font sizes: headings and lists, no
  tables, and a heading that wraps onto a second line comes out as two. The
  guess fails too often on browser-printed pages, so a re-fetched page gets
  text only.
- Text recognition reads what is legible in the image; it does not describe
  pictures. Text drawn directly on a transparent background is not read.
- A scanned PDF has no text layer and gets no text.
- A bundle whose command dies during text extraction stays `pending` until
  Reprocess Captures is run.
- The scan is synchronous. On 5,000 synthetic bundles it took about a
  quarter of a second and a search about a tenth; there is no index.

## Not built

In rough order of interest:

1. Raycast AI tools (`capture-page`, `search-archive`), so that Raycast AI
   can save pages and answer from the archive.
2. `AI.ask` titles and tags written to `meta.ai` after a capture.
3. A menu-bar command with today's count and recents.

Smaller: a Grid view for image kinds, "Copy Link to Capture" deeplinks, a
live capture count on Recent Captures, text for scanned PDFs, an `@dark`
icon.

Deliberately out: a Services menu item, a `cptr://` URL scheme, a login
item or clipboard watcher, and a one-gesture "smart" capture that guesses
the kind.

## License

[MIT](LICENSE)
