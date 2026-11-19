import assert from "node:assert/strict";
import { test } from "node:test";
import { sameDocumentURL, soleActiveTab, tabForURL, TabLike } from "./tabs";

const tab = (id: number, url: string, active: boolean): TabLike => ({
  id,
  url,
  active,
});

test("tabForURL prefers an exact match, then the same document", () => {
  const tabs = [
    tab(1, "https://a.com/x#frag", true),
    tab(2, "https://a.com/x", false),
  ];
  assert.equal(tabForURL(tabs, "https://a.com/x")?.id, 2);
  assert.equal(tabForURL(tabs, "https://a.com/x#other")?.id, 1);
  assert.equal(tabForURL(tabs, "https://b.com/"), undefined);
});

test("tabForURL prefers a window's active tab over a background one", () => {
  const tabs = [
    tab(1, "https://a.com/", false),
    tab(2, "https://a.com/", true),
  ];
  assert.equal(tabForURL(tabs, "https://a.com/")?.id, 2);
});

test("soleActiveTab only answers when one window could be meant", () => {
  assert.equal(
    soleActiveTab([
      tab(1, "https://a.com/", true),
      tab(2, "https://b.com/", false),
    ])?.id,
    1,
  );
  // Two windows: ambiguous, never guess.
  assert.equal(
    soleActiveTab([
      tab(1, "https://a.com/", true),
      tab(2, "https://b.com/", true),
    ]),
    undefined,
  );
  assert.equal(soleActiveTab([tab(1, "chrome://newtab/", true)]), undefined);
  assert.equal(soleActiveTab([]), undefined);
});

test("sameDocumentURL ignores fragments only", () => {
  assert.equal(sameDocumentURL("https://a.com/x#1", "https://a.com/x"), true);
  assert.equal(
    sameDocumentURL("https://a.com/x?q=1", "https://a.com/x"),
    false,
  );
});
