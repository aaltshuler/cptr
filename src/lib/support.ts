import {
  Application,
  Cache,
  getFrontmostApplication,
  getPreferenceValues,
} from "@raycast/api";
import { runAppleScript } from "@raycast/utils";
import { execFile } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { SourceInfo } from "./meta";
import { CaptureStore } from "./store";

export const execFileAsync = promisify(execFile);

/** The extension's settings, as declared under "preferences" in
 * package.json. The checkboxes are on by default. */
export interface Prefs {
  capturesDir?: string;
  archiveSelectionPage?: boolean;
  keepPagePDF?: boolean;
  recognizeText?: boolean;
  browserApp?: Application;
}

export function prefs(): Prefs {
  return getPreferenceValues<Prefs>();
}

export function store(): CaptureStore {
  const dir = (prefs().capturesDir?.trim() || "~/cptr").replace(
    /^~(?=\/|$)/,
    os.homedir(),
  );
  return new CaptureStore(path.resolve(dir));
}

// Browsers that tell AppleScript the URL of their front tab. Safari has its
// own wording; Chromium browsers share Chrome's. A browser missing here
// (Firefox and its relatives have no such command) is treated as any other
// app: see "Which tab is meant" in the README.
const BROWSER_TAB_SCRIPTS: Record<string, string> = {
  "com.apple.Safari":
    'tell application "Safari" to return URL of current tab of front window',
  "com.apple.SafariTechnologyPreview":
    'tell application "Safari Technology Preview" to return URL of current tab of front window',
};
for (const bid of [
  "com.google.Chrome",
  "com.google.Chrome.beta",
  "com.google.Chrome.dev",
  "com.google.Chrome.canary",
  "org.chromium.Chromium",
  "com.brave.Browser",
  "com.brave.Browser.beta",
  "com.brave.Browser.nightly",
  "company.thebrowser.Browser",
  "com.microsoft.edgemac",
  "com.microsoft.edgemac.Beta",
  "com.microsoft.edgemac.Dev",
  "com.microsoft.edgemac.Canary",
  "com.vivaldi.Vivaldi",
]) {
  BROWSER_TAB_SCRIPTS[bid] =
    `tell application id "${bid}" to return URL of active tab of front window`;
}

export function isBrowser(bundleId: string | undefined): bundleId is string {
  return !!bundleId && bundleId in BROWSER_TAB_SCRIPTS;
}

/** The app the user is actually in (Raycast itself filtered out). */
export async function userFrontmostApp(): Promise<{
  name?: string;
  bundleId?: string;
}> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const app = await getFrontmostApplication();
      if (app.bundleId !== "com.raycast.macos")
        return { name: app.name, bundleId: app.bundleId };
    } catch {
      // no frontmost app — fall through to retry
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return {};
}

export async function sourceInfo(): Promise<SourceInfo> {
  const app = await userFrontmostApp();
  return {
    ...(app.bundleId ? { app: app.bundleId } : {}),
    ...(app.name ? { appName: app.name } : {}),
  };
}

/** That browser's front-window active tab URL, or undefined. Never the clipboard. */
export async function browserTabURL(
  bundleId: string,
): Promise<string | undefined> {
  const script = BROWSER_TAB_SCRIPTS[bundleId];
  if (!script) return undefined;
  try {
    const url = await runAppleScript(
      `with timeout of 5 seconds\n${script}\nend timeout`,
    );
    return url?.startsWith("http") ? url : undefined;
  } catch {
    return undefined; // Automation denied or no window — caller degrades
  }
}

// AppleScript doesn't expose window ids; CoreGraphics via JXA does. The
// window list is front-to-back, so the first sizeable normal-layer window of
// the app is its front window.
const FRONT_WINDOW_JXA = `
ObjC.import("AppKit");
ObjC.import("CoreGraphics");
function run(argv) {
  var pids = [];
  var apps = $.NSRunningApplication.runningApplicationsWithBundleIdentifier(argv[0]);
  for (var i = 0; i < apps.count; i++) pids.push(apps.objectAtIndex(i).processIdentifier);
  var windows = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(
    $.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements,
    $.kCGNullWindowID)));
  var front = windows.find(function (w) {
    var b = w.kCGWindowBounds;
    return pids.indexOf(w.kCGWindowOwnerPID) >= 0 && w.kCGWindowLayer === 0 &&
      w.kCGWindowAlpha > 0 && b.Width >= 200 && b.Height >= 200;
  });
  return front ? String(front.kCGWindowNumber) : "";
}`;

/** CGWindowID of the app's front on-screen window, for `screencapture -l`. */
export async function frontWindowID(
  bundleId: string,
): Promise<number | undefined> {
  try {
    const out = await runAppleScript(FRONT_WINDOW_JXA, [bundleId], {
      language: "JavaScript",
      timeout: 5_000,
    });
    const id = Number.parseInt(out, 10);
    return Number.isInteger(id) ? id : undefined;
  } catch (err) {
    console.error(`window lookup failed for ${bundleId}:`, err);
    return undefined;
  }
}

export function newGroupID(): string {
  return "g-" + Math.random().toString(16).slice(2, 10);
}

/** Session-spanning freshness guard (Cache-backed — command processes are short-lived). */
const guardCache = new Cache({ namespace: "freshness" });
const WEB_TTL_MS = 600_000;

export function isFreshURL(url: string): boolean {
  const at = guardCache.get(dedupeKey(url));
  return !!at && Date.now() - Number(at) < WEB_TTL_MS;
}

export function recordURL(url: string): void {
  guardCache.set(dedupeKey(url), String(Date.now()));
}

/** Fragment variants are the same document for dedupe purposes. */
function dedupeKey(url: string): string {
  return url.split("#")[0];
}
