import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createSessionToken, unverifiedSessionId, verifySessionClaims, verifySessionToken } from "../../lib/auth/session";
import { revokeGitHubToken } from "../../lib/auth/github-oauth";
import { clearSessionRevocationCache, isSessionRevoked, revokeSession } from "../../lib/db/supabase-session-revocations";

const secret = "s".repeat(48);
const user = { id: 42, login: "octo", name: null, avatarUrl: null };
const env = { SUPABASE_URL: "https://db.example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service" };

test("every sign-in gets its own random ID that can be read back", () => {
  const first = createSessionToken(user, secret, 1_000);
  const second = createSessionToken(user, secret, 1_000);
  const claims = verifySessionClaims(first, secret, 1_001);
  assert.ok(claims?.sid);
  assert.notEqual(claims.sid, verifySessionClaims(second, secret, 1_001)?.sid);
  assert.equal(claims.exp, 1_000 + 7 * 24 * 60 * 60);
  assert.equal(unverifiedSessionId(first), claims.sid);
  assert.deepEqual(verifySessionToken(first, secret, 1_001), user);
  assert.equal(unverifiedSessionId("garbage"), null);
  assert.equal(unverifiedSessionId(undefined), null);
});

test("sessions issued before sign-in IDs still verify, with no ID", () => {
  const encoded = Buffer.from(JSON.stringify({ ...user, exp: 5_000 })).toString("base64url");
  const legacy = encoded + "." + createHmac("sha256", secret).update(encoded).digest("base64url");
  assert.deepEqual(verifySessionClaims(legacy, secret, 1_000), { user, sid: null, exp: 5_000 });
  const badSid = Buffer.from(JSON.stringify({ ...user, exp: 5_000, sid: "../../x" })).toString("base64url");
  assert.equal(verifySessionClaims(badSid + "." + createHmac("sha256", secret).update(badSid).digest("base64url"), secret, 1_000), null);
});

test("a revoked sign-in is refused, and lookups fail open when storage is down", async () => {
  clearSessionRevocationCache();
  const stored = new Set<string>();
  const calls: string[] = [];
  const fetcher = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push((init.method ?? "GET") + " " + url.pathname + url.search);
    if (init.method === "POST") { stored.add((JSON.parse(String(init.body)) as { sid: string }).sid); return new Response(null, { status: 201 }); }
    if (init.method === "DELETE") return new Response(null, { status: 204 });
    const sid = url.searchParams.get("sid")?.replace("eq.", "") ?? "";
    return Response.json(stored.has(sid) ? [{ sid }] : []);
  }) as typeof fetch;

  const sid = verifySessionClaims(createSessionToken(user, secret), secret)!.sid!;
  assert.equal(await isSessionRevoked(sid, env, fetcher), false);
  await revokeSession(sid, 42, Math.floor(Date.now() / 1000) + 3600, env, fetcher);
  assert.equal(await isSessionRevoked(sid, env, fetcher), true);
  assert.ok(calls.some((call) => call.startsWith("DELETE /rest/v1/revoked_sessions?expires_at=lt.")), "expired rows are pruned");

  // Another instance (empty cache) sees the revocation in the database.
  clearSessionRevocationCache();
  assert.equal(await isSessionRevoked(sid, env, fetcher), true);

  clearSessionRevocationCache();
  const down = (async () => { throw new Error("network down"); }) as typeof fetch;
  assert.equal(await isSessionRevoked(sid, env, down), false);
  assert.equal(await isSessionRevoked(sid, {}, fetcher), false, "no storage configured");
  await assert.rejects(revokeSession(sid, 42, 0, env, (async () => new Response("no", { status: 500 })) as typeof fetch));
  await assert.rejects(revokeSession("bad", 42, 0, env, fetcher), /Invalid session/);
});

test("sign-out revokes the GitHub token with the app's credentials", async () => {
  let request: { url: string; method?: string; authorization: string | null; body: unknown } | null = null;
  const fetcher = (async (input: string | URL | Request, init: RequestInit = {}) => {
    request = { url: String(input), method: init.method, authorization: new Headers(init.headers).get("authorization"), body: JSON.parse(String(init.body)) };
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  assert.equal(await revokeGitHubToken({ clientId: "Iv1.abc", clientSecret: "shh", accessToken: "gho_x" }, fetcher), true);
  assert.deepEqual(request, {
    url: "https://api.github.com/applications/Iv1.abc/token",
    method: "DELETE",
    authorization: "Basic " + Buffer.from("Iv1.abc:shh").toString("base64"),
    body: { access_token: "gho_x" },
  });
  assert.equal(await revokeGitHubToken({ clientId: "", clientSecret: "shh", accessToken: "gho_x" }, fetcher), false);
  assert.equal(await revokeGitHubToken({ clientId: "a", clientSecret: "b", accessToken: "c" }, (async () => new Response(null, { status: 422 })) as typeof fetch), false);
});
