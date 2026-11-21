import test from "node:test";
import assert from "node:assert/strict";
import { createSessionToken, safeEqual, verifySessionToken } from "../../lib/auth/session";

const secret = "test-session-secret-that-is-at-least-32-characters";
const user = {
  id: 12345,
  login: "deplo-user",
  name: "DEPLO User",
  avatarUrl: "https://avatars.githubusercontent.com/u/12345",
};

test("creates and verifies a signed session without storing OAuth credentials", () => {
  const token = createSessionToken(user, secret, 1_000);
  assert.deepEqual(verifySessionToken(token, secret, 1_001), user);
  assert.equal(token.includes("access_token"), false);
});

test("rejects modified payloads and signatures", () => {
  const token = createSessionToken(user, secret, 1_000);
  const [payload, signature] = token.split(".");
  assert.equal(verifySessionToken(payload + "." + signature.slice(0, -2) + "aa", secret, 1_001), null);
  assert.equal(verifySessionToken(Buffer.from(JSON.stringify({ ...user, id: 999 })).toString("base64url") + "." + signature, secret, 1_001), null);
});

test("rejects expired, malformed, and weak-secret sessions", () => {
  const token = createSessionToken(user, secret, 1_000);
  assert.equal(verifySessionToken(token, secret, 1_000 + 60 * 60 * 24 * 7), null);
  assert.equal(verifySessionToken("not-a-token", secret), null);
  assert.equal(verifySessionToken(token, "short"), null);
  assert.throws(() => createSessionToken(user, "short", 1_000), /at least 32 characters/);
});

test("compares OAuth state values without accepting mismatches", () => {
  assert.equal(safeEqual("same-state", "same-state"), true);
  assert.equal(safeEqual("same-state", "other-state"), false);
  assert.equal(safeEqual("short", "longer"), false);
});
