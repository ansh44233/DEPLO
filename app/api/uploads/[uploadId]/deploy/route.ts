import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedUploadRequest } from "@/lib/uploads/upload-auth";
import { extractZipSafely } from "@/lib/uploads/extract-zip";
import { deployStaticDirectory, isValidPagesBranch, readCloudflarePagesConfig } from "@/lib/deploy/cloudflare-pages";
import { inspectStaticDirectory } from "@/lib/deploy/static-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ uploadId: string }> };

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const token = process.env.DEPLO_UPLOAD_TOKEN;
  if (!token || token.length < 32) return jsonError("Upload storage is not configured.", 503);
  if (!isAuthorizedUploadRequest(request.headers.get("authorization"), token)) {
    return jsonError("Authentication required.", 401);
  }

  const config = readCloudflarePagesConfig();
  if (!config) {
    return jsonError("Configure CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, and CLOUDFLARE_PAGES_PROJECT_NAME on the server.", 503);
  }

  const { uploadId } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uploadId)) {
    return jsonError("Invalid upload ID.", 400);
  }

  let body: { projectSlug?: unknown };
  try {
    body = await request.json() as { projectSlug?: unknown };
  } catch {
    return jsonError("Send a JSON body containing projectSlug.", 400);
  }
  if (typeof body.projectSlug !== "string" || !/^[a-z0-9][a-z0-9-]{0,57}$/.test(body.projectSlug)) {
    return jsonError("Project slug must use lowercase letters, numbers, and hyphens (maximum 58 characters).", 400);
  }

  const storageRoot = resolve(process.env.DEPLO_UPLOAD_DIR || join(process.cwd(), ".deplo-uploads"));
  const metadataPath = join(storageRoot, `${uploadId}.json`);
  let metadata: { uploadId?: string; kind?: string };
  try {
    metadata = JSON.parse(await readFile(metadataPath, "utf8")) as { uploadId?: string; kind?: string };
  } catch {
    return jsonError("Upload not found.", 404);
  }
  if (metadata.uploadId !== uploadId || (metadata.kind !== "zip" && metadata.kind !== "html")) {
    return jsonError("The requested upload is invalid.", 400);
  }

  const outputDirectory = join(storageRoot, `${uploadId}.extracted`);
  try {
    if (metadata.kind === "zip") {
      try {
        await stat(outputDirectory);
      } catch {
        await extractZipSafely(join(storageRoot, uploadId), outputDirectory);
      }
    } else {
      await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
      await copyFile(join(storageRoot, uploadId), join(outputDirectory, "index.html"));
    }

    try {
      await stat(join(outputDirectory, "index.html"));
    } catch {
      return jsonError("The site must contain an index.html file at its root.", 422);
    }

    const assets = await inspectStaticDirectory(outputDirectory);
    const branch = `site-${body.projectSlug}`;
    if (!isValidPagesBranch(branch)) return jsonError("Invalid deployment branch.", 400);

    const deployment = await deployStaticDirectory(outputDirectory, branch, config);
    return NextResponse.json({
      uploadId,
      projectSlug: body.projectSlug,
      status: "deployed",
      url: deployment.url,
      fileCount: assets.fileCount,
      totalBytes: assets.totalBytes,
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Static deployment failed.";
    return jsonError(message, 502);
  }
}
