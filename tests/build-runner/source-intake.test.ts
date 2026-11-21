import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunnerServer } from "../../services/build-runner/src/server";

const token = "runner-secret-".padEnd(40, "x");
const jobId = "00000000-0000-4000-8000-000000000001";
const archive = new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3, 4]);
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
  data.set("archive", new Blob([bytes], { type: "application/zip" }), "source.zip");
  return data;
}

test("health endpoint reports runner readiness without enabling builds", async t => {
  const { base } = await setup(t);
  const response = await fetch(base + "/healthz");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: "deplo-build-runner", buildsEnabled: false });
});

test("source intake requires authentication and stores immutable archive bytes", async t => {
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
});

test("source intake rejects malformed metadata and non-ZIP payloads", async t => {
  const { base } = await setup(t);
  const send = (body: FormData) => fetch(base + "/v1/sources", {
    method: "POST", body, headers: { Authorization: "Bearer " + token, "Idempotency-Key": jobId },
  });
  assert.equal((await send(form(archive, { repositoryFullName: "../bad", sourceCommitSha: "a".repeat(40) }))).status, 400);
  assert.equal((await send(form(new Uint8Array([1, 2, 3, 4])))).status, 413);
});

test("build endpoint fails closed until an isolation backend is configured", async t => {
  const { base } = await setup(t);
  const response = await fetch(base + "/v1/builds", {
    method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: "{}",
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "sandbox_not_configured" });
});
