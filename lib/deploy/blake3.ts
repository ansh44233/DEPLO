// Minimal BLAKE3 (default hash mode, 32-byte output) used to compute
// Cloudflare Pages asset keys without shipping the Wrangler CLI.
// Spec: https://github.com/BLAKE3-team/BLAKE3-specs

const IV = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);
const PERMUTATION = [2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8];
const BLOCK_LEN = 64;
const CHUNK_LEN = 1024;
const CHUNK_START = 1;
const CHUNK_END = 2;
const PARENT = 4;
const ROOT = 8;

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function g(s: Uint32Array, a: number, b: number, c: number, d: number, x: number, y: number) {
  s[a] = (s[a] + s[b] + x) | 0; s[d] = rotr(s[d] ^ s[a], 16);
  s[c] = (s[c] + s[d]) | 0; s[b] = rotr(s[b] ^ s[c], 12);
  s[a] = (s[a] + s[b] + y) | 0; s[d] = rotr(s[d] ^ s[a], 8);
  s[c] = (s[c] + s[d]) | 0; s[b] = rotr(s[b] ^ s[c], 7);
}

function compress(cv: Uint32Array, block: Uint32Array, counter: number, blockLen: number, flags: number): Uint32Array {
  const s = new Uint32Array(16);
  s.set(cv, 0);
  s[8] = IV[0]; s[9] = IV[1]; s[10] = IV[2]; s[11] = IV[3];
  s[12] = counter >>> 0;
  s[13] = Math.floor(counter / 0x100000000) >>> 0;
  s[14] = blockLen;
  s[15] = flags;
  let m = Uint32Array.from(block);
  for (let round = 0; round < 7; round += 1) {
    g(s, 0, 4, 8, 12, m[0], m[1]); g(s, 1, 5, 9, 13, m[2], m[3]);
    g(s, 2, 6, 10, 14, m[4], m[5]); g(s, 3, 7, 11, 15, m[6], m[7]);
    g(s, 0, 5, 10, 15, m[8], m[9]); g(s, 1, 6, 11, 12, m[10], m[11]);
    g(s, 2, 7, 8, 13, m[12], m[13]); g(s, 3, 4, 9, 14, m[14], m[15]);
    const next = new Uint32Array(16);
    for (let i = 0; i < 16; i += 1) next[i] = m[PERMUTATION[i]];
    m = next;
  }
  for (let i = 0; i < 8; i += 1) {
    s[i] ^= s[i + 8];
    s[i + 8] ^= cv[i];
  }
  return s;
}

function readBlock(input: Uint8Array, offset: number, length: number): Uint32Array {
  const bytes = new Uint8Array(BLOCK_LEN);
  bytes.set(input.subarray(offset, offset + length));
  const words = new Uint32Array(16);
  for (let i = 0; i < 16; i += 1) {
    words[i] = bytes[i * 4] | (bytes[i * 4 + 1] << 8) | (bytes[i * 4 + 2] << 16) | (bytes[i * 4 + 3] << 24);
  }
  return words;
}

type Output = { cv: Uint32Array; block: Uint32Array; counter: number; blockLen: number; flags: number };

function chainingValue(output: Output): Uint32Array {
  return compress(output.cv, output.block, output.counter, output.blockLen, output.flags).subarray(0, 8);
}

function chunkOutput(input: Uint8Array, start: number, end: number, chunkIndex: number): Output {
  let cv: Uint32Array = IV;
  let offset = start;
  let first = true;
  // Compress every block except the last, which is returned for the caller.
  while (end - offset > BLOCK_LEN) {
    cv = compress(cv, readBlock(input, offset, BLOCK_LEN), chunkIndex, BLOCK_LEN, first ? CHUNK_START : 0).subarray(0, 8);
    offset += BLOCK_LEN;
    first = false;
  }
  const blockLen = end - offset;
  return {
    cv,
    block: readBlock(input, offset, blockLen),
    counter: chunkIndex,
    blockLen,
    flags: (first ? CHUNK_START : 0) | CHUNK_END,
  };
}

function subtreeOutput(input: Uint8Array, firstChunk: number, chunkCount: number): Output {
  if (chunkCount === 1) {
    const start = firstChunk * CHUNK_LEN;
    return chunkOutput(input, start, Math.min(start + CHUNK_LEN, input.length), firstChunk);
  }
  let left = 1;
  while (left * 2 < chunkCount) left *= 2;
  const block = new Uint32Array(16);
  block.set(chainingValue(subtreeOutput(input, firstChunk, left)), 0);
  block.set(chainingValue(subtreeOutput(input, firstChunk + left, chunkCount - left)), 8);
  return { cv: IV, block, counter: 0, blockLen: BLOCK_LEN, flags: PARENT };
}

export function blake3(input: Uint8Array | string): Uint8Array {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const chunkCount = Math.max(1, Math.ceil(bytes.length / CHUNK_LEN));
  const root = subtreeOutput(bytes, 0, chunkCount);
  const words = compress(root.cv, root.block, root.counter, root.blockLen, root.flags | ROOT);
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i += 1) {
    out[i * 4] = words[i] & 0xff;
    out[i * 4 + 1] = (words[i] >>> 8) & 0xff;
    out[i * 4 + 2] = (words[i] >>> 16) & 0xff;
    out[i * 4 + 3] = (words[i] >>> 24) & 0xff;
  }
  return out;
}

export function blake3Hex(input: Uint8Array | string): string {
  return Buffer.from(blake3(input)).toString("hex");
}
