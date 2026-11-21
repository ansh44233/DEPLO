import test from "node:test";
import assert from "node:assert/strict";
import { isAuthorizedUploadRequest } from "../../lib/uploads/upload-auth";

const token = "deplo-test-token-which-is-long-enough-123456";

test("accepts the exact configured bearer token", () => {
  assert.equal(isAuthorizedUploadRequest(`Bearer ${token}`, token), true);
});

test("rejects missing, malformed, short, and incorrect tokens", () => {
  assert.equal(isAuthorizedUploadRequest(null, token), false);
  assert.equal(isAuthorizedUploadRequest(token, token), false);
  assert.equal(isAuthorizedUploadRequest("Bearer wrong", token), false);
  assert.equal(isAuthorizedUploadRequest(`Bearer ${token}`, "short"), false);
});
