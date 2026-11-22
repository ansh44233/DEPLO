import { createWriteStream } from "node:fs";
import { mkdir, open, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { extractZipSafely } from "@/lib/uploads/extract-zip";
import { inspectStaticDirectory } from "@/lib/deploy/static-assets";
import { readBuildRunnerConfiguration } from "@/lib/deploy/build-runner-contract";

export const MAX_BUILD_ARTIFACT_ARCHIVE_BYTES = 100 * 1024 * 1024;

export class BuildArtifactError extends Error {
  constructor(message: string, public readonly code: "not_configured" | "unavailable" | "rejected" | "invalid_artifact") {
    super(message);
    this.name = "BuildArtifactError";
  }
}

type ArtifactMetadata = { artifactId: string; outputFileCount: number; outputBytes: number };
type Fetcher = typeof fetch;

/** Downloads a runner ZIP into private temporary storage and independently validates its contents. */
export async function downloadAndValidateBuildArtifact(
  metadata: ArtifactMetadata,
  workDirectory: string,
  env: Record<string, string | undefined> = process.env,
  fetcher: Fetcher = fetch,
): Promise<{ extractionDirectory: string; archiveBytes: number; fileCount: number; totalBytes: number }> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(metadata.artifactId) ||
      !Number.isSafeInteger(metadata.outputFileCount) || metadata.outputFileCount < 1 || metadata.outputFileCount > 5_000 ||
      !Number.isSafeInteger(metadata.outputBytes) || metadata.outputBytes < 1 || metadata.outputBytes > 100 * 1024 * 1024) {
    throw new BuildArtifactError("The build artifact metadata is invalid.", "invalid_artifact");
  }

  const config = readBuildRunnerConfiguration(env);
  if (!config) throw new BuildArtifactError("The isolated build runner is not configured.", "not_configured");

  const endpoint = new URL("/v1/artifacts/" + encodeURIComponent(metadata.artifactId), config.endpoint);
  if (endpoint.origin !== config.endpoint.origin || (endpoint.protocol !== "https:" && endpoint.hostname !== "localhost")) {
    throw new BuildArtifactError("The configured artifact endpoint is invalid.", "not_configured");
  }

  const archivePath = join(workDirectory, "build-artifact.zip");
  const extractionDirectory = join(workDirectory, "validated-output");
  try {
    const response = await fetcher(endpoint, {
      method: "GET",
      headers: { Authorization: "Bearer " + config.token, Accept: "application/zip" },
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
    });

    if (response.status === 429 || response.status >= 500) throw new BuildArtifactError("The build runner is temporarily unavailable.", "unavailable");
    if (!response.ok) throw new BuildArtifactError("The build runner rejected the artifact request.", "rejected");
    if ((response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() !== "application/zip") {
      throw new BuildArtifactError("The build runner returned an unexpected artifact content type.", "invalid_artifact");
    }
    if (!response.body) throw new BuildArtifactError("The build runner returned an empty artifact.", "invalid_artifact");

    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader !== null) {
      if (!/^\d+$/.test(contentLengthHeader)) throw new BuildArtifactError("The artifact size header is invalid.", "invalid_artifact");
      const declaredLength = Number(contentLengthHeader);
      if (!Number.isSafeInteger(declaredLength) || declaredLength < 4 || declaredLength > MAX_BUILD_ARTIFACT_ARCHIVE_BYTES) {
        throw new BuildArtifactError("The build artifact exceeds the archive size limit.", "invalid_artifact");
      }
    }

    let archiveBytes = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        archiveBytes += chunk.length;
        if (archiveBytes > MAX_BUILD_ARTIFACT_ARCHIVE_BYTES) {
          callback(new BuildArtifactError("The build artifact exceeds the 100 MiB archive limit.", "invalid_artifact"));
          return;
        }
        callback(null, chunk);
      },
    });

    await mkdir(workDirectory, { recursive: false, mode: 0o700 });
    await pipeline(
      Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>),
      meter,
      createWriteStream(archivePath, { flags: "wx", mode: 0o600 }),
    );

    if (archiveBytes < 4) throw new BuildArtifactError("The build runner returned an empty artifact.", "invalid_artifact");
    if (contentLengthHeader !== null && archiveBytes !== Number(contentLengthHeader)) {
      throw new BuildArtifactError("The artifact did not match its declared content length.", "invalid_artifact");
    }

    const archiveHandle = await open(archivePath, "r");
    try {
      const signature = Buffer.alloc(4);
      const read = await archiveHandle.read(signature, 0, 4, 0);
      if (read.bytesRead !== 4 || signature[0] !== 0x50 || signature[1] !== 0x4b) {
        throw new BuildArtifactError("The build runner did not return a valid ZIP archive.", "invalid_artifact");
      }
    } finally {
      await archiveHandle.close();
    }

    const extracted = await extractZipSafely(archivePath, extractionDirectory);
    const index = await stat(join(extractionDirectory, "index.html")).catch(() => null);
    if (!index?.isFile()) throw new BuildArtifactError("The build output must contain a root index.html file.", "invalid_artifact");

    const assets = await inspectStaticDirectory(extractionDirectory);
    if (extracted.fileCount !== metadata.outputFileCount || assets.fileCount !== metadata.outputFileCount ||
        extracted.totalBytes !== metadata.outputBytes || assets.totalBytes !== metadata.outputBytes) {
      throw new BuildArtifactError("The extracted artifact does not match the runner's output metadata.", "invalid_artifact");
    }

    return { extractionDirectory, archiveBytes, fileCount: assets.fileCount, totalBytes: assets.totalBytes };
  } catch (error) {
    await rm(extractionDirectory, { recursive: true, force: true }).catch(() => undefined);
    await rm(archivePath, { force: true }).catch(() => undefined);
    if (error instanceof BuildArtifactError) throw error;
    throw new BuildArtifactError("The build artifact could not be validated due to an internal processing error.", "invalid_artifact");
  }
}
