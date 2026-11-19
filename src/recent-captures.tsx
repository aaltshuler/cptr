import { Icon, List } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import {
  CaptureListItem,
  NO_CAPTURES_HINT,
  tagsInUse,
} from "./lib/capture-item";
import { collapseGroups, scanBundles } from "./lib/scan";
import { store } from "./lib/support";

export default function Command() {
  const { data, isLoading, revalidate } = useCachedPromise(
    async () => collapseGroups(scanBundles(store().root, 400)).slice(0, 100),
    [],
    {
      keepPreviousData: true,
    },
  );

  const entries = data ?? [];
  const knownTags = tagsInUse(entries);

  return (
    <List
      isLoading={isLoading}
      isShowingDetail
      searchBarPlaceholder="Filter recent captures…"
    >
      <List.EmptyView
        icon={Icon.Camera}
        title="No captures yet"
        description={NO_CAPTURES_HINT}
      />
      {entries.map((e) => (
        <CaptureListItem
          key={e.meta.id}
          entry={e}
          knownTags={knownTags}
          onChanged={revalidate}
        />
      ))}
    </List>
  );
}
