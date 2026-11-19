import assert from "node:assert/strict";
import { test } from "node:test";
import { htmlToPlainText } from "./html";

test("htmlToPlainText keeps structure and decodes common entities", () => {
  const html =
    "<p>Hello&nbsp;<strong>world</strong></p><ul><li>A &amp; B</li><li>&#x1F680;</li></ul>";
  assert.equal(htmlToPlainText(html), "Hello world\n• A & B\n• 🚀");
});

test("htmlToPlainText leaves invalid numeric entities intact", () => {
  assert.equal(htmlToPlainText("<p>&#99999999;</p>"), "&#99999999;");
});

test("htmlToPlainText drops script and style bodies", () => {
  const html =
    "<style>.a{color:red}</style><p>Real</p><script>var x=1;</script><noscript>enable js</noscript><p>Text</p>";
  assert.equal(htmlToPlainText(html), "Real\nText");
});
