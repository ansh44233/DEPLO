import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectStaticDirectory, isForbiddenStaticPath, validatePagesFileSize } from "../../lib/deploy/static-assets";

test("inspects safe static files and reports their count and size", async () => {
  const root = await mkdtemp(join(tmpdir(), "deplo-static-assets-"));
  try {
    await mkdir(join(root, "assets"));
    await writeFile(join(root, "index.html"), "<html></html>");
    await writeFile(join(root, "assets", "site.css"), "body{}");
    assert.deepEqual(await inspectStaticDirectory(root), {
      fileCount: 2,
      totalBytes: Buffer.byteLength("<html></html>") + Buffer.byteLength("body{}"),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects private configuration and repository metadata paths", () => {
  assert.equal(isForbiddenStaticPath(".env"), true);
  assert.equal(isForbiddenStaticPath(".env.production"), true);
  assert.equal(isForbiddenStaticPath(".git/config"), true);
  assert.equal(isForbiddenStaticPath("assets/.npmrc"), true);
  assert.equal(isForbiddenStaticPath(".well-known/security.txt"), false);
});

test("enforces the Cloudflare Pages per-file size limit", () => {
  assert.equal(validatePagesFileSize(25 * 1024 * 1024), null);
  assert.match(validatePagesFileSize(25 * 1024 * 1024 + 1) ?? "", /25 MiB/);
  assert.notEqual(validatePagesFileSize(-1), null);
});

test("rejects symbolic links in a deployment directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "deplo-static-symlink-"));
  try {
    await writeFile(join(root, "index.html"), "<html></html>");
    await symlink(join(root, "index.html"), join(root, "alias.html"));
    await assert.rejects(inspectStaticDirectory(root), /symbolic links/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prunes secrets, VCS data, node_modules and symlinks so the rest still deploys", async () => {
  const { mkdtemp, mkdir, writeFile, symlink, readdir, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { pruneUnpublishableFiles, inspectStaticDirectory } = await import("../../lib/deploy/static-assets");
  const root = await mkdtemp(join(tmpdir(), "deplo-prune-"));
  try {
    await writeFile(join(root, "index.html"), "<!doctype html>");
    await writeFile(join(root, ".env.example"), "API_KEY=");
    await writeFile(join(root, ".env"), "API_KEY=secret");
    await mkdir(join(root, ".git"));
    await writeFile(join(root, ".git", "config"), "[core]");
    await mkdir(join(root, "node_modules", "x"), { recursive: true });
    await writeFile(join(root, "node_modules", "x", "i.js"), "");
    await mkdir(join(root, "assets"));
    await writeFile(join(root, "assets", "app.js"), "1");
    await writeFile(join(root, "assets", "id_rsa"), "key");
    await symlink("/etc/hosts", join(root, "hosts"));

    const removed = await pruneUnpublishableFiles(root);
    assert.deepEqual(removed.sort(), [".env", ".env.example", ".git/", "assets/id_rsa", "hosts", "node_modules/"]);
    assert.deepEqual((await readdir(root)).sort(), ["assets", "index.html"]);
    assert.deepEqual(await inspectStaticDirectory(root), { fileCount: 2, totalBytes: 16 });
  } finally { await rm(root, { recursive: true, force: true }); }
});
