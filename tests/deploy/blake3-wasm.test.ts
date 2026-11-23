import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blake3Hex } from "../../lib/deploy/blake3";
import { DEFAULT_WASM_PATH, loadWasmHasher } from "../../lib/deploy/blake3-wasm";
import { pagesAssetHash } from "../../lib/deploy/cloudflare-pages";

test("a missing or broken wasm file falls back to JavaScript", async () => {
  const dir = await mkdtemp(join(tmpdir(), "deplo-wasm-"));
  try {
    assert.equal(loadWasmHasher(join(dir, "missing.wasm")), null);
    await writeFile(join(dir, "broken.wasm"), "not wasm");
    assert.equal(loadWasmHasher(join(dir, "broken.wasm")), null);
    // A valid but empty module lacks the exports.
    await writeFile(join(dir, "empty.wasm"), Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
    assert.equal(loadWasmHasher(join(dir, "empty.wasm")), null);
  } finally { await rm(dir, { recursive: true, force: true }); }

  const content = Buffer.from("console.log('hi')");
  assert.equal(pagesAssetHash(content, "app.js", null), blake3Hex(content.toString("base64") + "js").slice(0, 32));
});

const built = existsSync(DEFAULT_WASM_PATH);

test("the Rust hasher matches the JavaScript one byte for byte", { skip: built ? false : "lib/deploy/blake3.wasm not built (run native/blake3-wasm/build.sh)" }, () => {
  const hasher = loadWasmHasher(DEFAULT_WASM_PATH);
  assert.ok(hasher, "lib/deploy/blake3.wasm loads and passes its self-check");
  for (const size of [0, 1, 2, 3, 63, 64, 65, 1023, 1024, 1025, 12_287, 12_288, 12_289, 100_000, 3_000_001]) {
    const content = new Uint8Array(size);
    for (let index = 0; index < size; index += 1) content[index] = (index * 31 + 7) % 256;
    assert.equal(Buffer.from(hasher.hash(content)).toString("hex"), blake3Hex(content), "hash of " + size + " bytes");
    for (const name of ["index.html", "app.js", "_headers", "font.woff2"]) {
      assert.equal(pagesAssetHash(content, name, hasher), pagesAssetHash(content, name, null), name + " of " + size + " bytes");
    }
  }
});
