import assert from "node:assert/strict";
import { test } from "node:test";
import { clipboardFilePath } from "./paths";

test("plain paths pass through unchanged", () => {
  assert.equal(clipboardFilePath("/Users/a/pic.png"), "/Users/a/pic.png");
});

test("file:// URIs are converted with percent-decoding", () => {
  assert.equal(
    clipboardFilePath("file:///Users/a%20b/pic%20one.png"),
    "/Users/a b/pic one.png",
  );
});
