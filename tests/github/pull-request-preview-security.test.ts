import test from "node:test";
import assert from "node:assert/strict";
import { normalizePullRequestEvent } from "../../lib/github/pull-request-preview";

// Attack-oriented cases for the pull request parser. The webhook is HMAC-signed by GitHub,
// but the parser is the second line of defence: it must never approve a build it cannot prove safe.

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

test("never builds a head repository that is not provably the base repository", () => {
  const forks: unknown[] = [
    { full_name: "Example/Website-evil" },
    { full_name: "Example/Website/extra" },
    { full_name: "ExampleK/Website" }, // Kelvin sign lower-cases to an ASCII "k"
    { full_name: "Ｅxample/Website" }, // full-width letter
    { full_name: "../Website" },
    { full_name: ["Example/Website"] },
    { full_name: 42 },
    {},
  ];
  for (const repo of forks) {
    const result = normalizePullRequestEvent(event({}, { head: { sha: headSha, repo } }));
    assert.deepEqual(result, { kind: "ignore", reason: "fork-pull-request" }, JSON.stringify(repo));
  }
});

test("compares immutable repository IDs when GitHub supplies them", () => {
  const withIds = (baseId: unknown, headId: unknown) =>
    event(
      { repository: { full_name: "Example/Website", id: baseId } },
      { head: { sha: headSha, repo: { full_name: "Example/Website", id: headId } } },
    );
  assert.equal(normalizePullRequestEvent(withIds(10, 10)).kind, "deploy");
  assert.deepEqual(normalizePullRequestEvent(withIds(10, 11)), { kind: "ignore", reason: "fork-pull-request" });
  assert.deepEqual(normalizePullRequestEvent(withIds(10, undefined)), { kind: "ignore", reason: "fork-pull-request" });
  assert.deepEqual(normalizePullRequestEvent(withIds(10, "10")), { kind: "ignore", reason: "fork-pull-request" });
});

test("rejects control characters and ref-syntax tricks in branch names", () => {
  const rejected = [
    "main\n", "ma\u0000in", "a..b", "a~b", "a^b", "a:b", "a?b", "a*b", "a[b", "a\\b", "a b",
    "/main", "main/", "main.lock", "x".repeat(201), "",
  ];
  for (const ref of rejected) {
    assert.deepEqual(normalizePullRequestEvent(event({}, { base: { ref } })), { kind: "invalid" }, JSON.stringify(ref));
  }
});

test("survives hostile JSON shapes without throwing or polluting prototypes", () => {
  const hostile: unknown[] = [
    JSON.parse('{"__proto__":{"polluted":true},"action":"opened"}'),
    JSON.parse('{"action":"opened","number":42,"repository":{"__proto__":{"full_name":"Example/Website"}},"pull_request":{"number":42}}'),
    { action: "opened", number: 42, repository: [], pull_request: [] },
    { action: "opened", number: 42, repository: "Example/Website", pull_request: "x" },
    [], 0, true, undefined,
  ];
  for (const payload of hostile) assert.deepEqual(normalizePullRequestEvent(payload), { kind: "invalid" });
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});
