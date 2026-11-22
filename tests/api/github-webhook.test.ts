import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { POST } from "../../app/api/webhooks/github/route";

const secret = "webhook-secret-for-tests-at-least-32-characters";
const delivery = randomUUID();
const payload = {
  ref: "refs/heads/main",
  after: "a".repeat(40),
  deleted: false,
  repository: { full_name: "Example/Website" },
  sender: { id: 1234 },
};
const raw = JSON.stringify(payload);
const signature = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");

function request(headers: Record<string, string>, body = raw) {
  return new NextRequest("https://deplo.example/api/webhooks/github", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "push",
      "x-github-delivery": delivery,
      "x-hub-signature-256": signature,
      ...headers,
    },
    body,
  });
}

test("rejects webhook when signature is invalid", async () => {
  process.env.DEPLO_GITHUB_WEBHOOK_SECRET = secret;
  const response = await POST(request({ "x-hub-signature-256": "sha256=" + "0".repeat(64) }));
  assert.equal(response.status, 401);
});

test("ignores non-push events without persisting them", async () => {
  process.env.DEPLO_GITHUB_WEBHOOK_SECRET = secret;
  const req = request({ "x-github-event": "issues" });
  const response = await POST(req);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ignored, true);
});

test("rejects malformed repository and branch information after signature verification", async () => {
  process.env.DEPLO_GITHUB_WEBHOOK_SECRET = secret;
  const invalid = JSON.stringify({ ...payload, repository: { full_name: "attacker value" } });
  const signed = "sha256=" + createHmac("sha256", secret).update(invalid).digest("hex");
  const response = await POST(request({ "x-hub-signature-256": signed }, invalid));
  assert.equal(response.status, 400);
});

test("ignores deleted branches after signature verification", async () => {
  process.env.DEPLO_GITHUB_WEBHOOK_SECRET = secret;
  const deleted = JSON.stringify({ ...payload, deleted: true });
  const signed = "sha256=" + createHmac("sha256", secret).update(deleted).digest("hex");
  const response = await POST(request({ "x-hub-signature-256": signed }, deleted));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).reason, "branch-deleted");
});

import { normalizeInstallationLifecycleEvent } from "../../lib/github/installation-lifecycle";

test("normalizes GitHub App installation lifecycle actions", () => {
  assert.deepEqual(normalizeInstallationLifecycleEvent("suspend", 123), { operation: "suspend", installationId: 123 });
  assert.deepEqual(normalizeInstallationLifecycleEvent("unsuspend", 123), { operation: "unsuspend", installationId: 123 });
  assert.deepEqual(normalizeInstallationLifecycleEvent("created", 123), { operation: "unsuspend", installationId: 123 });
  assert.deepEqual(normalizeInstallationLifecycleEvent("deleted", 123), { operation: "delete", installationId: 123 });
  assert.equal(normalizeInstallationLifecycleEvent("other", 123), null);
  assert.equal(normalizeInstallationLifecycleEvent("deleted", -1), null);
});

function signedPullRequest(body: Record<string, unknown>, deliveryId = randomUUID()) {
  const text = JSON.stringify(body);
  return new NextRequest("https://deplo.example/api/webhooks/github", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "pull_request",
      "x-github-delivery": deliveryId,
      "x-hub-signature-256": "sha256=" + createHmac("sha256", secret).update(text).digest("hex"),
    },
    body: text,
  });
}

const pullRequestPayload = {
  action: "synchronize",
  number: 42,
  repository: { full_name: "Example/Website" },
  sender: { id: 1234 },
  pull_request: {
    number: 42,
    base: { ref: "main" },
    head: { sha: "b".repeat(40), repo: { full_name: "Example/Website" } },
  },
};

test("ignores pull requests from forks without persisting them", async () => {
  process.env.DEPLO_GITHUB_WEBHOOK_SECRET = secret;
  const fork = {
    ...pullRequestPayload,
    pull_request: { ...pullRequestPayload.pull_request, head: { sha: "b".repeat(40), repo: { full_name: "attacker/Website" } } },
  };
  const response = await POST(signedPullRequest(fork));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).reason, "fork-pull-request");
});

test("ignores closed pull requests", async () => {
  process.env.DEPLO_GITHUB_WEBHOOK_SECRET = secret;
  const response = await POST(signedPullRequest({ ...pullRequestPayload, action: "closed" }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).reason, "action-not-previewed");
});

test("rejects malformed pull request payloads after signature verification", async () => {
  process.env.DEPLO_GITHUB_WEBHOOK_SECRET = secret;
  const response = await POST(signedPullRequest({ ...pullRequestPayload, number: "42" }));
  assert.equal(response.status, 400);
});

test("records pull request deliveries with the base branch, head commit and PR number", async (t) => {
  process.env.DEPLO_GITHUB_WEBHOOK_SECRET = secret;
  process.env.SUPABASE_URL = "https://db.example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-for-tests";
  const deliveryId = randomUUID();
  let stored: Record<string, unknown> | null = null;
  t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    stored = JSON.parse(String(init?.body)) as Record<string, unknown>;
    // An empty representation means "already stored", so no background worker is kicked.
    return new Response("[]", { status: 201, headers: { "content-type": "application/json" } });
  });
  try {
    const response = await POST(signedPullRequest(pullRequestPayload, deliveryId));
    assert.equal(response.status, 202);
    assert.deepEqual(stored, {
      delivery_id: deliveryId,
      repository_full_name: "example/website",
      branch: "main",
      commit_sha: "b".repeat(40),
      sender_github_id: 1234,
      pull_request_number: 42,
      status: "received",
    });
  } finally {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
});
