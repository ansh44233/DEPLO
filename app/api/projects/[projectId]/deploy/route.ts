import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/auth/session";
import { decryptGitHubToken } from "@/lib/auth/github-token";
import { getOwnedProjectById, ProjectStoreError, updateOwnedProjectDeployment } from "@/lib/db/supabase-projects";
import { parsePublicGitHubUrl } from "@/lib/github/parse-repository-url";
import { isValidGitHubBranch } from "@/lib/github/deploy-validation";
import { extractZipSafely } from "@/lib/uploads/extract-zip";
import { deployStaticDirectory, isValidPagesBranch, readCloudflarePagesConfig } from "@/lib/deploy/cloudflare-pages";
import { inspectStaticDirectory } from "@/lib/deploy/static-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
type RouteContext = { params: Promise<{ projectId: string }> };

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

async function downloadArchive(url: string, destination: string, accessToken: string | null): Promise<number> {
  const response = await fetch(url, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "DEPLO", ...(accessToken ? { Authorization: "Bearer " + accessToken } : {}) },
    signal: AbortSignal.timeout(30_000),
    redirect: "follow",
    cache: "no-store",
  });
  if (response.status === 404) throw new Error("Repository or branch not found, or your GitHub account cannot access it.");
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

export async function POST(request: NextRequest, context: RouteContext) {
  const accessToken = decryptGitHubToken(request.cookies.get("deplo_github_token")?.value, process.env.GITHUB_TOKEN_ENCRYPTION_KEY ?? "");


  const user = verifySessionToken(
    request.cookies.get("deplo_session")?.value,
    process.env.DEPLO_SESSION_SECRET ?? "",
  );
  if (!user) return jsonError("Sign in with GitHub to deploy this project.", 401);

  const { projectId } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId)) {
    return jsonError("Invalid project ID.", 400);
  }

  let project;
  try {
    project = await getOwnedProjectById(user.id, projectId);
  } catch (error) {
    if (error instanceof ProjectStoreError) return jsonError(error.message, error.status);
    return jsonError("Project storage is temporarily unavailable.", 502);
  }
  if (!project) return jsonError("Project not found in your account.", 404);
  if (project.source_type !== "github" || !project.repository_url || !project.branch) {
    return jsonError("This project source cannot be deployed through GitHub import yet.", 422);
  }

  const repository = parsePublicGitHubUrl(project.repository_url);
  if (!repository || !isValidGitHubBranch(project.branch)) {
    return jsonError("The saved GitHub repository details are invalid. Re-import this repository.", 422);
  }

  const config = readCloudflarePagesConfig();
  if (!config) return jsonError("Cloudflare Pages deployment is not configured on the server.", 503);

  const pagesBranch = "site-" + project.slug;
  if (!isValidPagesBranch(pagesBranch)) return jsonError("Invalid Cloudflare Pages branch.", 400);

  const workRoot = await mkdtemp(join(tmpdir(), "deplo-account-deploy-"));
  const archivePath = join(workRoot, "repository.zip");
  const extractedRoot = join(workRoot, "extracted");
  try {
    const archiveUrl = "https://api.github.com/repos/" +
      encodeURIComponent(repository.owner) + "/" +
      encodeURIComponent(repository.repository) +
      "/zipball/" + project.branch.split("/").map(encodeURIComponent).join("/");
    const archiveBytes = await downloadArchive(archiveUrl, archivePath, accessToken);
    await extractZipSafely(archivePath, extractedRoot);

    const roots = await readdir(extractedRoot, { withFileTypes: true });
    const projectRoot = roots.length === 1 && roots[0].isDirectory()
      ? join(extractedRoot, roots[0].name)
      : extractedRoot;
    const indexStat = await stat(join(projectRoot, "index.html")).catch(() => null);
    if (!indexStat?.isFile()) {
      return jsonError("This repository must contain a root index.html file. DEPLO currently publishes static sites only.", 422);
    }

    const assets = await inspectStaticDirectory(projectRoot);
    const deployment = await deployStaticDirectory(projectRoot, pagesBranch, config);
    let savedProject;
    try {
      savedProject = await updateOwnedProjectDeployment(user.id, project.id, deployment.url);
    } catch {
      return NextResponse.json({
        status: "deployed",
        url: deployment.url,
        warning: "The site was deployed, but DEPLO could not save the deployment URL to your project record.",
      }, { status: 201, headers: { "Cache-Control": "no-store" } });
    }

    return NextResponse.json({
      status: "deployed",
      project: savedProject,
      url: deployment.url,
      archiveBytes,
      fileCount: assets.fileCount,
      totalBytes: assets.totalBytes,
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub project deployment failed.";
    const status = /not found|private/.test(message) ? 404 : /limit|invalid ZIP|compression ratio|path|symbolic link/.test(message) ? 422 : 502;
    return jsonError(message, status);
  } finally {
    await rm(workRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}
