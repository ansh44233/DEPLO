import test from "node:test";
import assert from "node:assert/strict";
import { matchesWebhookProject } from "../../lib/github/webhook-worker";

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
