import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const IGNORED = new Set(["__MACOSX", ".DS_Store", "Thumbs.db", "desktop.ini"]);

async function isFile(path: string) { return (await stat(path).catch(() => null))?.isFile() ?? false; }

/**
 * Zipping a folder (rather than its contents) puts everything under one
 * top-level directory. Step into it (up to three levels) until the site or
 * project root is found, ignoring OS metadata such as __MACOSX.
 */
export async function resolveSiteRoot(root: string): Promise<string> {
  let current = root;
  for (let depth = 0; depth < 3; depth += 1) {
    if (await isFile(join(current, "index.html")) || await isFile(join(current, "package.json"))) return current;
    const entries = (await readdir(current, { withFileTypes: true })).filter((entry) => !IGNORED.has(entry.name));
    if (entries.length !== 1 || !entries[0].isDirectory()) return current;
    current = join(current, entries[0].name);
  }
  return current;
}
