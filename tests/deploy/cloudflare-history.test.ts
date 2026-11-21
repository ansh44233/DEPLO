import test from "node:test";
import assert from "node:assert/strict";
import {
  listCloudflarePagesDeployments,
  normalizeCloudflareDeployments,
} from "../../lib/deploy/cloudflare-history";

const config = {
  accountId: "account-id",
  apiToken: "secret-token",
  projectName: "deplo-sites",
};

test("normalizes Cloudflare deployment records and limits output", () => {
  const result = normalizeCloudflareDeployments([{
    id: "deployment-1",
    url: "https://abc123.deplo-sites.pages.dev",
    environment: "production",
    created_on: "2026-11-21T10:00:00.000Z",
    latest_stage: { status: "success" },
    deployment_trigger: { metadata: { branch: "main", commit_message: "Add homepage" } },
  }, {
    id: "invalid",
    url: "https://example.com",
  }]);
  assert.deepEqual(result, [{
    id: "deployment-1",
    url: "https://abc123.deplo-sites.pages.dev",
    environment: "production",
    createdAt: "2026-11-21T10:00:00.000Z",
    branch: "main",
    commitMessage: "Add homepage",
    status: "success",
  }]);
});

test("ignores malformed deployment records and unknown fields", () => {
  assert.deepEqual(normalizeCloudflareDeployments([
    null,
    { id: "missing-url" },
    { id: "bad-url", url: "https://example.com" },
  ]), []);
});

test("requests deployment history with bearer auth and no-store", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const deployments = await listCloudflarePagesDeployments(config, async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(JSON.stringify({
      success: true,
      result: [{
        id: "dpl-1",
        url: "https://preview.deplo-sites.pages.dev",
        latest_stage: { status: "building" },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  });

  assert.match(requestUrl, /per_page=20/);
  assert.equal(new Headers(requestInit?.headers).get("authorization"), "Bearer secret-token");
  assert.equal(requestInit?.cache, "no-store");
  assert.equal(deployments[0]?.status, "building");
});

test("rejects failed Cloudflare API responses without leaking credentials", async () => {
  await assert.rejects(
    listCloudflarePagesDeployments(config, async () =>
      new Response(JSON.stringify({ success: false, errors: [{ message: "bad token" }] }), { status: 200 })),
    /invalid deployment history response/,
  );
});
