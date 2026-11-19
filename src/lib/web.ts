// Web-page pixels via Chrome's own headless CLI — zero npm dependencies, so
// it works identically inside Raycast's runtime (which loads the built JS
// without node_modules) and outside it.
//
// Quirk this module is built around: modern headless Chrome reliably WRITES
// --print-to-pdf / --screenshot output, then frequently never exits. So a
// render launches Chrome once with a throwaway profile, polls the output
// files until their sizes are stable, then kills the process. --dump-dom is
// not used (stdout is unreliable under kill); textual fallback comes from
// the rendered PDF's text layer (pdftext.ts), read in engines.ts.

import { ChildProcess, execFileSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface RenderedPage {
  /** Viewport screenshot (1280×1000) — the full document lives in `pdf`. */
  png?: Buffer;
  /** Full paginated document. */
  pdf?: Buffer;
}

/** Chromium browsers the render is known to work with, in order of
 * preference. Another one can be picked in the extension's settings. */
const CHROMIUM_APPS = [
  "Google Chrome",
  "Chromium",
  "Brave Browser",
  "Microsoft Edge",
];

const RENDER_TIMEOUT_MS = 30_000;
const FILE_STABLE_MS = 500;
/** Both artifacts come from the same loaded page; once one has landed, the
 * other gets this long before the render settles for what it has. */
const SIBLING_GRACE_MS = 10_000;
const KILL_WAIT_MS = 2_000;
const RENDER_DIR_PREFIX = "cptr-render-";
/** A render lives well under a minute; anything this old was orphaned. */
export const STALE_RENDER_MS = 60 * 60 * 1000;

/** The executable inside a macOS app bundle, or undefined when `appPath`
 * is not one. */
export function appExecutable(appPath: string): string | undefined {
  const macOS = path.join(appPath, "Contents", "MacOS");
  // Almost every app names its executable after itself.
  const named = path.join(macOS, path.basename(appPath, ".app"));
  if (fs.existsSync(named)) return named;
  try {
    const name = execFileSync(
      "/usr/bin/plutil",
      [
        "-extract",
        "CFBundleExecutable",
        "raw",
        "-o",
        "-",
        path.join(appPath, "Contents", "Info.plist"),
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    const executable = path.join(macOS, name);
    return name && fs.existsSync(executable) ? executable : undefined;
  } catch {
    return undefined;
  }
}

/** The browser to render with: the one picked in the settings, else the
 * first known Chromium browser in /Applications or ~/Applications. */
export function findChrome(
  options: { preferredApp?: string; appDirs?: string[] } = {},
): string | undefined {
  const picked = options.preferredApp && appExecutable(options.preferredApp);
  if (picked) return picked;
  const appDirs = options.appDirs ?? [
    "/Applications",
    path.join(os.homedir(), "Applications"),
  ];
  for (const app of CHROMIUM_APPS) {
    for (const dir of appDirs) {
      const executable = appExecutable(path.join(dir, `${app}.app`));
      if (executable) return executable;
    }
  }
  return undefined;
}

/** Render `url` to viewport PNG + full-document PDF with a single page load.
 * Each artifact is best-effort; throws only when no Chromium browser is
 * installed. */
export async function renderPagePixels(
  url: string,
  options: { browserApp?: string } = {},
): Promise<RenderedPage> {
  const chrome = findChrome({ preferredApp: options.browserApp });
  if (!chrome) {
    throw new Error(
      "Web rendering needs Chrome, Chromium, Brave or Edge — or pick another Chromium browser in the extension's settings",
    );
  }
  if (!/^https?:\/\//.test(url)) throw new Error(`Not an http(s) URL: ${url}`);

  sweepStaleRenderDirs();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), RENDER_DIR_PREFIX));
  const pdfPath = path.join(work, "out.pdf");
  const pngPath = path.join(work, "out.png");
  const args = [
    "--headless",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-extensions",
    "--hide-scrollbars",
    "--window-size=1280,1000",
    `--user-data-dir=${path.join(work, "profile")}`,
    "--no-pdf-header-footer",
    `--print-to-pdf=${pdfPath}`,
    `--screenshot=${pngPath}`,
    url,
  ];

  const child = spawn(chrome, args, { stdio: "ignore" });
  try {
    const written = await waitForOutputs([pdfPath, pngPath], child);
    if (!written.has(pdfPath)) console.error(`pdf render failed for ${url}`);
    if (!written.has(pngPath)) console.error(`png render failed for ${url}`);
    return {
      png: written.has(pngPath) ? fs.readFileSync(pngPath) : undefined,
      pdf: written.has(pdfPath) ? fs.readFileSync(pdfPath) : undefined,
    };
  } finally {
    // Awaited, not deferred: a no-view command is unloaded as soon as it
    // settles, which would strand the profile dir in the temp folder.
    await stopProcess(child);
    await removeDir(work);
  }
}

/** Poll `paths` until each exists with a non-zero size that hasn't changed
 * for FILE_STABLE_MS. Returns the ones that got there; gives up on the rest
 * at the timeout, a grace period after the first lands, or Chrome's exit. */
async function waitForOutputs(
  paths: string[],
  child: ChildProcess,
): Promise<Set<string>> {
  let exited = false;
  child.once("exit", () => (exited = true));
  child.once("error", (err) => {
    console.error("chrome failed to start:", err);
    exited = true;
  });

  const deadline = Date.now() + RENDER_TIMEOUT_MS;
  const seen = new Map(paths.map((p) => [p, { size: -1, since: 0 }]));
  const written = new Set<string>();
  let firstWrittenAt: number | undefined;

  for (;;) {
    const now = Date.now();
    // Read before stat-ing: an exit seen here means every write is on disk.
    const finished = exited;
    for (const p of paths) {
      if (written.has(p)) continue;
      const size = fileSize(p);
      const last = seen.get(p)!;
      if (size > 0 && (finished || size === last.size)) {
        if (finished || now - last.since >= FILE_STABLE_MS) written.add(p);
      } else {
        last.size = size;
        last.since = now;
      }
    }
    if (written.size === paths.length || finished || now >= deadline) break;
    if (written.size > 0) {
      firstWrittenAt ??= now;
      if (now - firstWrittenAt >= SIBLING_GRACE_MS) break;
    }
    await sleep(100);
  }
  return written;
}

function fileSize(p: string): number {
  try {
    return fs.statSync(p).size;
  } catch {
    return -1; // not written yet
  }
}

/** Kill the process and wait (briefly) for it to be gone, so its profile dir
 * can be removed right after. */
async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.pid === undefined) return; // never started
  if (child.exitCode !== null || child.signalCode !== null) return;
  const gone = new Promise<void>((resolve) => child.once("exit", resolve));
  child.kill("SIGKILL");
  await Promise.race([gone, sleep(KILL_WAIT_MS)]);
}

async function removeDir(dir: string): Promise<void> {
  try {
    // Chrome's helpers can outlive the kill by a moment and keep writing to
    // the profile — retry instead of leaving it behind.
    await fs.promises.rm(dir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  } catch (err) {
    console.error(`could not remove ${dir} (swept on a later render):`, err);
  }
}

/** Remove render dirs orphaned by a crash or an unloaded command. Returns
 * how many were removed. */
export function sweepStaleRenderDirs(
  tmpRoot: string = os.tmpdir(),
  olderThanMs: number = STALE_RENDER_MS,
): number {
  let removed = 0;
  let names: string[];
  try {
    names = fs.readdirSync(tmpRoot);
  } catch {
    return 0;
  }
  for (const name of names) {
    if (!name.startsWith(RENDER_DIR_PREFIX)) continue;
    const dir = path.join(tmpRoot, name);
    try {
      const stat = fs.statSync(dir);
      if (!stat.isDirectory()) continue;
      if (Date.now() - stat.mtimeMs <= olderThanMs) continue;
      fs.rmSync(dir, { recursive: true, force: true });
      removed++;
    } catch {
      // racing another render's cleanup, or already gone
    }
  }
  return removed;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
