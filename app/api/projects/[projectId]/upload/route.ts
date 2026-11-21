import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/auth/session";
import { getOwnedProjectById, ProjectStoreError, updateOwnedProjectDeployment } from "@/lib/db/supabase-projects";
import { deployStaticDirectory, readCloudflarePagesCredentials } from "@/lib/deploy/cloudflare-pages";
import { ensureCloudflarePagesProject, getAccountPagesTarget } from "@/lib/deploy/cloudflare-projects";
import { inspectStaticDirectory } from "@/lib/deploy/static-assets";
import { extractZipSafely } from "@/lib/uploads/extract-zip";
import { hasHtmlDocument, hasZipSignature, MAX_HTML_BYTES, MAX_ZIP_BYTES, validateUploadSelection } from "@/lib/uploads/validate-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  let pagesTarget;
  try {
    pagesTarget = getAccountPagesTarget(config, user.id, project.slug);
  } catch {
    return jsonError("The account project cannot be mapped to a valid Cloudflare Pages project.", 422);
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ZIP_BYTES + 64 * 1024) {
    return jsonError("The upload request exceeds the 25 MiB request limit.", 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("Send a valid multipart/form-data request.", 400);
  }
  const file = form.get("file");
  const kind = project.source_type;
  if (!(file instanceof File)) return jsonError("Choose a file to upload.", 400);

  const validationError = validateUploadSelection(file.name, file.size, kind);
  if (validationError) return jsonError(validationError, 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
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

    const indexFile = await stat(join(outputDirectory, "index.html")).catch(() => null);
    if (!indexFile?.isFile()) {
      return jsonError("The site must contain a root index.html file. DEPLO currently publishes static sites only.", 422);
    }
    const assets = await inspectStaticDirectory(outputDirectory);
    await ensureCloudflarePagesProject(pagesTarget.config, pagesTarget.productionBranch);
    const deployment = await deployStaticDirectory(outputDirectory, pagesTarget.productionBranch, pagesTarget.config);

    let savedProject;
    try {
      savedProject = await updateOwnedProjectDeployment(user.id, project.id, deployment.url);
    } catch {
      return NextResponse.json({
        status: "deployed",
        url: deployment.url,
        warning: "The site was deployed, but DEPLO could not save the URL to your project record.",
      }, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({
      status: "deployed",
      project: savedProject,
      url: deployment.url,
      fileCount: assets.fileCount,
      totalBytes: assets.totalBytes,
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Static upload deployment failed.";
    const status = /limit|invalid ZIP|compression ratio|path|symbolic link|private or blocked/.test(message) ? 422 : 502;
    return jsonError(message, status);
  } finally {
    await rm(workRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}
