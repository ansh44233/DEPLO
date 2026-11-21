import test from "node:test";
import assert from "node:assert/strict";
import { getWebhookRetryDelaySeconds, matchesWebhookProject } from "../../lib/github/webhook-worker";

const project = {
  id: "project-1",
  owner_github_id: 123,
  slug: "my-site",
  repository_url: "https://github.com/Example/Website",
  branch: "main",
  source_type: "github",
};

test("matches repository and branch without case sensitivity", () => {
  assert.equal(matchesWebhookProject(project, "example/website", "main"), true);
});

test("rejects a different branch or repository", () => {
  assert.equal(matchesWebhookProject(project, "example/website", "develop"), false);
  assert.equal(matchesWebhookProject(project, "example/other", "main"), false);
});

test("rejects non-GitHub and non-GitHub-source projects", () => {
  assert.equal(matchesWebhookProject({ ...project, repository_url: "https://example.com/repo" }, "example/website", "main"), false);
  assert.equal(matchesWebhookProject({ ...project, source_type: "zip" }, "example/website", "main"), false);
});

test("uses capped exponential retry delays", () => {
  assert.equal(getWebhookRetryDelaySeconds(0), 30);
  assert.equal(getWebhookRetryDelaySeconds(1), 30);
  assert.equal(getWebhookRetryDelaySeconds(2), 60);
  assert.equal(getWebhookRetryDelaySeconds(3), 120);
  assert.equal(getWebhookRetryDelaySeconds(5), 480);
  assert.equal(getWebhookRetryDelaySeconds(8), 3600);
  assert.equal(getWebhookRetryDelaySeconds(99), 3600);
});

import { getGitHubArchiveHeaders } from "../../lib/github/webhook-archive";

test("private archive requests use a short-lived installation token", () => {
  const headers = getGitHubArchiveHeaders("installation-token");
  assert.equal(headers.Authorization, "Bearer installation-token");
  assert.equal(headers.Accept, "application/vnd.github+json");
});

test("public archive fallback does not send an authorization header", () => {
  const headers = getGitHubArchiveHeaders();
  assert.equal("Authorization" in headers, false);
});
