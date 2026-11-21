import test from "node:test";
import assert from "node:assert/strict";
import { MAX_ARCHIVE_COMPRESSION_RATIO, MAX_ARCHIVE_ENTRIES, MAX_ARCHIVE_EXPANDED_BYTES, validateArchiveEntryPath, validateArchiveMetadata } from "../../lib/uploads/archive-policy";

test("accepts safe relative archive paths", () => {
  assert.equal(validateArchiveEntryPath("index.html"), null);
  assert.equal(validateArchiveEntryPath("assets/css/site.css"), null);
  assert.equal(validateArchiveEntryPath("assets/"), null);
});

test("rejects traversal, absolute, drive, and backslash paths", () => {
  for (const path of ["../secret", "assets/../../secret", "/etc/passwd", "C:/secret", "assets\\secret"]) assert.notEqual(validateArchiveEntryPath(path), null, path);
});

test("rejects malformed and control-character paths", () => {
  for (const path of ["", "a//b", "./index.html", "a/../b", "bad\0name", "bad\nname"]) assert.notEqual(validateArchiveEntryPath(path), null);
});

test("rejects empty archives and excessive entry counts", () => {
  assert.match(validateArchiveMetadata([]) ?? "", /empty/);
  const many = Array.from({ length: MAX_ARCHIVE_ENTRIES + 1 }, (_, i) => ({ path: `file-${i}.txt`, compressedSize: 1, uncompressedSize: 1 }));
  assert.match(validateArchiveMetadata(many) ?? "", /entries/);
});

test("rejects excessive expanded size and compression ratios", () => {
  assert.match(validateArchiveMetadata([{ path: "large.bin", compressedSize: 1, uncompressedSize: MAX_ARCHIVE_EXPANDED_BYTES + 1 }]) ?? "", /100 MB/);
  assert.match(validateArchiveMetadata([{ path: "bomb.bin", compressedSize: 1, uncompressedSize: MAX_ARCHIVE_COMPRESSION_RATIO + 1 }]) ?? "", /compression ratio/);
});

test("accepts metadata within configured limits", () => {
  assert.equal(validateArchiveMetadata([{ path: "index.html", compressedSize: 100, uncompressedSize: 500 }, { path: "assets/site.css", compressedSize: 50, uncompressedSize: 150 }]), null);
});

test("rejects invalid size metadata", () => {
  assert.match(validateArchiveMetadata([{ path: "file", compressedSize: -1, uncompressedSize: 5 }]) ?? "", /safe integers/);
});