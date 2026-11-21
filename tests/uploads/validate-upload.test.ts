import test from "node:test";
import assert from "node:assert/strict";
import { hasZipSignature, MAX_HTML_BYTES, MAX_ZIP_BYTES, validateUploadSelection } from "../../lib/uploads/validate-upload";

test("accepts a ZIP file within the configured limit", () => {
  assert.equal(validateUploadSelection("site.zip", 1024, "zip"), null);
});

test("rejects non-ZIP names and oversized ZIP files", () => {
  assert.match(validateUploadSelection("site.rar", 1024, "zip") ?? "", /\.zip/);
  assert.match(validateUploadSelection("site.zip", MAX_ZIP_BYTES + 1, "zip") ?? "", /25 MB/);
});

test("accepts an HTML file within the configured limit", () => {
  assert.equal(validateUploadSelection("index.html", 512, "html"), null);
  assert.equal(validateUploadSelection("index.htm", 512, "html"), null);
});

test("rejects invalid and oversized HTML files", () => {
  assert.match(validateUploadSelection("index.txt", 512, "html") ?? "", /\.html/);
  assert.match(validateUploadSelection("index.html", MAX_HTML_BYTES + 1, "html") ?? "", /2 MB/);
  assert.match(validateUploadSelection("index.html", 0, "html") ?? "", /empty/);
});

test("recognizes ZIP local, empty archive, and spanning signatures", () => {
  assert.equal(hasZipSignature(Uint8Array.from([0x50, 0x4b, 0x03, 0x04])), true);
  assert.equal(hasZipSignature(Uint8Array.from([0x50, 0x4b, 0x05, 0x06])), true);
  assert.equal(hasZipSignature(Uint8Array.from([0x50, 0x4b, 0x07, 0x08])), true);
  assert.equal(hasZipSignature(Uint8Array.from([0x00, 0x00, 0x00, 0x00])), false);
});

import { hasHtmlDocument } from "../../lib/uploads/validate-upload";

test("recognizes complete HTML documents and rejects plain text", () => {
  assert.equal(hasHtmlDocument(new TextEncoder().encode("<!doctype html><html><body>Hello</body></html>")), true);
  assert.equal(hasHtmlDocument(new TextEncoder().encode("<html lang='en'>")), true);
  assert.equal(hasHtmlDocument(new TextEncoder().encode("just some text")), false);
});
