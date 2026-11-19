// The one list row for a capture — icon, detail pane and actions — shared by
// Search and Recent so the two views can't drift apart.

import {
  Action,
  ActionPanel,
  Alert,
  confirmAlert,
  Icon,
  Image,
  Keyboard,
  List,
  showToast,
  Toast,
  trash,
} from "@raycast/api";
import { getFavicon } from "@raycast/utils";
import {
  CopyFullTextAction,
  CopyMarkdownAction,
  PasteFullTextAction,
} from "./actions";
import { CaptureKind } from "./meta";
import { detailMarkdown } from "./preview";
import { BundleEntry, entryTitle, Snippet } from "./scan";
import { EditTagsForm } from "./tag-form";

export const NO_CAPTURES_HINT =
  "Run Capture Selection, Capture Web Page or Capture Region to add one";

const KIND_ICON: Record<CaptureKind, Icon> = {
  selection: Icon.Text,
  webpage: Icon.Globe,
  screenshot: Icon.Desktop,
  region: Icon.Crop,
  clipboard: Icon.Clipboard,
  pdf: Icon.Document,
};

export function CaptureListItem({
  entry,
  snippet,
  knownTags = [],
  onUse,
  onChanged,
}: {
  entry: BundleEntry;
  /** Where the current search hit, shown above the preview. */
  snippet?: Snippet;
  /** Tags in use across the list, offered by the tag editor. */
  knownTags?: string[];
  /** The capture was copied, pasted or opened (feeds usage ranking). */
  onUse?: () => void;
  /** The capture was deleted or retagged: the list should be read again. */
  onChanged: () => void;
}) {
  const { meta } = entry;
  const title = entryTitle(entry);
  // A capture that is text leads with its text. An image leads with the
  // image, even when text was recognized in it.
  const textLeads = !!entry.contentPath && meta.text.method !== "ocr";
  const textActions = entry.contentPath && (
    <>
      <CopyFullTextAction entry={entry} onDone={onUse} />
      <PasteFullTextAction entry={entry} onDone={onUse} />
    </>
  );
  const fileActions = entry.primaryPath && (
    <>
      <Action.Open
        title="Open File"
        target={entry.primaryPath}
        onOpen={onUse}
      />
      <Action.ToggleQuickLook
        shortcut={Keyboard.Shortcut.Common.ToggleQuickLook}
      />
    </>
  );
  return (
    <List.Item
      id={meta.id}
      icon={iconFor(entry)}
      title={title}
      keywords={keywordsFor(entry)}
      accessories={[{ text: meta.kind }, { date: new Date(meta.created) }]}
      quickLook={
        entry.primaryPath ? { path: entry.primaryPath, name: title } : undefined
      }
      detail={<CaptureDetail entry={entry} snippet={snippet} />}
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            {textLeads ? textActions : fileActions}
            {textLeads ? fileActions : textActions}
          </ActionPanel.Section>
          <ActionPanel.Section>
            {meta.source.url && (
              <Action.OpenInBrowser
                title="Open Source URL"
                url={meta.source.url}
                shortcut={Keyboard.Shortcut.Common.Open}
                onOpen={onUse}
              />
            )}
            <Action.ShowInFinder title="Reveal Bundle" path={entry.dir} />
            {entry.primaryPath && (
              <Action.CopyToClipboard
                title="Copy File"
                content={{ file: entry.primaryPath }}
                shortcut={Keyboard.Shortcut.Common.Copy}
              />
            )}
            {entry.markdownPath && (
              <CopyMarkdownAction entry={entry} onDone={onUse} />
            )}
            <Action.Push
              title="Edit Tags…"
              icon={Icon.Tag}
              shortcut={{ modifiers: ["cmd"], key: "t" }}
              target={
                <EditTagsForm
                  entry={entry}
                  knownTags={knownTags}
                  onSaved={onChanged}
                />
              }
            />
          </ActionPanel.Section>
          <ActionPanel.Section>
            <Action
              title="Delete Capture"
              icon={Icon.Trash}
              style={Action.Style.Destructive}
              shortcut={Keyboard.Shortcut.Common.Remove}
              onAction={() => deleteCapture(entry, onChanged)}
            />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

/** Every tag used by `entries`, sorted: what the tag editor offers. */
export function tagsInUse(entries: BundleEntry[]): string[] {
  return [...new Set(entries.flatMap((entry) => entry.meta.tags))].sort();
}

/** Trash the capture — and, for a collapsed group row, the siblings it
 * stands for, so they don't surface as new rows afterwards. */
async function deleteCapture(
  entry: BundleEntry,
  onDeleted: () => void,
): Promise<void> {
  const siblings = entry.groupDirs ?? [];
  const what =
    siblings.length > 0
      ? `This capture and its page archive (${siblings.length + 1} bundles) move`
      : "The bundle moves";
  const ok = await confirmAlert({
    title: "Delete this capture?",
    message: `${what} to Trash (recoverable).`,
    primaryAction: { title: "Delete", style: Alert.ActionStyle.Destructive },
  });
  if (!ok) return;
  try {
    await trash([entry.dir, ...siblings]);
    await showToast({ style: Toast.Style.Success, title: "Moved to Trash" });
  } catch (err) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Could not delete capture",
      message: err instanceof Error ? err.message : String(err),
    });
  }
  onDeleted();
}

function CaptureDetail({
  entry,
  snippet,
}: {
  entry: BundleEntry;
  snippet?: Snippet;
}) {
  const { meta } = entry;
  const { Label, Link, TagList } = List.Item.Detail.Metadata;
  return (
    <List.Item.Detail
      markdown={detailMarkdown(entry, snippet)}
      metadata={
        <List.Item.Detail.Metadata>
          <Label title="Kind" text={meta.kind} />
          <Label
            title="Captured"
            text={new Date(meta.created).toLocaleString()}
          />
          {meta.source.appName && (
            <Label title="App" text={meta.source.appName} />
          )}
          {meta.source.url && (
            <Link title="URL" target={meta.source.url} text={meta.source.url} />
          )}
          {meta.source.file && <Label title="File" text={meta.source.file} />}
          {meta.group && <Label title="Group" text={meta.group} />}
          {meta.tags.length > 0 && (
            <TagList title="Tags">
              {meta.tags.map((tag) => (
                <TagList.Item key={tag} text={tag} />
              ))}
            </TagList>
          )}
          <Label title="Bundle" text={meta.id} />
        </List.Item.Detail.Metadata>
      }
    />
  );
}

/** Web pages wear their site's favicon, image captures their thumbnail,
 * everything else the icon of its kind. */
function iconFor(entry: BundleEntry): Image.ImageLike {
  const { kind, source } = entry.meta;
  const kindIcon = KIND_ICON[kind] ?? Icon.Circle;
  if (kind === "webpage" && source.url) {
    return getFavicon(source.url, { fallback: kindIcon });
  }
  return entry.thumbPath ? { source: entry.thumbPath } : kindIcon;
}

/** Built-in filtering only sees title + keywords — add what people filter by. */
function keywordsFor(entry: BundleEntry): string[] {
  const { kind, source, tags } = entry.meta;
  let host: string | undefined;
  try {
    host = source.url ? new URL(source.url).hostname : undefined;
  } catch {
    // not a parseable URL — skip the host
  }
  return [kind, source.appName, source.windowTitle, host, ...tags].filter(
    (k): k is string => !!k,
  );
}
