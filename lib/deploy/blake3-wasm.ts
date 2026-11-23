import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Loads the Rust BLAKE3 hasher (native/blake3-wasm, built to
 * lib/deploy/blake3.wasm). Returns null when the file is missing or cannot be
 * instantiated, so callers fall back to the JavaScript implementation in
 * ./blake3 and hashes are identical either way.
 */
export type WasmHasher = {
  hash(input: Uint8Array): Uint8Array;
  /** BLAKE3(base64(content) + extension), the Cloudflare Pages asset key before truncation. */
  pagesAssetHash(content: Uint8Array, extension: string): Uint8Array;
};

type Exports = {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;
  hash(input: number, len: number, out: number): void;
  pages_asset_hash(content: number, contentLen: number, extension: number, extensionLen: number, out: number): void;
};

export const DEFAULT_WASM_PATH = join(process.cwd(), "lib", "deploy", "blake3.wasm");

let cached: WasmHasher | null | undefined;

/** The shared hasher, loaded once per process. */
export function wasmHasher(env: Record<string, string | undefined> = process.env): WasmHasher | null {
  if (cached === undefined) cached = env.DEPLO_DISABLE_WASM_HASH === "1" ? null : loadWasmHasher(DEFAULT_WASM_PATH);
  return cached;
}

export function loadWasmHasher(path: string): WasmHasher | null {
  let exports: Exports;
  try {
    const compiled = new WebAssembly.Module(readFileSync(path));
    exports = new WebAssembly.Instance(compiled, {}).exports as unknown as Exports;
    if (!(exports.memory instanceof WebAssembly.Memory) || typeof exports.alloc !== "function" || typeof exports.pages_asset_hash !== "function") return null;
  } catch {
    return null;
  }

  // Copies `bytes` into wasm memory; the caller frees the returned pointer.
  const put = (bytes: Uint8Array): number => {
    const ptr = exports.alloc(bytes.length);
    if (!ptr) throw new Error("BLAKE3 wasm allocation failed.");
    // Read memory.buffer after alloc: growing memory replaces the buffer.
    new Uint8Array(exports.memory.buffer, ptr, bytes.length).set(bytes);
    return ptr;
  };
  const withOutput = (run: (out: number) => void): Uint8Array => {
    const out = exports.alloc(32);
    if (!out) throw new Error("BLAKE3 wasm allocation failed.");
    try {
      run(out);
      return new Uint8Array(exports.memory.buffer, out, 32).slice();
    } finally {
      exports.dealloc(out, 32);
    }
  };

  const hasher: WasmHasher = {
    hash(input) {
      const ptr = put(input);
      try { return withOutput((out) => exports.hash(ptr, input.length, out)); } finally { exports.dealloc(ptr, input.length); }
    },
    pagesAssetHash(content, extension) {
      const ext = new TextEncoder().encode(extension);
      const contentPtr = put(content);
      try {
        const extPtr = put(ext);
        try {
          return withOutput((out) => exports.pages_asset_hash(contentPtr, content.length, extPtr, ext.length, out));
        } finally { exports.dealloc(extPtr, ext.length); }
      } finally { exports.dealloc(contentPtr, content.length); }
    },
  };

  // Refuse a build that disagrees with the published BLAKE3 vector for "".
  try {
    const empty = Buffer.from(hasher.hash(new Uint8Array(0))).toString("hex");
    if (empty !== "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262") return null;
  } catch {
    return null;
  }
  return hasher;
}
