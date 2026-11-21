import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeWebhookErrorCode } from "../../lib/github/webhook-deliveries";

test("keeps safe webhook error codes", () => {
  assert.equal(sanitizeWebhookErrorCode("cloudflare_timeout"), "cloudflare_timeout");
  assert.equal(sanitizeWebhookErrorCode("NO_MATCHING_PROJECT"), "NO_MATCHING_PROJECT");
});

test("hides malformed webhook error details", () => {
  assert.equal(sanitizeWebhookErrorCode("token=secret-value"), "deployment_failed");
  assert.equal(sanitizeWebhookErrorCode({ message: "private detail" }), null);
  assert.equal(sanitizeWebhookErrorCode(null), null);
});
