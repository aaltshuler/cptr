// Live-tab content via the Raycast Browser Extension: reader-mode markdown +
// plain text of the page the user actually sees (logged-in state included).
// Everything degrades to undefined — callers decide what to do without it.

import { BrowserExtension, environment } from "@raycast/api";
import { browserTabURL, isBrowser, userFrontmostApp } from "./support";
import { soleActiveTab, tabForURL } from "./tabs";

export interface TabContent {
  url: string;
  title?: string;
  markdown?: string;
  text?: string;
}

export interface ActiveTab {
  url: string;
  title?: string;
  /** Set when the Browser Extension can see this tab (and so read it). */
  tabId?: number;
}

export function canReadTabs(): boolean {
  return environment.canAccess(BrowserExtension);
}

/** The tab the user means. A frontmost browser is the authority — its own
 * tab URL via AppleScript — because the Browser Extension may live in a
 * different browser. The extension's tab is used alone only when no browser
 * is frontmost (capturing from Finder etc.) and just one window is open. */
export async function activeTab(): Promise<ActiveTab | undefined> {
  const app = await userFrontmostApp();
  if (isBrowser(app.bundleId)) {
    const url = await browserTabURL(app.bundleId);
    if (!url) return undefined;
    const tab = tabForURL(await extensionTabs(), url);
    return { url, title: tab?.title, tabId: tab?.id };
  }
  const tab = soleActiveTab(await extensionTabs());
  return tab && { url: tab.url, title: tab.title, tabId: tab.id };
}

/** Live content of `tab`, when the Browser Extension can see it. */
export async function readActiveTab(
  tab: ActiveTab,
): Promise<TabContent | undefined> {
  if (tab.tabId === undefined) return undefined;
  return readTab(tab.tabId, tab.url, tab.title);
}

/** Live content for a specific URL, when that URL is open in some tab. */
export async function tabContentForURL(
  url: string,
): Promise<TabContent | undefined> {
  const tab = tabForURL(await extensionTabs(), url);
  return tab && readTab(tab.id, tab.url, tab.title);
}

async function extensionTabs(): Promise<BrowserExtension.Tab[]> {
  if (!canReadTabs()) return [];
  try {
    return await BrowserExtension.getTabs();
  } catch (err) {
    console.error("browser extension unavailable:", err);
    return []; // extension not installed / declined / browser closed
  }
}

async function readTab(
  tabId: number,
  url: string,
  title?: string,
): Promise<TabContent | undefined> {
  const [markdown, text] = await Promise.all([
    BrowserExtension.getContent({ format: "markdown", tabId }).catch(
      () => undefined,
    ),
    BrowserExtension.getContent({ format: "text", tabId }).catch(
      () => undefined,
    ),
  ]);
  if (!markdown?.trim() && !text?.trim()) return undefined;
  return {
    url,
    title,
    markdown: markdown?.trim() || undefined,
    text: text?.trim() || undefined,
  };
}
