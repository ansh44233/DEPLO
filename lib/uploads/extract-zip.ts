import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as yauzl from "yauzl";
import {
  MAX_ARCHIVE_EXPANDED_BYTES,
  validateArchiveEntryPath,
  validateArchiveMetadata,
} from "@/lib/uploads/archive-policy";

export type ExtractionResult = {
  fileCount: number;
  totalBytes: number;
};

function assertSafeEntryType(entry: yauzl.Entry): void {
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
  const fileType = unixMode & 0o170000;
  const allowedTypes = new Set([0, 0o100000, 0o040000]);

  if (!allowedTypes.has(fileType)) {
    throw new Error("ZIP archives cannot contain symbolic links or special files.");
  }
}

function resolveEntryPath(root: string, archivePath: string): string {
  const segments = archivePath.endsWith("/") ? archivePath.slice(0, -1).split("/") : archivePath.split("/");
  const destination = resolve(root, ...segments);
  const relativePath = relative(root, destination);

  if (!relativePath || relativePath === ".." || relativePath.startsWith(".." + sep) || isAbsolute(relativePath)) {
    throw new Error("Archive entry resolves outside the extraction directory.");
  }

  return destination;
}

export async function extractZipSafely(
  archivePath: string,
  destinationRoot: string,
): Promise<ExtractionResult> {
  const zipFile = await yauzl.openPromise(archivePath, {
    autoClose: false,
    validateEntrySizes: true,
    strictFileNames: true,
  });
  let destinationCreated = false;

  try {
    const entries: yauzl.Entry[] = [];
    for await (const entry of zipFile.eachEntry()) {
      entries.push(entry);
    }

    const metadataError = validateArchiveMetadata(entries.map((entry) => ({
      path: entry.fileName,
      compressedSize: entry.compressedSize,
      uncompressedSize: entry.uncompressedSize,
    })));
    if (metadataError) throw new Error(metadataError);

    const seenPaths = new Set<string>();
    for (const entry of entries) {
      assertSafeEntryType(entry);
      const pathError = validateArchiveEntryPath(entry.fileName);
      if (pathError) throw new Error(pathError);
      const normalized = entry.fileName.replace(/\/$/, "").toLowerCase();
      if (seenPaths.has(normalized)) throw new Error("ZIP archives cannot contain duplicate paths.");
      seenPaths.add(normalized);
    }

    await mkdir(destinationRoot, { recursive: false, mode: 0o700 });
    destinationCreated = true;

    let totalBytes = 0;
    let fileCount = 0;

    for (const entry of entries) {
      const isDirectory = entry.fileName.endsWith("/") ||
        (((entry.externalFileAttributes >>> 16) & 0xffff) & 0o170000) === 0o040000;
      const destination = resolveEntryPath(destinationRoot, entry.fileName);

      if (isDirectory) {
        await mkdir(destination, { recursive: true, mode: 0o700 });
        continue;
      }

      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      let entryBytes = 0;
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          entryBytes += chunk.length;
          totalBytes += chunk.length;
          if (entryBytes > entry.uncompressedSize || totalBytes > MAX_ARCHIVE_EXPANDED_BYTES) {
            callback(new Error("Extracted archive data exceeded its declared or configured size limit."));
            return;
          }
          callback(null, chunk);
        },
      });

      const input = await zipFile.openReadStreamPromise(entry);
      await pipeline(
        input,
        meter,
        createWriteStream(destination, { flags: "wx", mode: 0o600 }),
      );

      if (entryBytes !== entry.uncompressedSize) {
        throw new Error("An archive entry did not match its declared uncompressed size.");
      }
      fileCount += 1;
    }

    return { fileCount, totalBytes };
  } catch (error) {
    if (destinationCreated) {
      await rm(destinationRoot, { recursive: true, force: true }).catch(() => undefined);
    }
    throw error;
  } finally {
    zipFile.close();
  }
}
