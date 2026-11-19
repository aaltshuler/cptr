import { Icon, LaunchProps, List, showToast, Toast } from "@raycast/api";
import {
  useCachedPromise,
  useFrecencySorting,
  usePromise,
} from "@raycast/utils";
import { useEffect, useMemo, useState } from "react";
import {
  CaptureListItem,
  NO_CAPTURES_HINT,
  tagsInUse,
} from "./lib/capture-item";
import {
  BundleEntry,
  matchSnippet,
  scanBundles,
  searchBundles,
} from "./lib/scan";
import { store } from "./lib/support";

export default function Command(props: LaunchProps) {
  const [query, setQuery] = useState(props.fallbackText ?? "");
  const [results, setResults] = useState<BundleEntry[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedID, setSelectedID] = useState<string | null>(null);
  const { data, isLoading, revalidate } = useCachedPromise(
    async () => scanBundles(store().root),
    [],
    {
      keepPreviousData: true,
    },
  );
  const trimmed = query.trim();
  const knownTags = useMemo(() => tagsInUse(data ?? []), [data]);

  useEffect(() => {
    const entries = data ?? [];
    if (!trimmed) {
      setResults(entries);
      setIsSearching(false);
      return;
    }

    let cancelled = false;
    setIsSearching(true);
    const timer = setTimeout(() => {
      void searchBundles(entries, trimmed)
        .then((matches) => {
          if (!cancelled) setResults(matches);
        })
        .catch(async (err) => {
          if (!cancelled) {
            await showToast({
              style: Toast.Style.Failure,
              title: "Search failed",
              message: err instanceof Error ? err.message : String(err),
            });
          }
        })
        .finally(() => {
          if (!cancelled) setIsSearching(false);
        });
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [data, trimmed]);

  // Matches are ranked by use; browsing with no query stays newest-first.
  // (A copy: the hook sorts the array it's given in place.)
  const matches = useMemo(
    () => (trimmed ? [...results] : []),
    [results, trimmed],
  );
  const { data: ranked, visitItem } = useFrecencySorting(matches, {
    namespace: "search",
    key: (entry) => entry.meta.id,
  });
  const shown = trimmed ? ranked : results;

  // Where the query hits in the selected capture — read on selection, not
  // for every row.
  const selected = shown.find((e) => e.meta.id === selectedID) ?? shown[0];
  const { data: hit } = usePromise(
    async (contentPath: string | undefined, q: string) =>
      contentPath && q
        ? { contentPath, q, snippet: await matchSnippet(contentPath, q) }
        : undefined,
    [selected?.contentPath, trimmed],
  );

  return (
    <List
      isLoading={isLoading || isSearching}
      searchText={query}
      onSearchTextChange={setQuery}
      onSelectionChange={setSelectedID}
      filtering={false}
      searchBarPlaceholder="Search text, URL… or kind:pdf app:chrome tag:name"
      isShowingDetail
    >
      <List.EmptyView
        icon={Icon.MagnifyingGlass}
        title={query ? "No matching captures" : "No captures yet"}
        description={
          query
            ? "Try fewer terms. Words match text, title and URL; kind:, app: and tag: narrow"
            : NO_CAPTURES_HINT
        }
      />
      {shown.map((e) => (
        <CaptureListItem
          key={e.meta.id}
          entry={e}
          snippet={
            hit && hit.contentPath === e.contentPath && hit.q === trimmed
              ? hit.snippet
              : undefined
          }
          knownTags={knownTags}
          onUse={() => void visitItem(e)}
          onChanged={revalidate}
        />
      ))}
    </List>
  );
}
