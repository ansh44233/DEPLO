import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as yazl from "yazl";
import { BuildArtifactError, downloadAndValidateBuildArtifact } from "../../lib/deploy/build-artifact";

const env = {
  DEPLO_BUILD_RUNNER_URL: "https://runner.example",
  DEPLO_BUILD_RUNNER_TOKEN: "r".repeat(48),
};
const html = Buffer.from("<!doctype html><html><body>DEPLO</body></html>");
const metadata = { artifactId: "artifact_123", outputFileCount: 1, outputBytes: html.byteLength };

function makeZip(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    const chunks: Buffer[] = [];
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.on("error", reject);
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    zip.addBuffer(html, "index.html", { compress: true });
    zip.end();
  });
}

function artifactFetcher(archive: Buffer, capture?: (url: string, init?: RequestInit) => void): typeof fetch {
  return async (url, init) => {
    capture?.(String(url), init);
    return new Response(archive, { headers: { "Content-Type": "application/zip", "Content-Length": String(archive.byteLength) } });
  };
}

test("downloads, extracts, and independently validates a runner artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "deplo-artifact-test-"));
  try {
    const archive = await makeZip();
    let requestedUrl = "";
    let requestInit: RequestInit | undefined;
    const result = await downloadAndValidateBuildArtifact(metadata, join(root, "work"), env, artifactFetcher(archive, (url, init) => {
      requestedUrl = url;
      requestInit = init;
    }));
    assert.equal(requestedUrl, "https://runner.example/v1/artifacts/artifact_123");
    assert.equal(requestInit?.method, "GET");
    assert.equal(requestInit?.redirect, "error");
    assert.equal(requestInit?.credentials, "omit");
    assert.equal((requestInit?.headers as Record<string, string>).Authorization, "Bearer " + env.DEPLO_BUILD_RUNNER_TOKEN);
    assert.equal((requestInit?.headers as Record<string, string>).Accept, "application/zip");
    assert.equal(result.fileCount, 1);
    assert.equal(result.totalBytes, html.byteLength);
    assert.equal(await readFile(join(result.extractionDirectory, "index.html"), "utf8"), html.toString());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects artifact metadata that is not a safe opaque identifier", async () => {
  await assert.rejects(
    downloadAndValidateBuildArtifact({ ...metadata, artifactId: "../secret" }, "/tmp/unused", env),
    (error: unknown) => error instanceof BuildArtifactError && error.code === "invalid_artifact",
  );
});

test("rejects a non-ZIP response and does not leave an extracted directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "deplo-artifact-invalid-"));
  try {
    await assert.rejects(
      downloadAndValidateBuildArtifact(metadata, join(root, "work"), env, async () =>
        new Response("not zip", { headers: { "Content-Type": "application/octet-stream" } })),
      (error: unknown) => error instanceof BuildArtifactError && error.code === "invalid_artifact",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects output metadata that does not match the extracted files", async () => {
  const root = await mkdtemp(join(tmpdir(), "deplo-artifact-mismatch-"));
  try {
    await assert.rejects(
      downloadAndValidateBuildArtifact({ ...metadata, outputBytes: metadata.outputBytes + 1 }, join(root, "work"), env, artifactFetcher(await makeZip())),
      /does not match the runner's output metadata/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects a ZIP that has no root index.html", async () => {
  const root = await mkdtemp(join(tmpdir(), "deplo-artifact-no-index-"));
  try {
    const archive = await new Promise<Buffer>((resolve, reject) => {
      const zip = new yazl.ZipFile();
      const chunks: Buffer[] = [];
      zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
      zip.outputStream.on("error", reject);
      zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
      zip.addBuffer(Buffer.from("asset"), "assets/app.js", { compress: true });
      zip.end();
    });
    await assert.rejects(
      downloadAndValidateBuildArtifact({ artifactId: "artifact_123", outputFileCount: 1, outputBytes: 5 }, join(root, "work"), env, artifactFetcher(archive)),
      /root index.html/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
