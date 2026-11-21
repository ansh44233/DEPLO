export type UploadKind = "zip" | "html";

export const MAX_ZIP_BYTES = 25 * 1024 * 1024;
export const MAX_HTML_BYTES = 2 * 1024 * 1024;

export function validateUploadSelection(
  fileName: string,
  size: number,
  kind: UploadKind,
): string | null {
  if (!fileName.trim()) return "Choose a file first.";
  if (!Number.isFinite(size) || size <= 0) return "The selected file is empty or invalid.";

  if (kind === "zip") {
    if (!fileName.toLowerCase().endsWith(".zip")) return "Choose a .zip archive.";
    if (size > MAX_ZIP_BYTES) return "ZIP files must be 25 MB or smaller.";
    return null;
  }

  if (!fileName.toLowerCase().endsWith(".html") && !fileName.toLowerCase().endsWith(".htm")) {
    return "Choose an .html file.";
  }
  if (size > MAX_HTML_BYTES) return "HTML files must be 2 MB or smaller.";
  return null;
}

export function hasZipSignature(bytes: Uint8Array): boolean {
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false;
  return (
    (bytes[2] === 0x03 && bytes[3] === 0x04) ||
    (bytes[2] === 0x05 && bytes[3] === 0x06) ||
    (bytes[2] === 0x07 && bytes[3] === 0x08)
  );
}
