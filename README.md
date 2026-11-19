# cptr

Deliberate capture for macOS, as a [Raycast](https://raycast.com) extension.
Selected text, web pages, screenshots, the clipboard and PDFs are saved as
plain folders under `~/cptr` and found again with full-text search.

No database, no background process, no account. Every capture is a folder of
files that you can read, sync, back up or hand to another tool.

## Features

- **Six capture commands**, one per kind, so each can have its own hotkey:
  selection, web page, region, full screen, clipboard, PDF.
- **Web pages as you see them.** An open tab is read through the Raycast
  Browser Extension, logged-in content included, and saved as Markdown, text
  and a screenshot. A URL that is not open is rendered by a headless browser.
- **Selections keep their source.** A selection made in a browser records
  the URL and archives the page next to it.
- **Text in images.** Screenshots, regions and copied images are read by
  macOS, so search finds the words in them.
- **PDFs as text and Markdown**, from Finder or from a browser tab.
- **Full-text search** across everything, with `kind:`, `app:` and `tag:`
  filters, previews, tags and copy as Markdown.
- **Reprocessing.** One command brings older captures up to what a new
  capture gets.
- **Local.** Text recognition and PDF extraction run on your Mac, and there
  are no analytics.

## Install

Needs macOS, Raycast and Node 22.22.2 or later. Paste this into a coding
agent such as Claude Code:

```text
Install the cptr Raycast extension from https://github.com/aaltshuler/cptr on this Mac.

1. Check that Raycast is running and that Node is 22.22.2 or later. If either is missing, stop and tell me.
2. Clone the repo into the folder where I keep code. Not into ~/cptr: that is where captures are saved.
3. In the clone, run `npm install`.
4. Run `npm run dev`, wait for "built extension successfully", then stop it. This adds the extension to Raycast.
5. Run `npm run build` to replace the development build with the production one.
6. Read "After installing" in the README and tell me what is left for me to do in Raycast.
```

To update later: `git pull && npm install && npm run build` in the clone.

### After installing

- **Hotkeys or aliases.** Set them on the commands in Raycast. The aliases
  in the [Commands](#commands) table work well.
- **Permissions.** They belong to Raycast and are requested on first use:
  Accessibility for selections, Screen Recording for screenshots, Automation
  for a browser's tab URL. Quit and reopen Raycast after granting one.
- **Optional: the [Raycast Browser Extension](https://www.raycast.com/browser-extension).**
  It reads the open tab. Without it, a selection is saved without its page
  and every web page is re-fetched logged out.
- **Optional: Chrome, Chromium, Brave or Edge.** One of them renders the
  pages that are re-fetched.

## Commands

| Command | Alias | What it does |
|---|---|---|
| Capture Selection | `cs` | Saves the selected text; in a browser, also the page it came from. |
| Capture Web Page | `cw` | Archives the frontmost browser tab, or the URL given as its argument. |
| Capture Region | `cr` | Saves a region you drag (Esc cancels, space switches to window mode). |
| Capture Full Screen | `cf` | Saves the main display. |
| Capture Clipboard | `cc` | Saves the clipboard text, or a copied image file. |
| Capture PDF | `cp` | Archives the PDFs selected in Finder, or the PDF open in the frontmost browser tab. |
| Search Captures | `sc` | Full-text search across every capture. |
| Recent Captures | `rc` | The newest 100 captures, with previews. |
| Reprocess Captures | | Fills in text and Markdown that existing captures lack. |

## Kinds

Each capture command saves one kind. You name the kind; nothing guesses it.
The kind is recorded in `meta.json` and decides which files the folder holds.

| Kind | Command | Files |
|---|---|---|
| `selection` | Capture Selection | `content.txt` |
| `webpage` | Capture Web Page | Open tab: `content.md`, `content.txt`, `content.png`<br>Re-fetched: `content.png`, `page.pdf`, `content.txt` |
| `region` | Capture Region | `content.png`, `content.txt` |
| `screenshot` | Capture Full Screen | `content.png`, `content.txt` |
| `clipboard` | Capture Clipboard | `content.txt`, or `content.<ext>` and `content.txt` |
| `pdf` | Capture PDF | `content.pdf`, `content.txt`, `content.md` |

- Every folder also holds a `meta.json`. Images and PDFs get a `thumb.jpg`.
- `content.txt` is what search reads. For an image it holds the recognized
  text, and it is absent when there is none.
- A web page has two sources, never mixed. An **open tab** is read as you
  see it: reader-mode Markdown, text and a screenshot of the browser window.
  A page that is **not open** is loaded once, logged out, by a headless
  browser: a screenshot, a full-page PDF and the text from it. A URL that
  serves a PDF becomes a `pdf` capture.
- A selection and its page share a `group` id and show as one row in Recent
  Captures. A page archived in the last 10 minutes is not archived again.

## Search and Recent

**Search Captures** matches every word of the query against each capture's
text and metadata (app, title, URL, file name, tags), ranked by how often
and how recently you used a capture. Three filters narrow it:

| Filter | Matches |
|---|---|
| `kind:pdf` | Captures of that kind. A prefix is enough: `kind:web`, `kind:sel`. |
| `app:chrome` | Captures whose app name or bundle id contains the value. |
| `tag:agents` | Captures with that tag. Several `tag:` filters must all match. |

**Recent Captures** lists the newest 100 with previews.

Both show the same row and the same actions: ⏎ Copy Text · ⌘⏎ Paste Text ·
Open File · ⌘Y Quick Look · ⌘O Open Source URL · Reveal Bundle · ⌘⇧C Copy
File · ⌘⇧M Copy Markdown · ⌘T Edit Tags · ⌃X Delete (to the Trash).

**Reprocess Captures** fills in what older captures lack: text and Markdown
for PDFs, text for images that were never read, and a final state for
captures left `pending` by an interrupted command. Its scope is "Missing
Only" by default; "Everything" extracts again even where text exists.

## Settings

| Setting | Default | Effect |
|---|---|---|
| Captures Folder | `~/cptr` | Where captures are saved. |
| Also archive the page a selection came from | on | Off: a selection in a browser is saved on its own. |
| Recognize text in images | on | Off: screenshots, regions and clipboard images are saved without text. |
| Keep the full-page PDF | on | Off: a re-fetched page keeps its text and screenshot but not `page.pdf`, the largest file in a capture. |
| Browser for Re-Fetch | first of Chrome, Chromium, Brave, Edge | The Chromium browser that renders a page that is not open in a tab. |

## Bundle format

A selection captured at 14:32:01:

```
~/cptr/2026-11-16/143201-9f3a/
  meta.json
  content.txt
```

```json
{
  "v": 1,
  "id": "2026-11-16/143201-9f3a",
  "kind": "selection",
  "created": "2026-11-16T14:32:01.412+03:00",
  "sha256": "9f3a…",
  "source": { "app": "com.google.Chrome", "appName": "Google Chrome", "url": "https://example.com/article" },
  "text": { "status": "done", "chars": 342, "method": "raycast" },
  "tags": [],
  "group": "…"
}
```

- **Folder name:** the time, then four hex digits of the content's hash.
- **`text.status`:** `done`, `none`, or `pending` while text is still being
  extracted.
- **`text.method`:** where the text came from: `raycast` (selection),
  `pasteboard`, `dom` (open tab), `pdfjs` (a PDF's text layer) or `ocr`
  (recognized in an image).
- **Writes are atomic:** a capture is staged in a hidden folder and renamed
  into place, so a crash never leaves a visible half-capture.

## What leaves your Mac

Captures stay in the Captures Folder. The network is used in three places:

- **Re-fetch.** A page that is not open in a readable tab is requested from
  its site, logged out, with a throwaway browser profile. This spends a
  one-time link.
- **PDF in a browser tab.** Capture PDF downloads the tab's URL, logged out.
- **Favicons.** Search and Recent look up a web page's favicon by hostname,
  through Raycast.

## Limits

- A PDF tab behind a login can't be downloaded. Capture the file from
  Finder.
- A PDF's Markdown is a guess from font sizes: headings and lists, no
  tables. A scanned PDF has no text layer and gets no text.
- Tab URLs are read from Safari, Chrome, Chromium, Brave, Edge, Arc and
  Vivaldi. In other browsers, such as Firefox, a selection is saved without
  its page.

## Scripting

Raycast deeplinks run a command from outside:

```
raycast://extensions/aaltshuler/cptr/capture-clipboard?launchType=background
raycast://extensions/aaltshuler/cptr/capture-web?launchType=background&arguments={"url":"https://…"}
```

The archive is plain files, so an agent can work on it directly.
[`companion/capture-process`](companion/capture-process/SKILL.md) is an
optional Claude Code skill that sorts new captures into thematic digests.
Copy the folder into `~/.claude/skills/` to use it.

## Development

Commands, layout and the constraints the Raycast build imposes are in
[DEVELOPMENT.md](DEVELOPMENT.md).

## License

[MIT](LICENSE)
