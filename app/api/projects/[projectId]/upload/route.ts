import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/auth/session";
import { getOwnedProjectById, ProjectStoreError, updateOwnedProjectDeployment } from "@/lib/db/supabase-projects";
import { deployStaticDirectory, readCloudflarePagesCredentials } from "@/lib/deploy/cloudflare-pages";
import { ensureCloudflarePagesProject, getAccountPagesTarget } from "@/lib/deploy/cloudflare-projects";
import { inspectStaticDirectory, pruneUnpublishableFiles } from "@/lib/deploy/static-assets";
import { extractZipSafely } from "@/lib/uploads/extract-zip";
import { resolveSiteRoot } from "@/lib/uploads/site-root";
import { isOwnStagedPath, StagedUploadError, takeStagedUpload } from "@/lib/uploads/staged-upload";
import { loadBuildEnv } from "@/lib/db/supabase-env-vars";
import { buildInSandbox, decideSite, hasPackageLock, sandboxBuildsAvailable, SandboxBuildError } from "@/lib/deploy/sandbox-build";
import { dependencyCacheKey } from "@/lib/deploy/build-cache";
import { supabaseBuildCache } from "@/lib/db/supabase-build-cache";
import { hasHtmlDocument, hasZipSignature, MAX_HTML_BYTES, MAX_ZIP_BYTES, validateUploadSelection } from "@/lib/uploads/validate-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RouteContext = { params: Promise<{ projectId: string }> };

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const user = verifySessionToken(
    request.cookies.get("deplo_session")?.value,
    process.env.DEPLO_SESSION_SECRET ?? "",
  );
  if (!user) return jsonError("Sign in with GitHub to upload and deploy this project.", 401);

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
  if (project.source_type !== "zip" && project.source_type !== "html") {
    return jsonError("Only ZIP and standalone HTML projects can use this upload endpoint.", 422);
  }

  const config = readCloudflarePagesCredentials();
  if (!config) return jsonError("Cloudflare Pages deployment is not configured on the server.", 503);
  let pagesTarget: ReturnType<typeof getAccountPagesTarget>;
  try {
    pagesTarget = getAccountPagesTarget(config, user.id, project.slug);
  } catch {
    return jsonError("The account project cannot be mapped to a valid Cloudflare Pages project.", 422);
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ZIP_BYTES + 64 * 1024) {
    return jsonError("The upload request exceeds the 25 MiB request limit.", 413);
  }

  const kind = project.source_type;
  let bytes: Uint8Array;
  if ((request.headers.get("content-type") ?? "").includes("application/json")) {
    // Large files are uploaded straight to private storage first; see /upload-url.
    const body = await request.json().catch(() => null) as { stagedPath?: unknown; fileName?: unknown } | null;
    if (!isOwnStagedPath(body?.stagedPath, user.id, project.id)) return jsonError("Upload the file again.", 400);
    try {
      bytes = await takeStagedUpload(body.stagedPath);
    } catch (error) {
      if (error instanceof StagedUploadError) return jsonError(error.message, error.status);
      return jsonError("The uploaded file could not be read.", 502);
    }
  } else {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return jsonError("Send a valid multipart/form-data request.", 400);
    }
    const file = form.get("file");
    if (!(file instanceof File)) return jsonError("Choose a file to upload.", 400);
    const validationError = validateUploadSelection(file.name, file.size, kind);
    if (validationError) return jsonError(validationError, 400);
    bytes = new Uint8Array(await file.arrayBuffer());
  }
  if (kind === "zip" && !hasZipSignature(bytes.subarray(0, 4))) {
    return jsonError("The selected file does not have a valid ZIP signature.", 400);
  }
  if (kind === "html" && !hasHtmlDocument(bytes)) {
    return jsonError("The file must contain a complete HTML document.", 400);
  }
  const maxBytes = kind === "zip" ? MAX_ZIP_BYTES : MAX_HTML_BYTES;
  if (bytes.byteLength > maxBytes) return jsonError("The uploaded file exceeds its size limit.", 413);

  const workRoot = await mkdtemp(join(tmpdir(), "deplo-account-upload-"));
  const outputDirectory = join(workRoot, "site");
  try {
    await mkdir(outputDirectory, { recursive: false, mode: 0o700 });
    if (kind === "zip") {
      const archivePath = join(workRoot, "upload.zip");
      await writeFile(archivePath, bytes, { flag: "wx", mode: 0o600 });
      await rm(outputDirectory, { recursive: true, force: true });
      await extractZipSafely(archivePath, outputDirectory);
    } else {
      await writeFile(join(outputDirectory, "index.html"), bytes, { flag: "wx", mode: 0o600 });
    }

    // A zipped folder nests everything one level down; find the real root.
    let siteRoot = await resolveSiteRoot(outputDirectory);
    let build: { framework: string; log: string } | null = null;
    const decision = await decideSite(siteRoot);
    if (decision.kind === "unsupported") {
      return jsonError(decision.message.replace("repository root", "top of the ZIP"), 422);
    }
    if (decision.kind === "build") {
      if (!sandboxBuildsAvailable()) return jsonError("This ZIP contains a " + decision.plan.framework + " project that needs a build, and builds are not available on this server. Upload the built output folder instead.", 422);
      const builtRoot = join(workRoot, "built");
      try {
        const buildEnv = await loadBuildEnv(user.id, project.id);
        const cacheKey = await dependencyCacheKey(siteRoot, decision.plan.packageManager, Object.keys(buildEnv));
        const cacheStore = cacheKey ? supabaseBuildCache(user.id, project.id) : null;
        const built = await buildInSandbox({
          filesRoot: siteRoot,
          accessToken: null,
          decision,
          hasNpmLock: await hasPackageLock(siteRoot),
          destination: builtRoot,
          buildEnv,
          ...(cacheKey && cacheStore ? { cache: { key: cacheKey, sourceRoot: siteRoot, store: cacheStore } } : {}),
        });
        build = { framework: decision.plan.framework, log: built.log };
      } catch (error) {
        if (error instanceof SandboxBuildError) {
          return NextResponse.json({ error: error.message, code: error.code, buildLog: error.log }, { status: 422, headers: { "Cache-Control": "no-store" } });
        }
        throw error;
      }
      siteRoot = builtRoot;
    }
    const indexFile = await stat(join(siteRoot, "index.html")).catch(() => null);
    if (!indexFile?.isFile()) {
      return jsonError("The ZIP needs an index.html at its top level (or inside a single folder).", 422);
    }
    await pruneUnpublishableFiles(siteRoot);
    const assets = await inspectStaticDirectory(siteRoot);
    const { productionUrl } = await ensureCloudflarePagesProject(pagesTarget.config, pagesTarget.productionBranch);
    const deployment = await deployStaticDirectory(siteRoot, pagesTarget.productionBranch, pagesTarget.config);

    let savedProject;
    try {
      savedProject = await updateOwnedProjectDeployment(user.id, project.id, productionUrl);
    } catch {
      return NextResponse.json({
        status: "deployed",
        url: productionUrl,
        deploymentUrl: deployment.url,
        warning: "The site was deployed, but DEPLO could not save the URL to your project record.",
      }, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({
      status: "deployed",
      project: savedProject,
      url: productionUrl,
      deploymentUrl: deployment.url,
      fileCount: assets.fileCount,
      totalBytes: assets.totalBytes,
      build,
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Static upload deployment failed.";
    const status = /limit|invalid ZIP|compression ratio|path|symbolic link|private or blocked/.test(message) ? 422 : 502;
    return jsonError(message, status);
  } finally {
    await rm(workRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}
