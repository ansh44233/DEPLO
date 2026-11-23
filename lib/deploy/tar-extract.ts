import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

export const MAX_TAR_FILES = 5_000;
export const MAX_TAR_BYTES = 100 * 1024 * 1024;

export class TarExtractError extends Error {
  constructor(message: string) { super(message); this.name = "TarExtractError"; }
}

function readString(block: Buffer, offset: number, length: number): string {
  const slice = block.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString("utf8");
}

function readOctal(block: Buffer, offset: number, length: number): number {
  const text = readString(block, offset, length).trim();
  if (!text) return 0;
  if (!/^[0-7]+$/.test(text)) throw new TarExtractError("The build output archive has an invalid size field.");
  return parseInt(text, 8);
}

function safeRelativePath(raw: string): string | null {
  const normalized = raw.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (!normalized || normalized === ".") return null;
  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) throw new TarExtractError("The build output contains an absolute path.");
  const parts = normalized.split("/");
  if (parts.some((part) => part === ".." || part === "")) throw new TarExtractError("The build output contains an unsafe path.");
  return parts.join("/");
}

/**
 * Extracts an uncompressed tar archive (ustar, with GNU/pax long names) into
 * `destination`. Only regular files and directories are written; links and
 * special entries are skipped. Paths are confined to the destination.
 */
export async function extractTar(archive: Buffer, destination: string): Promise<{ fileCount: number; totalBytes: number }> {
  const root = resolve(destination);
  await mkdir(root, { recursive: true });
  let offset = 0;
  let fileCount = 0;
  let totalBytes = 0;
  let pendingLongName: string | null = null;

  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const size = readOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > archive.length) throw new TarExtractError("The build output archive is truncated.");
    const data = archive.subarray(dataStart, dataEnd);
    offset = dataStart + Math.ceil(size / 512) * 512;

    if (type === "L") { pendingLongName = data.toString("utf8").replace(/\0+$/, ""); continue; }
    if (type === "x") {
      const match = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(data.toString("utf8"));
      if (match) pendingLongName = match[1];
      continue;
    }
    if (type === "g") continue;

    const prefix = readString(header, 345, 155);
    const name = pendingLongName ?? (prefix ? prefix + "/" + readString(header, 0, 100) : readString(header, 0, 100));
    pendingLongName = null;

    const relativePath = safeRelativePath(name);
    if (!relativePath) continue;
    const target = resolve(root, relativePath);
    if (target !== root && !target.startsWith(root + sep)) throw new TarExtractError("The build output contains an unsafe path.");

    if (type === "5") { await mkdir(target, { recursive: true }); continue; }
    if (type !== "0" && type !== "\0" && type !== "7") continue; // links, devices, fifos

    fileCount += 1;
    totalBytes += size;
    if (fileCount > MAX_TAR_FILES) throw new TarExtractError("The build output has more than " + MAX_TAR_FILES + " files.");
    if (totalBytes > MAX_TAR_BYTES) throw new TarExtractError("The build output is larger than 100 MiB.");
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data, { flag: "wx", mode: 0o644 });
  }
  return { fileCount, totalBytes };
}
