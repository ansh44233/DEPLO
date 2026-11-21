import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { parsePublicGitHubUrl } from "@/lib/github/parse-repository-url";
import { isAuthorizedUploadRequest } from "@/lib/uploads/upload-auth";
import { extractZipSafely } from "@/lib/uploads/extract-zip";
import { deployStaticDirectory, isValidPagesBranch, readCloudflarePagesConfig } from "@/lib/deploy/cloudflare-pages";
import { inspectStaticDirectory } from "@/lib/deploy/static-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const GITHUB_BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function downloadArchive(url: string, destination: string): Promise<number> {
  const response = await fetch(url, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "DEPLO" },
    signal: AbortSignal.timeout(30_000),
    redirect: "follow",
  });
  if (response.status === 404) throw new Error("Repository or branch not found, or the repository is private.");
  if (!response.ok || !response.body) throw new Error("GitHub could not provide the repository archive.");

  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ARCHIVE_BYTES) {
    throw new Error("Repository archive exceeds the 25 MiB download limit.");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_ARCHIVE_BYTES) {
        await reader.cancel();
        throw new Error("Repository archive exceeds the 25 MiB download limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total < 4) throw new Error("GitHub returned an empty repository archive.");
  const archive = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  if (archive[0] !== 0x50 || archive[1] !== 0x4b) throw new Error("GitHub returned an invalid ZIP archive.");
  await writeFile(destination, archive, { flag: "wx", mode: 0o600 });
  return total;
}

export async function POST(request: NextRequest) {
  const token = process.env.DEPLO_UPLOAD_TOKEN;
  if (!token || token.length < 32) return jsonError("Upload storage is not configured.", 503);
  if (!isAuthorizedUploadRequest(request.headers.get("authorization"), token)) {
    return jsonError("Authentication required.", 401);
  }

  const config = readCloudflarePagesConfig();
  if (!config) return jsonError("Cloudflare Pages deployment is not configured on the server.", 503);

  let body: { repositoryUrl?: unknown; branch?: unknown; projectSlug?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return jsonError("Send repositoryUrl, branch, and projectSlug as JSON.", 400);
  }

  if (typeof body.repositoryUrl !== "string") return jsonError("A public GitHub repository URL is required.", 400);
  const repository = parsePublicGitHubUrl(body.repositoryUrl);
  if (!repository) return jsonError("Enter a canonical public GitHub repository URL.", 400);
  if (typeof body.branch !== "string" || !GITHUB_BRANCH_PATTERN.test(body.branch) ||
      body.branch.includes("..") || body.branch.endsWith("/") || body.branch.includes("//")) {
    return jsonError("Enter a valid Git branch name.", 400);
  }
  if (typeof body.projectSlug !== "string" || !/^[a-z0-9][a-z0-9-]{0,57}$/.test(body.projectSlug)) {
    return jsonError("Project slug must use lowercase letters, numbers, and hyphens.", 400);
  }

  const workRoot = await mkdtemp(join(tmpdir(), "deplo-github-"));
  const archivePath = join(workRoot, "repository.zip");
  const extractedRoot = join(workRoot, "extracted");
  try {
    const archiveUrl = "https://api.github.com/repos/" +
      encodeURIComponent(repository.owner) + "/" +
      encodeURIComponent(repository.repository) +
      "/zipball/" + body.branch.split("/").map(encodeURIComponent).join("/");
    const archiveBytes = await downloadArchive(archiveUrl, archivePath);
    await extractZipSafely(archivePath, extractedRoot);

    const roots = await readdir(extractedRoot, { withFileTypes: true });
    const projectRoot = roots.length === 1 && roots[0].isDirectory()
      ? join(extractedRoot, roots[0].name)
      : extractedRoot;
    const indexPath = join(projectRoot, "index.html");
    try {
      const indexStat = await stat(indexPath);
      if (!indexStat.isFile()) return jsonError("This repository must contain a root index.html file.", 422);
    } catch {
      return jsonError("This repository must contain a root index.html file. DEPLO currently publishes static sites only.", 422);
    }

    const assets = await inspectStaticDirectory(projectRoot);
    const pagesBranch = "site-" + body.projectSlug;
    if (!isValidPagesBranch(pagesBranch)) return jsonError("Invalid deployment branch.", 400);
    const deployment = await deployStaticDirectory(projectRoot, pagesBranch, config);
    return NextResponse.json({
      status: "deployed",
      repository: repository.owner + "/" + repository.repository,
      branch: body.branch,
      projectSlug: body.projectSlug,
      url: deployment.url,
      archiveBytes,
      fileCount: assets.fileCount,
      totalBytes: assets.totalBytes,
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub repository deployment failed.";
    const status = /not found|private/.test(message) ? 404 : /limit|invalid ZIP|compression ratio|path|symbolic link/.test(message) ? 422 : 502;
    return jsonError(message, status);
  } finally {
    await rm(workRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}
