import { mkdir, open, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { LEGACY_UPLOADS_UNAVAILABLE_MESSAGE, legacyDiskUploadsAvailable } from "@/lib/hosting/platform";
import { MAX_ZIP_BYTES, hasHtmlDocument, hasZipSignature, validateUploadSelection } from "@/lib/uploads/validate-upload";
import { isAuthorizedUploadRequest } from "@/lib/uploads/upload-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const MAX_REQUEST_BYTES = MAX_ZIP_BYTES + MULTIPART_OVERHEAD_BYTES;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  if (!legacyDiskUploadsAvailable()) {
    return NextResponse.json({ error: LEGACY_UPLOADS_UNAVAILABLE_MESSAGE }, { status: 501, headers: { "Cache-Control": "no-store" } });
  }
  const token = process.env.DEPLO_UPLOAD_TOKEN;
  if (!token || token.length < 32) {
    return jsonError("Upload storage is not configured. Set a strong DEPLO_UPLOAD_TOKEN on the server.", 503);
  }

  if (!isAuthorizedUploadRequest(request.headers.get("authorization"), token)) {
    return jsonError("Authentication required.", 401);
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0 || contentLength > MAX_REQUEST_BYTES) {
    return jsonError("Upload request is missing a valid Content-Length or exceeds the 25 MB limit.", 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError("Send a valid multipart/form-data request.", 400);
  }

  const file = form.get("file");
  const kind = form.get("kind");
  if (!(file instanceof File) || (kind !== "zip" && kind !== "html")) {
    return jsonError('Provide a file field and kind set to "zip" or "html".', 400);
  }

  const validationError = validateUploadSelection(file.name, file.size, kind);
  if (validationError) return jsonError(validationError, 400);

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (kind === "zip" && !hasZipSignature(bytes.subarray(0, 4))) {
    return jsonError("The selected file does not have a valid ZIP signature.", 400);
  }
  if (kind === "html" && !hasHtmlDocument(bytes)) {
    return jsonError("The file must contain a complete HTML document.", 400);
  }

  const uploadId = randomUUID();
  const storageRoot = resolve(process.env.DEPLO_UPLOAD_DIR || join(process.cwd(), ".deplo-uploads"));
  await mkdir(storageRoot, { recursive: true, mode: 0o700 });
  const destination = join(storageRoot, uploadId);
  const handle = await open(destination, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
  } catch (error) {
    await handle.close();
    await unlink(destination).catch(() => undefined);
    throw error;
  }
  await handle.close();

  const metadata = {
    uploadId,
    fileName: file.name,
    kind,
    size: bytes.byteLength,
    uploadedAt: new Date().toISOString(),
  };
  try {
    await writeFile(join(storageRoot, `${uploadId}.json`), JSON.stringify(metadata), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    await unlink(destination).catch(() => undefined);
    throw error;
  }

  return NextResponse.json(
    { ...metadata, status: "stored_private" },
    { status: 201 },
  );
}
