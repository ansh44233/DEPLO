import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { LEGACY_UPLOADS_UNAVAILABLE_MESSAGE, legacyDiskUploadsAvailable } from "@/lib/hosting/platform";
import { isAuthorizedUploadRequest } from "@/lib/uploads/upload-auth";
import { extractZipSafely } from "@/lib/uploads/extract-zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ uploadId: string }> };

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest, context: RouteContext) {
  if (!legacyDiskUploadsAvailable()) {
    return NextResponse.json({ error: LEGACY_UPLOADS_UNAVAILABLE_MESSAGE }, { status: 501, headers: { "Cache-Control": "no-store" } });
  }
  const token = process.env.DEPLO_UPLOAD_TOKEN;
  if (!token || token.length < 32) {
    return jsonError("Upload storage is not configured.", 503);
  }
  if (!isAuthorizedUploadRequest(request.headers.get("authorization"), token)) {
    return jsonError("Authentication required.", 401);
  }

  const { uploadId } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uploadId)) {
    return jsonError("Invalid upload ID.", 400);
  }

  const storageRoot = resolve(process.env.DEPLO_UPLOAD_DIR || join(process.cwd(), ".deplo-uploads"));
  const metadataPath = join(storageRoot, `${uploadId}.json`);
  let metadata: { uploadId?: string; kind?: string };
  try {
    metadata = JSON.parse(await readFile(metadataPath, "utf8")) as { uploadId?: string; kind?: string };
  } catch {
    return jsonError("Upload not found.", 404);
  }

  if (metadata.uploadId !== uploadId || metadata.kind !== "zip") {
    return jsonError("The requested upload is not a ZIP archive.", 400);
  }

  const archivePath = join(storageRoot, uploadId);
  const extractionPath = join(storageRoot, `${uploadId}.extracted`);
  try {
    const result = await extractZipSafely(archivePath, extractionPath);
    return NextResponse.json({
      uploadId,
      status: "extracted_private",
      extractedFileCount: result.fileCount,
      expandedBytes: result.totalBytes,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ZIP extraction failed.";
    return jsonError(message, 422);
  }
}
