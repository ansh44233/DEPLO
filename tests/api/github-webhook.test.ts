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
