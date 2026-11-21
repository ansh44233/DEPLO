import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as yazl from "yazl";
import { createRunnerServer } from "../../services/build-runner/src/server";

const token = "runner-secret-".padEnd(40, "x");
const jobId = "00000000-0000-4000-8000-000000000001";
function makeZip(items: { name: string; content: Buffer; mode?: number }[] = [
  { name: "index.html", content: Buffer.from("<!doctype html><html></html>") },
]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    const chunks: Buffer[] = [];
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.on("error", reject);
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    for (const item of items) zip.addBuffer(item.content, item.name, { compress: true, ...(item.mode ? { mode: item.mode } : {}) });
    zip.end();
  });
}
async function setup(t: test.TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "deplo-runner-"));
  const server = createRunnerServer({ token, dataDir: dir });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test server address.");
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await rm(dir, { recursive: true, force: true }); });
  return { dir, base: "http://127.0.0.1:" + address.port };
}
function form(bytes: Uint8Array, metadata = { repositoryFullName: "octocat/hello-world", sourceCommitSha: "a".repeat(40) }) {
  const data = new FormData();
  data.set("metadata", JSON.stringify(metadata));
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  data.set("archive", new Blob([copy.buffer as ArrayBuffer], { type: "application/zip" }), "source.zip");
  return data;
}

test("health endpoint reports runner readiness without enabling builds", async t => {
  const archive = await makeZip();
  const { base } = await setup(t);
  const response = await fetch(base + "/healthz");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: "deplo-build-runner", buildsEnabled: false });
});

test("source intake requires authentication and stores immutable archive bytes", async t => {
  const archive = await makeZip();
  const { base, dir } = await setup(t);
  const denied = await fetch(base + "/v1/sources", { method: "POST", body: form(archive), headers: { "Idempotency-Key": jobId } });
  assert.equal(denied.status, 401);
  const response = await fetch(base + "/v1/sources", { method: "POST", body: form(archive), headers: { Authorization: "Bearer " + token, "Idempotency-Key": jobId } });
  assert.equal(response.status, 201);
  const payload = await response.json() as { sourceId: string };
  assert.match(payload.sourceId, /^src_[a-f0-9]{48}$/);
  assert.deepEqual(await readFile(join(dir, payload.sourceId + ".zip")), Buffer.from(archive));
});

test("source intake is idempotent and rejects conflicting retries", async t => {
  const archive = await makeZip();
  const { base, dir } = await setup(t);
  const send = (bytes: Uint8Array, sha = "a".repeat(40)) => fetch(base + "/v1/sources", {
    method: "POST", body: form(bytes, { repositoryFullName: "octocat/hello-world", sourceCommitSha: sha }),
    headers: { Authorization: "Bearer " + token, "Idempotency-Key": jobId },
  });
  const first = await send(archive);
  const firstBody = await first.json() as { sourceId: string };
  const retry = await send(archive);
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), firstBody);
  const conflict = await send(new Uint8Array([0x50, 0x4b, 3, 4, 9, 9]));
  assert.equal(conflict.status, 409);
  const files = await readdir(dir);
  assert.equal(files.filter(name => name.startsWith("idem-")).length, 1);
  assert.equal(files.filter(name => name.endsWith(".zip")).length, 1, "conflicting retry must not leave an orphan archive");
});

test("source intake rejects malformed metadata and non-ZIP payloads", async t => {
  const archive = await makeZip();
  const { base } = await setup(t);
  const send = (body: FormData) => fetch(base + "/v1/sources", {
    method: "POST", body, headers: { Authorization: "Bearer " + token, "Idempotency-Key": jobId },
  });
  assert.equal((await send(form(archive, { repositoryFullName: "../bad", sourceCommitSha: "a".repeat(40) }))).status, 400);
  assert.equal((await send(form(new Uint8Array([1, 2, 3, 4])))).status, 413);
  const malformedZip = new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3, 4]);
  assert.equal((await send(form(malformedZip))).status, 400);
});

test("build endpoint fails closed until an isolation backend is configured", async t => {
  const archive = await makeZip();
  const { base } = await setup(t);
  const response = await fetch(base + "/v1/builds", {
    method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: "{}",
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "sandbox_not_configured" });
});


test("maintenance cleanup expires old archives and matching idempotency records", async t => {
  const archive = await makeZip();
  const { base, dir } = await setup(t);
  const upload = await fetch(base + "/v1/sources", {
    method: "POST", body: form(archive),
    headers: { Authorization: "Bearer " + token, "Idempotency-Key": jobId },
  });
  assert.equal(upload.status, 201);
  const { sourceId } = await upload.json() as { sourceId: string };
  const files = await readdir(dir);
  const archivePath = join(dir, sourceId + ".zip");
  const recordPath = join(dir, files.find(name => name.startsWith("idem-"))!);
  const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  await utimes(archivePath, old, old);
  await utimes(recordPath, old, old);
  const denied = await fetch(base + "/v1/maintenance/cleanup", { method: "POST" });
  assert.equal(denied.status, 401);
  const response = await fetch(base + "/v1/maintenance/cleanup", {
    method: "POST", headers: { Authorization: "Bearer " + token },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { sourcesRemoved: 1, recordsRemoved: 1, bytesFreed: archive.length });
  assert.deepEqual(await readdir(dir), []);
});

test("maintenance cleanup keeps recent source archives", async t => {
  const archive = await makeZip();
  const { base, dir } = await setup(t);
  const response = await fetch(base + "/v1/sources", {
    method: "POST", body: form(archive),
    headers: { Authorization: "Bearer " + token, "Idempotency-Key": jobId },
  });
  assert.equal(response.status, 201);
  const cleanup = await fetch(base + "/v1/maintenance/cleanup", {
    method: "POST", headers: { Authorization: "Bearer " + token },
  });
  assert.deepEqual(await cleanup.json(), { sourcesRemoved: 0, recordsRemoved: 0, bytesFreed: 0 });
  assert.equal((await readdir(dir)).filter(name => name.endsWith(".zip")).length, 1);
});


test("runner HTTP server applies bounded header, request, and keep-alive limits", () => {
  const server = createRunnerServer({ token, dataDir: join(tmpdir(), "deplo-runner-unused") });
  assert.equal(server.headersTimeout, 15_000);
  assert.equal(server.requestTimeout, 120_000);
  assert.equal(server.keepAliveTimeout, 5_000);
  assert.equal(server.maxRequestsPerSocket, 100);
  assert.equal(server.maxHeadersCount, 50);
});


test("source intake rejects ZIP path traversal and symbolic links", async t => {
  const { base, dir } = await setup(t);
  const send = (bytes: Buffer, id: string) => fetch(base + "/v1/sources", {
    method: "POST", body: form(bytes),
    headers: { Authorization: "Bearer " + token, "Idempotency-Key": id },
  });
  const traversal = await makeZip([{ name: "../outside.txt", content: Buffer.from("no") }]);
  assert.equal((await send(traversal, "00000000-0000-4000-8000-000000000002")).status, 400);
  const symlink = await makeZip([{ name: "link", content: Buffer.from("target"), mode: 0o120777 }]);
  assert.equal((await send(symlink, "00000000-0000-4000-8000-000000000003")).status, 400);
  assert.deepEqual(await readdir(dir), []);
});
