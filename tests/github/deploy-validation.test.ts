import test from "node:test";
import assert from "node:assert/strict";
import { isValidDeploymentSlug, isValidGitHubBranch } from "../../lib/github/deploy-validation";

test("accepts normal GitHub branch names", () => {
  assert.equal(isValidGitHubBranch("main"), true);
  assert.equal(isValidGitHubBranch("release/v1.2"), true);
  assert.equal(isValidGitHubBranch("feature/new-ui"), true);
});

test("rejects malformed GitHub branch names", () => {
  for (const value of ["", "../main", "main..backup", "/main", "main/", "main//test", "-bad", "bad branch"]) {
    assert.equal(isValidGitHubBranch(value), false, value);
  }
});

test("accepts safe deployment slugs and rejects path or shell syntax", () => {
  assert.equal(isValidDeploymentSlug("my-site-01"), true);
  for (const value of ["", "../site", "Site", "site;bad", "site_name", "a".repeat(59)]) {
    assert.equal(isValidDeploymentSlug(value), false, value);
  }
});
