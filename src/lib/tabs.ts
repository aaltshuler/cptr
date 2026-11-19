// Which Browser Extension tab a capture means — pure, so it's testable
// without @raycast/api.

export interface TabLike {
  id: number;
  url: string;
  title?: string;
  active: boolean;
}

/** Fragment variants are the same document. */
export function sameDocumentURL(a: string, b: string): boolean {
  return a.split("#")[0] === b.split("#")[0];
}

/** The tab showing `url`: exact match before same-document, and a window's
 * active tab before a background one. */
export function tabForURL<T extends TabLike>(
  tabs: T[],
  url: string,
): T | undefined {
  const ranked = [
    ...tabs.filter((t) => t.active),
    ...tabs.filter((t) => !t.active),
  ];
  return (
    ranked.find((t) => t.url === url) ??
    ranked.find((t) => sameDocumentURL(t.url, url))
  );
}

/** With no browser frontmost, the only http(s) tab that could be meant: the
 * active tab of the single window. Several windows are ambiguous. */
export function soleActiveTab<T extends TabLike>(tabs: T[]): T | undefined {
  const active = tabs.filter((t) => t.active);
  return active.length === 1 && /^https?:/.test(active[0].url)
    ? active[0]
    : undefined;
}
