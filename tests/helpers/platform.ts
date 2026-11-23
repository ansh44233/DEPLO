import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Some tests exercise behaviour the host OS may not offer. They are skipped with an
 * explicit reason instead of failing, and always run on Linux (CI and production).
 */

function probeSymlinks(): boolean {
  const dir = mkdtempSync(join(tmpdir(), "deplo-symlink-probe-"));
  try {
    writeFileSync(join(dir, "target"), "x");
    symlinkSync(join(dir, "target"), join(dir, "link"));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Windows only lets administrators, or users with Developer Mode, create symlinks. */
export const skipWithoutSymlinks: string | false = probeSymlinks()
  ? false
  : "this OS does not allow creating symlinks (Windows without Developer Mode)";

/** Windows has no POSIX execute permission bits. */
export const skipWithoutPosixModes: string | false = process.platform === "win32"
  ? "POSIX file mode bits are not available on Windows"
  : false;
