// The tag editor pushed from a capture's row: pick from the tags already in
// use, type new ones, save to the bundle's meta.json.

import {
  Action,
  ActionPanel,
  Form,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { parseTags } from "./plan";
import { BundleEntry, entryTitle } from "./scan";
import { store } from "./support";

export function EditTagsForm({
  entry,
  knownTags,
  onSaved,
}: {
  entry: BundleEntry;
  /** Tags in use across the archive, offered in the picker. */
  knownTags: string[];
  onSaved: () => void;
}) {
  const { pop } = useNavigation();
  const current = entry.meta.tags;
  const options = [...new Set([...current, ...knownTags])].sort();

  async function save(values: { tags?: string[]; more: string }) {
    const tags = [
      ...new Set([...(values.tags ?? []), ...parseTags(values.more)]),
    ];
    try {
      store().setTags(entry.meta.id, tags);
      await showToast({
        style: Toast.Style.Success,
        title: tags.length > 0 ? `Tagged ${tags.join(", ")}` : "Tags removed",
      });
      onSaved();
      pop();
    } catch (err) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Could not save tags",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <Form
      navigationTitle="Edit Tags"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save Tags" onSubmit={save} />
        </ActionPanel>
      }
    >
      <Form.Description title="Capture" text={entryTitle(entry)} />
      {options.length > 0 && (
        <Form.TagPicker id="tags" title="Tags" defaultValue={current}>
          {options.map((tag) => (
            <Form.TagPicker.Item key={tag} value={tag} title={tag} />
          ))}
        </Form.TagPicker>
      )}
      <Form.TextField
        id="more"
        title={options.length > 0 ? "New Tags" : "Tags"}
        placeholder="agents, memory, to read"
        info="Separate tags with commas. Search finds them with tag:name."
      />
    </Form>
  );
}
