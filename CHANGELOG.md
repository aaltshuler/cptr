# Cptr Changelog

## [Initial Version] - {PR_MERGE_DATE}

Version 0.1.0.

- Six capture commands, one per kind: Selection, Web Page, Region, Full Screen, Clipboard and PDF. Each capture is a plain folder with a `meta.json` sidecar.
- Web pages are archived from the live tab through the Raycast Browser Extension (reader Markdown, text and a window screenshot), or re-fetched logged-out by a headless browser.
- PDFs get searchable text and a Markdown version with headings.
- Text in screenshots, regions and clipboard images is recognized on the Mac and made searchable.
- Search Captures: full-text search with `kind:`, `app:` and `tag:` filters, ranked by use. Recent Captures: the newest 100, with previews.
- Tags can be edited from either view, and Markdown copied where a capture has it.
- Reprocess Captures fills in text and Markdown that existing captures lack.
- Settings: the captures folder, archiving the page behind a selection, text recognition, keeping the full-page PDF, and the browser used for a re-fetch.
