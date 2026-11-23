import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { POST } from "../../app/api/webhooks/github/route";

// Security tests for the public webhook endpoint: authenticity, integrity, resource limits
// and input validation. None of these may reach storage.

const secret = "webhook-secret-for-tests-at-least-32-characters";
const pullRequest = {
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
const body = JSON.stringify(pullRequest);

function sign(text: string, key = secret) {
  return "sha256=" + createHmac("sha256", key).update(text).digest("hex");
}

function send(text: string, headers: Record<string, string>) {
  return POST(new NextRequest("https://deplo.example/api/webhooks/github", {
    method: "POST",
    headers: { "content-type": "application/json", "x-github-delivery": randomUUID(), ...headers },
    body: text,
  }));
}

test.beforeEach(() => { process.env.DEPLO_GITHUB_WEBHOOK_SECRET = secret; });
test.after(() => { delete process.env.DEPLO_GITHUB_WEBHOOK_SECRET; });

test("rejects a missing, malformed or wrong-length signature header", async () => {
  const bad = [undefined, "", "sha256=", "sha256=abc", "sha1=" + "a".repeat(40), "a".repeat(64),
    "sha256=" + "g".repeat(64), "sha256=" + "a".repeat(63), "sha256=" + "a".repeat(65)];
  for (const signature of bad) {
    const response = await send(body, { "x-github-event": "pull_request", ...(signature === undefined ? {} : { "x-hub-signature-256": signature }) });
    assert.equal(response.status, 401, String(signature));
  }
});

test("rejects a payload altered after it was signed", async () => {
  const tampered = body.replace("main", "prod");
  assert.notEqual(tampered, body);
  const response = await send(tampered, { "x-github-event": "pull_request", "x-hub-signature-256": sign(body) });
  assert.equal(response.status, 401);
});

test("rejects a signature made with a different secret", async () => {
  const forged = sign(body, "another-secret-that-is-also-32-characters-long");
  const response = await send(body, { "x-github-event": "pull_request", "x-hub-signature-256": forged });
  assert.equal(response.status, 401);
});

test("verifies the signature even when its hex is upper-case", async () => {
  const upper = "sha256=" + sign(body).slice(7).toUpperCase();
  const accepted = await send(body, { "x-github-event": "pull_request", "x-hub-signature-256": upper });
  assert.notEqual(accepted.status, 401);
  const forged = "sha256=" + "A".repeat(64);
  const rejected = await send(body, { "x-github-event": "pull_request", "x-hub-signature-256": forged });
  assert.equal(rejected.status, 401);
});

test("refuses to run when the webhook secret is missing or too short", async () => {
  for (const configured of [undefined, "", "short"]) {
    if (configured === undefined) delete process.env.DEPLO_GITHUB_WEBHOOK_SECRET;
    else process.env.DEPLO_GITHUB_WEBHOOK_SECRET = configured;
    // Even a signature made with that same weak secret must not be accepted.
    const response = await send(body, { "x-github-event": "pull_request", "x-hub-signature-256": sign(body, configured ?? "") });
    assert.equal(response.status, 503, String(configured));
  }
});

test("rejects oversized payloads whether or not the client declares their size honestly", async () => {
  const big = JSON.stringify({ ...pullRequest, padding: "x".repeat(300 * 1024) });
  const headers = { "x-github-event": "pull_request", "x-hub-signature-256": sign(big) };
  const declared = await send(big, { ...headers, "content-length": String(Buffer.byteLength(big)) });
  assert.equal(declared.status, 413);
  const lying = await send(big, { ...headers, "content-length": "10" });
  assert.equal(lying.status, 413);
});

test("rejects delivery IDs that are not UUIDs", async () => {
  const ids = ["", "not-a-uuid", "../../etc/passwd", randomUUID() + "x", "'; drop table github_webhook_deliveries; --"];
  for (const id of ids) {
    const response = await send(body, { "x-github-event": "pull_request", "x-hub-signature-256": sign(body), "x-github-delivery": id });
    assert.equal(response.status, 400, id);
  }
});

test("a signed but non-JSON body is a 400, not a crash", async () => {
  const text = "{not json";
  const response = await send(text, { "x-github-event": "pull_request", "x-hub-signature-256": sign(text) });
  assert.equal(response.status, 400);
});

test("a signed push payload cannot carry a path-rewriting repository name", async () => {
  const push = { ref: "refs/heads/main", after: "a".repeat(40), deleted: false, sender: { id: 1 } };
  for (const full_name of ["../x", "x/..", "./x", "a/b/c"]) {
    const text = JSON.stringify({ ...push, repository: { full_name } });
    const response = await send(text, { "x-github-event": "push", "x-hub-signature-256": sign(text) });
    assert.equal(response.status, 400, full_name);
  }
});

test("a signed pull request payload cannot carry a path-rewriting repository name", async () => {
  for (const full_name of ["../x", "x/..", "a/b/c"]) {
    const text = JSON.stringify({ ...pullRequest, repository: { full_name } });
    const response = await send(text, { "x-github-event": "pull_request", "x-hub-signature-256": sign(text) });
    assert.equal(response.status, 400, full_name);
  }
});

test("unexpected event types are acknowledged and never stored", async (t) => {
  process.env.SUPABASE_URL = "https://db.example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key-for-tests";
  const fetchMock = t.mock.method(globalThis, "fetch", async () => { throw new Error("must not reach storage"); });
  try {
    for (const event of ["issues", "pull_request_review", "workflow_run", "ping", "create", ""]) {
      const response = await send(body, { "x-github-event": event, "x-hub-signature-256": sign(body) });
      assert.equal(response.status, 200, event);
    }
    assert.equal(fetchMock.mock.callCount(), 0);
  } finally {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
});
