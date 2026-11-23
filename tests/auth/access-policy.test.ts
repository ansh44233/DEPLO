import test from "node:test";
import assert from "node:assert/strict";
import { isAllowedGitHubUser } from "../../lib/auth/access-policy";
import { createSessionToken, verifySessionToken } from "../../lib/auth/session";

test("with no allowlist anyone may sign in", () => {
  assert.equal(isAllowedGitHubUser({ id: 1, login: "anyone" }, {}), true);
});

test("an allowlist matches logins (any case) and numeric IDs", () => {
  const env = { DEPLO_ALLOWED_GITHUB_USERS: " Octo-Cat , 583231 " };
  assert.equal(isAllowedGitHubUser({ id: 9, login: "octo-cat" }, env), true);
  assert.equal(isAllowedGitHubUser({ id: 583231, login: "renamed" }, env), true);
  assert.equal(isAllowedGitHubUser({ id: 10, login: "stranger" }, env), false);
  assert.equal(isAllowedGitHubUser({ id: 10, login: "stranger" }, { DEPLO_ALLOWED_GITHUB_USERS: "!!!" }), false, "a list with no valid entries allows nobody");
});

test("removing someone from the allowlist ends their existing sessions", () => {
  const secret = "k".repeat(40);
  const token = createSessionToken({ id: 7, login: "former", name: null, avatarUrl: null }, secret);
  const original = process.env.DEPLO_ALLOWED_GITHUB_USERS;
  try {
    process.env.DEPLO_ALLOWED_GITHUB_USERS = "former";
    assert.ok(verifySessionToken(token, secret));
    process.env.DEPLO_ALLOWED_GITHUB_USERS = "someone-else";
    assert.equal(verifySessionToken(token, secret), null);
  } finally {
    if (original === undefined) delete process.env.DEPLO_ALLOWED_GITHUB_USERS; else process.env.DEPLO_ALLOWED_GITHUB_USERS = original;
  }
});
