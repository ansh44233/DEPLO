import test from "node:test";
import assert from "node:assert/strict";
import { decryptGitHubToken, encryptGitHubToken } from "../../lib/auth/github-token";

const secret = "test-github-token-encryption-key-at-least-32-characters";
const token = "gho_example_private_repository_access_token";

test("encrypts and decrypts a GitHub OAuth token", () => {
  const encrypted = encryptGitHubToken(token, secret);
  assert.notEqual(encrypted, token);
  assert.equal(encrypted.includes(token), false);
  assert.equal(decryptGitHubToken(encrypted, secret), token);
});

test("uses a fresh nonce for every encryption", () => {
  const first = encryptGitHubToken(token, secret);
  const second = encryptGitHubToken(token, secret);
  assert.notEqual(first, second);
  assert.equal(decryptGitHubToken(first, secret), token);
  assert.equal(decryptGitHubToken(second, secret), token);
});

test("rejects tampered ciphertext and the wrong key", () => {
  const encrypted = encryptGitHubToken(token, secret);
  const parts = encrypted.split(".");
  parts[3] = parts[3].slice(0, -1) + (parts[3].endsWith("a") ? "b" : "a");
  assert.equal(decryptGitHubToken(parts.join("."), secret), null);
  assert.equal(decryptGitHubToken(encrypted, "a-different-secret-key-with-enough-length"), null);
});

test("rejects malformed values and weak encryption keys", () => {
  assert.equal(decryptGitHubToken(undefined, secret), null);
  assert.equal(decryptGitHubToken("not-a-token", secret), null);
  assert.equal(decryptGitHubToken(encryptGitHubToken(token, secret), "short"), null);
  assert.throws(() => encryptGitHubToken(token, "short"), /at least 32 characters/);
  assert.throws(() => encryptGitHubToken("", secret), /Invalid GitHub OAuth token/);
});
