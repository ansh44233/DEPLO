import test from "node:test";
import assert from "node:assert/strict";
import * as yazl from "yazl";
import { NextRequest } from "next/server";
import { POST } from "../../app/api/internal/github-webhooks/process/route";
import { generateKeyPairSync } from "node:crypto";
import { getAccountPagesTarget } from "../../lib/deploy/cloudflare-projects";

// End-to-end run of the GitHub webhook worker. The real code downloads, unzips, inspects
// and publishes the site; only the network edges (Supabase, GitHub, Cloudflare) are faked.

const workerSecret = "worker-secret-for-tests-at-least-32-characters";
const supabase = "https://db.example.supabase.co";
const sha = "c".repeat(40);
const ownerGithubId = 1234;
const slug = "website";
const target = getAccountPagesTarget({ accountId: "acct", apiToken: "cf-token" }, ownerGithubId, slug);
const subdomain = target.config.projectName + ".pages.dev";

type Call = { method: string; url: URL; body: unknown; authorization?: string | null };

function zipOf(files: Record<string, string>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    const chunks: Buffer[] = [];
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.on("error", reject);
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    // GitHub zipballs wrap everything in a single "<owner>-<repo>-<sha>/" directory.
    for (const [name, content] of Object.entries(files)) zip.addBuffer(Buffer.from(content), "example-website-" + sha.slice(0, 7) + "/" + name);
    zip.end();
  });
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

const appKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const installationToken = "ghs_" + "t".repeat(36);

async function runWorker(t: test.TestContext, delivery: Record<string, unknown>, options: { cloudflareDeployFails?: boolean; installationId?: number } = {}) {
  process.env.SUPABASE_URL = supabase;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-for-tests";
  process.env.CLOUDFLARE_ACCOUNT_ID = "acct";
  process.env.CLOUDFLARE_API_TOKEN = "cf-token";
  process.env.DEPLO_WEBHOOK_WORKER_SECRET = workerSecret;
  process.env.GITHUB_APP_ID = "12345";
  process.env.GITHUB_APP_PRIVATE_KEY = appKey;
  t.after(() => {
    for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "DEPLO_WEBHOOK_WORKER_SECRET", "GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY"]) delete process.env[key];
  });

  const archive = await zipOf({ "index.html": "<!doctype html><title>Preview</title>", "style.css": "body{}" });
  const calls: Call[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const method = (init.method ?? "GET").toUpperCase();
    const body = init.body instanceof FormData ? init.body : typeof init.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ method, url, body, authorization: new Headers(init.headers).get("authorization") });
    const path = url.pathname;

    if (url.origin === supabase) {
      if (path === "/rest/v1/rpc/claim_next_github_webhook_delivery") return json([delivery]);
      if (path === "/rest/v1/github_app_installations") return json(options.installationId ? [{ installation_id: options.installationId }] : []);
      if (path === "/rest/v1/projects" && method === "GET") {
        return json([{ id: "p1", owner_github_id: ownerGithubId, slug, repository_url: "https://github.com/Example/Website", branch: "main", source_type: "github" }]);
      }
      if (path === "/rest/v1/projects" && method === "PATCH") return json([{ id: "p1" }]);
      if (path === "/rest/v1/rpc/finish_github_webhook_delivery") return new Response(null, { status: 204 });
    }
    if (url.origin === "https://api.github.com" && path === "/app/installations/" + options.installationId + "/access_tokens" && method === "POST") {
      return json({ token: installationToken }, 201);
    }
    if (url.origin === "https://api.github.com" && path === "/repos/example/website/zipball/" + sha) {
      return new Response(new Uint8Array(archive), { status: 200, headers: { "content-type": "application/zip" } });
    }
    if (url.origin === "https://api.cloudflare.com") {
      const project = "/client/v4/accounts/acct/pages/projects/" + target.config.projectName;
      if (path === project && method === "GET") {
        return json({ success: true, result: { name: target.config.projectName, production_branch: target.productionBranch, subdomain } });
      }
      if (path === project + "/upload-token") return json({ success: true, result: { jwt: "upload-jwt" } });
      if (path === "/client/v4/pages/assets/check-missing") return json({ success: true, result: [] });
      if (path === "/client/v4/pages/assets/upsert-hashes") return json({ success: true, result: null });
      if (path === project + "/deployments" && method === "POST") {
        if (options.cloudflareDeployFails) return json({ success: false, errors: [{ code: 8000000, message: "boom" }] }, 500);
        return json({ success: true, result: { id: "dep-1", url: "https://abc123." + subdomain } });
      }
    }
    throw new Error("Unexpected request in test: " + method + " " + url.toString());
  });

  const response = await POST(new NextRequest("https://deplo.example/api/internal/github-webhooks/process", {
    method: "POST",
    headers: { authorization: "Bearer " + workerSecret },
  }));
  return { response, payload: await response.json() as Record<string, unknown>, calls };
}

const baseDelivery = { delivery_id: "00000000-0000-4000-8000-000000000001", repository_full_name: "example/website", branch: "main", commit_sha: sha, attempt_count: 1 };

function deployedBranch(calls: Call[]) {
  const deploy = calls.find((call) => call.method === "POST" && call.url.pathname.endsWith("/deployments"));
  return deploy?.body instanceof FormData ? deploy.body.get("branch") : null;
}

function finishBody(calls: Call[]) {
  return calls.find((call) => call.url.pathname === "/rest/v1/rpc/finish_github_webhook_delivery")?.body as Record<string, unknown> | undefined;
}

test("a pull request delivery deploys a preview branch and leaves production untouched", async (t) => {
  const { response, payload, calls } = await runWorker(t, { ...baseDelivery, pull_request_number: 42 });
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.deepEqual(payload, {
    processed: true,
    deployed: 1,
    pullRequest: 42,
    previewUrls: ["https://pr-42." + subdomain],
  });
  assert.equal(deployedBranch(calls), "pr-42");
  assert.equal(calls.some((call) => call.method === "PATCH" && call.url.pathname === "/rest/v1/projects"), false,
    "a preview must not overwrite the project's production URL");
  assert.equal(finishBody(calls)?.p_status, "deployed");
});

test("a push delivery still deploys production and saves the production URL", async (t) => {
  const { response, payload, calls } = await runWorker(t, { ...baseDelivery, pull_request_number: null });
  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.deepEqual(payload, { processed: true, deployed: 1 });
  assert.equal(deployedBranch(calls), target.productionBranch);
  const patch = calls.find((call) => call.method === "PATCH" && call.url.pathname === "/rest/v1/projects");
  assert.equal((patch?.body as Record<string, unknown> | undefined)?.deployment_url, "https://" + subdomain);
  assert.equal(finishBody(calls)?.p_status, "deployed");
});

test("deliveries stored before the migration (no pull_request_number field) deploy production", async (t) => {
  const { payload, calls } = await runWorker(t, baseDelivery);
  assert.equal(payload.deployed, 1);
  assert.equal(deployedBranch(calls), target.productionBranch);
});

test("a failed preview deploy is reported for retry and never touches production", async (t) => {
  const { response, payload, calls } = await runWorker(t, { ...baseDelivery, pull_request_number: 42 }, { cloudflareDeployFails: true });
  assert.equal(response.status, 502);
  assert.equal(payload.deployed, 0);
  assert.equal(finishBody(calls)?.p_status, "failed");
  assert.equal(calls.some((call) => call.method === "PATCH" && call.url.pathname === "/rest/v1/projects"), false);
});

test("rejects worker calls without the worker secret", async () => {
  process.env.DEPLO_WEBHOOK_WORKER_SECRET = workerSecret;
  const response = await POST(new NextRequest("https://deplo.example/api/internal/github-webhooks/process", {
    method: "POST",
    headers: { authorization: "Bearer wrong-secret-wrong-secret-wrong-secret" },
  }));
  assert.equal(response.status, 401);
  delete process.env.DEPLO_WEBHOOK_WORKER_SECRET;
});

// ---- Security ----

test("the GitHub token minted for a delivery can read only that one repository", async (t) => {
  const { payload, calls } = await runWorker(t, { ...baseDelivery, pull_request_number: 42 }, { installationId: 5 });
  assert.equal(payload.deployed, 1, JSON.stringify(payload));
  const mint = calls.find((call) => call.url.pathname === "/app/installations/5/access_tokens");
  assert.deepEqual(mint?.body, { repositories: ["website"], permissions: { contents: "read", metadata: "read" } });
  const download = calls.find((call) => call.url.pathname.endsWith("/zipball/" + sha));
  assert.equal(download?.authorization, "Bearer " + installationToken);
});

test("the token is never sent anywhere except GitHub", async (t) => {
  const { calls } = await runWorker(t, { ...baseDelivery, pull_request_number: 42 }, { installationId: 5 });
  let carriers = 0;
  for (const call of calls) {
    const carriesToken = JSON.stringify(call.body ?? "").includes(installationToken) || (call.authorization ?? "").includes(installationToken);
    if (!carriesToken) continue;
    carriers += 1;
    assert.equal(call.url.origin, "https://api.github.com", "token leaked to " + call.method + " " + call.url);
  }
  assert.ok(carriers > 0, "the token was used to download the source");
});

test("a hostile branch name cannot inject extra database filters", async (t) => {
  const hostile = "main&select=*&owner_github_id=gt.0&or=(id.not.is.null)";
  const { calls } = await runWorker(t, { ...baseDelivery, branch: hostile, pull_request_number: 42 });
  const lookup = calls.find((call) => call.method === "GET" && call.url.pathname === "/rest/v1/projects");
  assert.ok(lookup, "projects were queried");
  assert.equal(lookup.url.searchParams.get("branch"), "eq." + hostile);
  assert.equal(lookup.url.searchParams.get("select"), "id,owner_github_id,slug,repository_url,branch,source_type");
  assert.equal(lookup.url.searchParams.has("or"), false);
  assert.equal(lookup.url.searchParams.get("owner_github_id"), null);
});

test("a delivery for another repository never deploys someone else's project", async (t) => {
  const { payload, calls } = await runWorker(t, { ...baseDelivery, repository_full_name: "attacker/website", pull_request_number: 42 });
  assert.equal(payload.deployed, 0);
  assert.equal(payload.ignored, true);
  assert.equal(calls.some((call) => call.url.origin === "https://api.cloudflare.com"), false);
  assert.equal(finishBody(calls)?.p_status, "ignored");
});

test("a preview can never be written to the production branch", async (t) => {
  for (const pull_request_number of [1, 42, 999_999_999]) {
    const { calls } = await runWorker(t, { ...baseDelivery, pull_request_number });
    const branch = deployedBranch(calls);
    assert.equal(branch, "pr-" + pull_request_number);
    assert.notEqual(branch, target.productionBranch);
  }
});

test("a malformed pull request number fails the delivery without deploying", async (t) => {
  for (const pull_request_number of [0, -1, 1.5, 1_000_000_000]) {
    const { response, payload, calls } = await runWorker(t, { ...baseDelivery, pull_request_number });
    assert.equal(response.status, 502, String(pull_request_number));
    assert.equal(payload.deployed, 0);
    assert.equal(deployedBranch(calls), null);
    assert.equal(calls.some((call) => call.method === "PATCH" && call.url.pathname === "/rest/v1/projects"), false);
  }
});

test("worker endpoints reject missing, empty, short and mismatched secrets", async () => {
  process.env.DEPLO_WEBHOOK_WORKER_SECRET = workerSecret;
  const call = (authorization?: string) => POST(new NextRequest("https://deplo.example/api/internal/github-webhooks/process", {
    method: "POST",
    headers: authorization === undefined ? {} : { authorization },
  }));
  for (const header of [undefined, "", "Bearer", "Bearer ", "Basic " + workerSecret, workerSecret, "Bearer " + workerSecret.slice(1), "Bearer " + workerSecret + "x"]) {
    assert.equal((await call(header)).status, 401, String(header));
  }
  // An unset or too-short server secret must never authenticate, even against a matching header.
  for (const configured of [undefined, "", "short"]) {
    if (configured === undefined) delete process.env.DEPLO_WEBHOOK_WORKER_SECRET; else process.env.DEPLO_WEBHOOK_WORKER_SECRET = configured;
    assert.equal((await call("Bearer " + (configured ?? ""))).status, 401, String(configured));
  }
  delete process.env.DEPLO_WEBHOOK_WORKER_SECRET;
});
