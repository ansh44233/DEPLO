export const MAX_ARCHIVE_ENTRIES = 2_000;
export const MAX_ARCHIVE_EXPANDED_BYTES = 100 * 1024 * 1024;
export const MAX_ARCHIVE_COMPRESSION_RATIO = 100;
export const MAX_ARCHIVE_PATH_LENGTH = 1_024;

export type ArchiveEntryMetadata = { path: string; compressedSize: number; uncompressedSize: number };

export function validateArchiveEntryPath(path: string): string | null {
  if (!path || path.length > MAX_ARCHIVE_PATH_LENGTH) return "Archive entry path is empty or too long."; 
  if (path.includes("\\0")) return "Archive entry paths cannot contain null bytes."; 
  if (/[\\u0000-\\u001f\\u007f]/.test(path)) return "Archive entry paths cannot contain control characters."; 
  if (path.includes("\\\\")) return "Archive entry paths cannot contain backslashes."; 
  if (path.startsWith("/") || /^[a-zA-Z]:/.test(path)) return "Absolute archive paths are not allowed."; 
  const segments = path.split("/");
  const meaningful = path.endsWith("/") ? segments.slice(0, -1) : segments;
  if (meaningful.length === 0 || meaningful.some((segment) => !segment || segment === "." || segment === "..")) {
    return "Archive entry paths must not contain empty, dot, or parent-directory segments."; 
  }
  return null;
}

export function validateArchiveMetadata(entries: ArchiveEntryMetadata[]): string | null {
  if (entries.length === 0) return "The archive is empty."; 
  if (entries.length > MAX_ARCHIVE_ENTRIES) return `Archives cannot contain more than ${MAX_ARCHIVE_ENTRIES} entries.`;
  let totalExpandedBytes = 0;
  for (const entry of entries) {
    const pathError = validateArchiveEntryPath(entry.path);
    if (pathError) return pathError;
    if (!Number.isSafeInteger(entry.compressedSize) || !Number.isSafeInteger(entry.uncompressedSize) || entry.compressedSize < 0 || entry.uncompressedSize < 0) {
      return "Archive entry sizes must be non-negative safe integers."; 
    }
    if (entry.uncompressedSize > 0 && entry.compressedSize === 0) return "Archive entry has an invalid compression size."; 
    const ratio = entry.compressedSize === 0 ? 0 : entry.uncompressedSize / entry.compressedSize;
    if (ratio > MAX_ARCHIVE_COMPRESSION_RATIO) return `Archive entries cannot exceed a ${MAX_ARCHIVE_COMPRESSION_RATIO}:1 compression ratio.`;
    totalExpandedBytes += entry.uncompressedSize;
    if (!Number.isSafeInteger(totalExpandedBytes) || totalExpandedBytes > MAX_ARCHIVE_EXPANDED_BYTES) return "The expanded archive exceeds the 100 MB limit."; 
  }
  return null;
}