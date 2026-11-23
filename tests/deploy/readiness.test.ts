import test from "node:test";
import assert from "node:assert/strict";
import { getDeploymentReadiness } from "../../lib/deploy/readiness";

test("reports a ready deployment provider without exposing credentials", () => {
  const result = getDeploymentReadiness({
    CLOUDFLARE_ACCOUNT_ID: "account-id",
    CLOUDFLARE_API_TOKEN: "secret-value",
    CLOUDFLARE_PAGES_PROJECT_NAME: "deplo-sites",
    DEPLO_UPLOAD_TOKEN: "x".repeat(32),
  });
  assert.deepEqual(result, {
    provider: "cloudflare-pages",
    configured: true,
    uploadAuthenticationConfigured: true,
    legacySharedProjectConfigured: true,
    ready: true,
    missing: [],
    buildRunnerConfigured: false,
  });
  assert.equal(JSON.stringify(result).includes("secret-value"), false);
});

test("reports missing provider settings without returning their values", () => {
  const result = getDeploymentReadiness({
    CLOUDFLARE_ACCOUNT_ID: "account-id",
    CLOUDFLARE_API_TOKEN: "private-token",
    CLOUDFLARE_PAGES_PROJECT_NAME: "../unsafe",
    DEPLO_UPLOAD_TOKEN: "short",
  });
  assert.deepEqual(result, {
    provider: "cloudflare-pages",
    configured: true,
    uploadAuthenticationConfigured: false,
    legacySharedProjectConfigured: false,
    ready: true,
    missing: [],
    buildRunnerConfigured: false,
  });
  assert.equal(JSON.stringify(result).includes("private-token"), false);
});

test("handles an entirely unconfigured server", () => {
  const result = getDeploymentReadiness({});
  assert.equal(result.ready, false);
  assert.equal(result.configured, false);
  assert.equal(result.uploadAuthenticationConfigured, false);
  assert.equal(result.missing.length, 2);
  assert.equal(result.legacySharedProjectConfigured, false);
});

test("reports a build runner only when one is properly configured", () => {
  const base = { CLOUDFLARE_ACCOUNT_ID: "a", CLOUDFLARE_API_TOKEN: "t" };
  assert.equal(getDeploymentReadiness(base).buildRunnerConfigured, false);
  assert.equal(getDeploymentReadiness({ ...base, DEPLO_BUILD_RUNNER_URL: "https://runner.example", DEPLO_BUILD_RUNNER_TOKEN: "x".repeat(32) }).buildRunnerConfigured, true);
  assert.equal(getDeploymentReadiness({ ...base, DEPLO_BUILD_RUNNER_URL: "http://runner.example", DEPLO_BUILD_RUNNER_TOKEN: "x".repeat(32) }).buildRunnerConfigured, false, "plain HTTP is refused");
  assert.equal(getDeploymentReadiness({ ...base, DEPLO_BUILD_RUNNER_URL: "https://runner.example", DEPLO_BUILD_RUNNER_TOKEN: "short" }).buildRunnerConfigured, false);
});
