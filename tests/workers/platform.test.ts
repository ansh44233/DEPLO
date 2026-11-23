import test from "node:test";
import assert from "node:assert/strict";
import { hostUploadLimitBytes, isVercelHost, legacyDiskUploadsAvailable, VERCEL_MAX_UPLOAD_BYTES } from "../../lib/hosting/platform";

test("detects Vercel and applies its request-body limit", () => {
  assert.equal(isVercelHost({ VERCEL: "1" }), true);
  assert.equal(isVercelHost({}), false);
  assert.equal(hostUploadLimitBytes({ VERCEL: "1" }), VERCEL_MAX_UPLOAD_BYTES);
  assert.equal(hostUploadLimitBytes({}), null);
  assert.ok(VERCEL_MAX_UPLOAD_BYTES < 4.5 * 1024 * 1024);
});

test("disables disk-backed legacy uploads only on serverless hosts", () => {
  assert.equal(legacyDiskUploadsAvailable({ VERCEL: "1" }), false);
  assert.equal(legacyDiskUploadsAvailable({}), true);
});
