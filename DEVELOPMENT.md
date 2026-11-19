# Developing cptr

## Commands

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

## Layout

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

## Constraints

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
- **`skills/` is reserved.** Raycast's build treats a top-level `skills/`
  folder as skills for its own AI, which is why the Claude Code skill lives
  in `companion/`.

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
one window with one active tab.

Adding a browser means adding its bundle id to `BROWSER_TAB_SCRIPTS` in
`src/lib/support.ts`. Chrome is the one in daily use. The other Chromium
browsers share its AppleScript wording, and their beta, dev and canary
builds are listed by bundle id without having been tried.

## Not built

In rough order of interest:

1. Raycast AI tools (`capture-page`, `search-archive`), so that Raycast AI
   can save pages and answer from the archive.
2. `AI.ask` titles and tags written to `meta.ai` after a capture. The schema
   already has `ai` {`title`, `tags`} and `geometry`; nothing writes them.
3. A menu-bar command with today's count and recents.

Smaller: a Grid view for image kinds, "Copy Link to Capture" deeplinks, a
live capture count on Recent Captures, text for scanned PDFs, an `@dark`
icon.

Deliberately out: a Services menu item, a `cptr://` URL scheme, a login
item or clipboard watcher, and a one-gesture "smart" capture that guesses
the kind.
