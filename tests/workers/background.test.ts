import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkerKick, drainWorker, isAuthorizedWorkerRequest, kickWorker, resolveSelfBaseUrl } from "../../lib/workers/background";

const workerSecret = "w".repeat(40);
const cronSecret = "c".repeat(40);

test("accepts any configured worker secret and ignores short or missing ones", () => {
  assert.equal(isAuthorizedWorkerRequest("Bearer " + workerSecret, [workerSecret]), true);
  assert.equal(isAuthorizedWorkerRequest("Bearer " + cronSecret, [undefined, cronSecret, workerSecret]), true);
  assert.equal(isAuthorizedWorkerRequest("Bearer " + workerSecret, [cronSecret]), false);
  assert.equal(isAuthorizedWorkerRequest("Bearer short", ["short"]), false);
  assert.equal(isAuthorizedWorkerRequest("Bearer ", [undefined, ""]), false);
  assert.equal(isAuthorizedWorkerRequest(null, [workerSecret]), false);
  assert.equal(isAuthorizedWorkerRequest(workerSecret, [workerSecret]), false);
});

test("resolves the self URL from DEPLO_BASE_URL, then the Vercel production host", () => {
  assert.equal(resolveSelfBaseUrl({ DEPLO_BASE_URL: "https://deplo.example.com/some/path" }), "https://deplo.example.com");
  assert.equal(resolveSelfBaseUrl({ VERCEL_PROJECT_PRODUCTION_URL: "deplo.vercel.app" }), "https://deplo.vercel.app");
  assert.equal(resolveSelfBaseUrl({ DEPLO_BASE_URL: "http://localhost:3000" }), "http://localhost:3000");
  assert.equal(resolveSelfBaseUrl({ DEPLO_BASE_URL: "http://insecure.example.com" }), null);
  assert.equal(resolveSelfBaseUrl({}), null);
});

test("builds an authenticated worker kick only when fully configured", () => {
  const kick = buildWorkerKick("/api/internal/build-jobs/process", workerSecret, { DEPLO_BASE_URL: "https://deplo.example.com" });
  assert.equal(kick?.url, "https://deplo.example.com/api/internal/build-jobs/process");
  assert.equal(kick?.init.method, "POST");
  assert.equal((kick?.init.headers as Record<string, string>).Authorization, "Bearer " + workerSecret);
  assert.equal(buildWorkerKick("/api/internal/build-jobs/process", "short", { DEPLO_BASE_URL: "https://deplo.example.com" }), null);
  assert.equal(buildWorkerKick("/api/internal/build-jobs/process", workerSecret, {}), null);
});

test("kickWorker never throws when the worker is unreachable", async () => {
  const failing = (async () => { throw new Error("network down"); }) as unknown as typeof fetch;
  assert.equal(await kickWorker("/api/internal/github-webhooks/process", workerSecret, { DEPLO_BASE_URL: "https://deplo.example.com" }, failing), false);
  assert.equal(await kickWorker("/api/internal/github-webhooks/process", undefined, { DEPLO_BASE_URL: "https://deplo.example.com" }, failing), false);
});

test("drains until the queue is empty", async () => {
  const replies = [{ processed: true }, { processed: true }, { processed: false, reason: "queue-empty" }];
  let calls = 0;
  const result = await drainWorker(async () => Response.json(replies[calls++]));
  assert.deepEqual(result, { steps: 3, lastStatus: 200, drained: true });
});

test("stops draining on a failed step or when the budget is spent", async () => {
  const failed = await drainWorker(async () => Response.json({ processed: true, error: "x" }, { status: 502 }));
  assert.deepEqual(failed, { steps: 1, lastStatus: 502, drained: false });

  let clock = 0;
  const budget = await drainWorker(async () => { clock += 100; return Response.json({ processed: true }); }, { budgetMs: 250, now: () => clock });
  assert.equal(budget.steps, 3);
  assert.equal(budget.drained, false);

  const capped = await drainWorker(async () => Response.json({ processed: true }), { maxSteps: 4 });
  assert.equal(capped.steps, 4);
});
