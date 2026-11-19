import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as http from "node:http";
import { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import {
  appExecutable,
  findChrome,
  renderPagePixels,
  sweepStaleRenderDirs,
} from "./web";

function renderDirs(root: string): string[] {
  return fs.readdirSync(root).filter((n) => n.startsWith("cptr-render-"));
}

test("stale render dirs are swept; fresh ones and other files are left", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cptr-web-test-"));
  const stale = path.join(root, "cptr-render-stale");
  const fresh = path.join(root, "cptr-render-fresh");
  const other = path.join(root, "someone-elses-dir");
  for (const dir of [stale, fresh, other]) {
    fs.mkdirSync(path.join(dir, "profile"), { recursive: true });
    fs.writeFileSync(path.join(dir, "profile", "file"), "x");
  }
  fs.writeFileSync(path.join(root, "cptr-render-not-a-dir"), "x");
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
  for (const p of [stale, other, path.join(root, "cptr-render-not-a-dir")])
    fs.utimesSync(p, old, old);

  assert.equal(sweepStaleRenderDirs(root, 60 * 60 * 1000), 1);
  assert.deepEqual(fs.readdirSync(root).sort(), [
    "cptr-render-fresh",
    "cptr-render-not-a-dir",
    "someone-elses-dir",
  ]);
  fs.rmSync(root, { recursive: true, force: true });
});

/** A folder shaped like `name`.app, with `executable` inside it. */
function fakeApp(dir: string, name: string, executable = name): string {
  const app = path.join(dir, `${name}.app`);
  fs.mkdirSync(path.join(app, "Contents", "MacOS"), { recursive: true });
  fs.writeFileSync(path.join(app, "Contents", "MacOS", executable), "");
  return app;
}

test("the browser is the one picked, else the first known one found", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cptr-web-test-"));
  const system = path.join(root, "Applications");
  const user = path.join(root, "home", "Applications");
  const appDirs = [system, user];
  assert.equal(findChrome({ appDirs }), undefined);

  // Found in the user's own Applications folder too.
  const edge = fakeApp(user, "Microsoft Edge");
  assert.equal(
    findChrome({ appDirs }),
    path.join(edge, "Contents", "MacOS", "Microsoft Edge"),
  );
  // Chrome is preferred over Edge when both are there.
  const chrome = fakeApp(system, "Google Chrome");
  assert.equal(
    findChrome({ appDirs }),
    path.join(chrome, "Contents", "MacOS", "Google Chrome"),
  );
  // A browser picked in the settings wins, whatever it is called.
  const vivaldi = fakeApp(user, "Vivaldi");
  assert.equal(
    findChrome({ appDirs, preferredApp: vivaldi }),
    path.join(vivaldi, "Contents", "MacOS", "Vivaldi"),
  );
  // A pick that is gone falls back to what is installed.
  assert.equal(
    findChrome({ appDirs, preferredApp: path.join(user, "Gone.app") }),
    path.join(chrome, "Contents", "MacOS", "Google Chrome"),
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test("an app's executable is read from Info.plist when not named after it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cptr-web-test-"));
  const app = fakeApp(root, "Renamed Browser", "browser-bin");
  assert.equal(appExecutable(app), undefined); // no Info.plist to ask
  fs.writeFileSync(
    path.join(app, "Contents", "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>browser-bin</string>
</dict></plist>`,
  );
  assert.equal(
    appExecutable(app),
    path.join(app, "Contents", "MacOS", "browser-bin"),
  );
  assert.equal(appExecutable(path.join(root, "nothing.app")), undefined);
  fs.rmSync(root, { recursive: true, force: true });
});

// Drives the real browser, so it runs where one is installed and stays out
// of CI, where a headless launch is a flake risk rather than a signal.
test(
  "one Chrome launch yields both PNG and PDF and leaves no temp dir",
  { skip: !findChrome() || !!process.env.CI, timeout: 60_000 },
  async () => {
    let requests = 0;
    const server = http.createServer((req, res) => {
      if (req.url === "/page") requests++;
      res.writeHead(req.url === "/page" ? 200 : 404, {
        "content-type": "text/html",
      });
      res.end("<html><body><h1>cptr render probe</h1></body></html>");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    const before = new Set(renderDirs(os.tmpdir()));
    try {
      const page = await renderPagePixels(`http://127.0.0.1:${port}/page`);
      assert.equal(page.png?.subarray(1, 4).toString("latin1"), "PNG");
      assert.equal(page.pdf?.subarray(0, 5).toString("latin1"), "%PDF-");
      assert.equal(requests, 1, "the page should be loaded exactly once");
      const leaked = renderDirs(os.tmpdir()).filter((n) => !before.has(n));
      assert.deepEqual(leaked, []);
    } finally {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  },
);
