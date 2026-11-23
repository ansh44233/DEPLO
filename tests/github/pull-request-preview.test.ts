import test from "node:test";
import assert from "node:assert/strict";
import { normalizePullRequestEvent, previewBranchFor, previewUrlFor } from "../../lib/github/pull-request-preview";

const headSha = "b".repeat(40);

function event(overrides: Record<string, unknown> = {}, pullRequest: Record<string, unknown> = {}) {
  return {
    action: "opened",
    number: 42,
    repository: { full_name: "Example/Website" },
    sender: { id: 1234 },
    pull_request: {
      number: 42,
      base: { ref: "main" },
      head: { sha: headSha, repo: { full_name: "Example/Website" } },
      ...pullRequest,
    },
    ...overrides,
  };
}

test("previews same-repository pull requests on opened, synchronize and reopened", () => {
  for (const action of ["opened", "synchronize", "reopened"]) {
    assert.deepEqual(normalizePullRequestEvent(event({ action })), {
      kind: "deploy",
      repositoryFullName: "example/website",
      baseBranch: "main",
      headSha,
      number: 42,
      senderGithubId: 1234,
    });
  }
});

test("matches projects on the base branch, including slashes in its name", () => {
  const result = normalizePullRequestEvent(event({}, { base: { ref: "release/v2" } }));
  assert.equal(result.kind, "deploy");
  assert.equal(result.kind === "deploy" && result.baseBranch, "release/v2");
});

test("ignores actions that do not change the pull request's code", () => {
  for (const action of ["closed", "edited", "labeled", "review_requested"]) {
    assert.deepEqual(normalizePullRequestEvent(event({ action })), { kind: "ignore", reason: "action-not-previewed" });
  }
});

test("ignores pull requests from forks and from deleted forks", () => {
  const fork = event({}, { head: { sha: headSha, repo: { full_name: "attacker/Website" } } });
  assert.deepEqual(normalizePullRequestEvent(fork), { kind: "ignore", reason: "fork-pull-request" });
  const deletedFork = event({}, { head: { sha: headSha, repo: null } });
  assert.deepEqual(normalizePullRequestEvent(deletedFork), { kind: "ignore", reason: "fork-pull-request" });
});

test("treats the head repository name case-insensitively", () => {
  const result = normalizePullRequestEvent(event({}, { head: { sha: headSha, repo: { full_name: "example/website" } } }));
  assert.equal(result.kind, "deploy");
});

test("rejects malformed pull request payloads", () => {
  const invalid: unknown[] = [
    null,
    "opened",
    event({ action: 5 }),
    event({ repository: { full_name: "not a repo" } }),
    event({ number: 0 }),
    event({ number: 1.5 }),
    event({ number: "42" }),
    event({}, { base: { ref: "" } }),
    event({}, { base: { ref: "main branch" } }),
    event({}, { base: { ref: "../etc" } }),
    event({}, { base: { ref: "feature.lock" } }),
    event({}, { head: { sha: "short", repo: { full_name: "Example/Website" } } }),
    event({}, { head: null }),
  ];
  for (const payload of invalid) {
    assert.deepEqual(normalizePullRequestEvent(payload), { kind: "invalid" });
  }
});

test("drops a sender ID that is not a safe integer", () => {
  const result = normalizePullRequestEvent(event({ sender: { id: "1234" } }));
  assert.equal(result.kind === "deploy" && result.senderGithubId, null);
});

test("builds preview branch names that Cloudflare Pages accepts and never collide with production", () => {
  assert.equal(previewBranchFor(7), "pr-7");
  assert.match(previewBranchFor(999_999_999), /^[a-z0-9][a-z0-9-]{0,62}$/);
  assert.doesNotMatch(previewBranchFor(7), /^site-/);
  for (const bad of [0, -1, 1.5, Number.NaN, 1_000_000_000]) {
    assert.throws(() => previewBranchFor(bad));
  }
});

test("derives the preview alias URL from the project's production URL", () => {
  assert.equal(previewUrlFor("https://deplo-abc-site.pages.dev", 42), "https://pr-42.deplo-abc-site.pages.dev");
  assert.throws(() => previewUrlFor("https://example.com", 42));
  assert.throws(() => previewUrlFor("https://deplo-abc-site.pages.dev/path", 42));
  assert.throws(() => previewUrlFor("http://deplo-abc-site.pages.dev", 42));
});
