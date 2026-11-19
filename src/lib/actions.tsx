import { Action, Clipboard, Icon, showToast, Toast } from "@raycast/api";
import * as fs from "node:fs";
import { BundleEntry, readBundleText } from "./scan";

/** The complete capture text (lazy full-file read — list entries only hold a
 * bounded preview), or a failure toast. */
async function fullText(
  entry: BundleEntry,
  failureTitle: string,
): Promise<string | undefined> {
  try {
    const text = await readBundleText(entry);
    if (text === undefined) throw new Error("This capture has no text file");
    return text;
  } catch (err) {
    await showToast({
      style: Toast.Style.Failure,
      title: failureTitle,
      message: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

/** Copy the complete capture text. `onDone` runs after a successful copy. */
export function CopyFullTextAction({
  entry,
  onDone,
}: {
  entry: BundleEntry;
  onDone?: () => void;
}) {
  return (
    <Action
      title="Copy Text"
      icon={Icon.Clipboard}
      onAction={async () => {
        const text = await fullText(entry, "Could not copy text");
        if (text === undefined) return;
        await Clipboard.copy(text);
        await showToast({
          style: Toast.Style.Success,
          title: "Copied full capture text",
        });
        onDone?.();
      }}
    />
  );
}

/** Paste the complete capture text into the frontmost app. */
export function PasteFullTextAction({
  entry,
  onDone,
}: {
  entry: BundleEntry;
  onDone?: () => void;
}) {
  return (
    <Action
      title="Paste Text"
      icon={Icon.Text}
      onAction={async () => {
        const text = await fullText(entry, "Could not paste text");
        if (text === undefined) return;
        await Clipboard.paste(text);
        onDone?.();
      }}
    />
  );
}

/** Copy the capture's Markdown (content.md): a web page's reader view, or a
 * PDF with its headings. */
export function CopyMarkdownAction({
  entry,
  onDone,
}: {
  entry: BundleEntry;
  onDone?: () => void;
}) {
  return (
    <Action
      title="Copy Markdown"
      icon={Icon.Document}
      shortcut={{ modifiers: ["cmd", "shift"], key: "m" }}
      onAction={async () => {
        try {
          if (!entry.markdownPath) throw new Error("No Markdown file");
          const markdown = await fs.promises.readFile(
            entry.markdownPath,
            "utf8",
          );
          await Clipboard.copy(markdown);
          await showToast({
            style: Toast.Style.Success,
            title: "Copied Markdown",
          });
          onDone?.();
        } catch (err) {
          await showToast({
            style: Toast.Style.Failure,
            title: "Could not copy Markdown",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }}
    />
  );
}
