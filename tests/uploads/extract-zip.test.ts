import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as yazl from "yazl";
import { extractZipSafely } from "../../lib/uploads/extract-zip";

type ZipItem = { name: string; content: Buffer; mode?: number };

function makeZip(items: ZipItem[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    const chunks: Buffer[] = [];
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.on("error", reject);
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));

    for (const item of items) {
      zip.addBuffer(item.content, item.name, { compress: true, ...(item.mode ? { mode: item.mode } : {}) });
    }
    zip.end();
  });
}

test("extracts safe ZIP files into a new private directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "deplo-zip-test-"));
  try {
    const archivePath = join(root, "site.zip");
    const destination = join(root, "extracted");
    await writeFile(archivePath, await makeZip([
      { name: "index.html", content: Buffer.from("<!doctype html><html></html>") },
      { name: "assets/site.css", content: Buffer.from("body { color: black; }") },
    ]));

    const result = await extractZipSafely(archivePath, destination);
    assert.equal(result.fileCount, 2);
    assert.equal(result.totalBytes, Buffer.byteLength("<!doctype html><html></html>") + Buffer.byteLength("body { color: black; }"));
    assert.equal(await readFile(join(destination, "index.html"), "utf8"), "<!doctype html><html></html>");
    assert.equal(await readFile(join(destination, "assets/site.css"), "utf8"), "body { color: black; }");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects highly compressed archive entries and removes partial output", async () => {
  const root = await mkdtemp(join(tmpdir(), "deplo-zip-bomb-test-"));
  try {
    const archivePath = join(root, "compressed.zip");
    const destination = join(root, "extracted");
    await writeFile(archivePath, await makeZip([
      { name: "repeated.txt", content: Buffer.alloc(200_000, 65) },
    ]));

    await assert.rejects(extractZipSafely(archivePath, destination), /compression ratio/);
    await assert.rejects(readFile(destination), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects malformed ZIP input", async () => {
  const root = await mkdtemp(join(tmpdir(), "deplo-zip-invalid-test-"));
  try {
    const archivePath = join(root, "invalid.zip");
    await writeFile(archivePath, Buffer.from("not a zip file"));
    await assert.rejects(extractZipSafely(archivePath, join(root, "extracted")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
