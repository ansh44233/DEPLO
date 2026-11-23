import test from "node:test";
import assert from "node:assert/strict";
import { exchangeGitHubCode, refreshGitHubCredentials } from "../../lib/auth/github-oauth";
import { githubSignInMode, githubSignInScope } from "../../lib/auth/github-sign-in";
import { decryptGitHubCredentials, decryptGitHubToken, encryptGitHubCredentials, encryptGitHubToken } from "../../lib/auth/github-token";
import { refreshGitHubCookieIfNeeded } from "../../lib/auth/github-refresh";

const secret = "github-token-encryption-key-for-tests-0123456789";
const now = 1_800_000_000;

test("a GitHub App client ID switches sign-in to the App, which asks for no scopes", () => {
  assert.equal(githubSignInMode({ GITHUB_CLIENT_ID: "Iv23liAbCdEf" }), "app");
  assert.equal(githubSignInMode({ GITHUB_CLIENT_ID: "Iv1.0123456789abcdef" }), "app");
  assert.equal(githubSignInMode({ GITHUB_CLIENT_ID: "Ov23liAbCdEf" }), "oauth");
  assert.equal(githubSignInMode({ GITHUB_CLIENT_ID: "0123456789abcdef0123" }), "oauth");
  assert.equal(githubSignInMode({ GITHUB_CLIENT_ID: "Ov23x", DEPLO_GITHUB_SIGN_IN: "app" }), "app");
  assert.equal(githubSignInMode({ GITHUB_CLIENT_ID: "Iv23x", DEPLO_GITHUB_SIGN_IN: "OAuth" }), "oauth");
  assert.equal(githubSignInScope("app"), null);
  assert.equal(githubSignInScope("oauth"), "read:user repo");
});

test("the token exchange keeps the refresh token and expiry times", async () => {
  const fetcher = (async () => Response.json({ access_token: "ghu_a", expires_in: 28800, refresh_token: "ghr_r", refresh_token_expires_in: 15811200 })) as unknown as typeof fetch;
  assert.deepEqual(await exchangeGitHubCode({ clientId: "Iv23x", clientSecret: "s", code: "c", redirectUri: "https://d/cb" }, fetcher, now), {
    accessToken: "ghu_a", refreshToken: "ghr_r", expiresAt: now + 28800, refreshExpiresAt: now + 15811200,
  });
});

test("a refresh sends grant_type=refresh_token with the app credentials", async () => {
  let body: URLSearchParams | null = null;
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    body = new URLSearchParams(String(init?.body));
    return Response.json({ access_token: "ghu_new", expires_in: 28800, refresh_token: "ghr_new", refresh_token_expires_in: 100 });
  }) as typeof fetch;
  const result = await refreshGitHubCredentials({ clientId: "Iv23x", clientSecret: "s", refreshToken: "ghr_old" }, fetcher, now);
  assert.deepEqual(result, { accessToken: "ghu_new", refreshToken: "ghr_new", expiresAt: now + 28800, refreshExpiresAt: now + 100 });
  assert.equal(body!.get("grant_type"), "refresh_token");
  assert.equal(body!.get("refresh_token"), "ghr_old");
  assert.equal(body!.get("client_secret"), "s");
  assert.deepEqual(await refreshGitHubCredentials({ clientId: "", clientSecret: "s", refreshToken: "r" }, fetcher, now), { error: "refresh_not_configured" });
});

test("both cookie formats decrypt, and v2 round-trips every field", () => {
  const credentials = { accessToken: "ghu_a", refreshToken: "ghr_r", expiresAt: now + 10, refreshExpiresAt: now + 100 };
  const sealed = encryptGitHubCredentials(credentials, secret);
  assert.ok(sealed.startsWith("v2."));
  assert.equal(sealed.includes("ghu_a"), false);
  assert.deepEqual(decryptGitHubCredentials(sealed, secret), credentials);
  assert.equal(decryptGitHubToken(sealed, secret), "ghu_a");
  const legacy = encryptGitHubToken("gho_legacy", secret);
  assert.deepEqual(decryptGitHubCredentials(legacy, secret), { accessToken: "gho_legacy", refreshToken: null, expiresAt: null, refreshExpiresAt: null });
  assert.equal(decryptGitHubCredentials(sealed, secret.replace("0", "1")), null);
  assert.throws(() => encryptGitHubCredentials({ ...credentials, expiresAt: -1 }, secret));
});

test("middleware refresh: only near expiry, once per refresh token, and never after the refresh token expires", async () => {
  const env = { GITHUB_TOKEN_ENCRYPTION_KEY: secret, GITHUB_CLIENT_ID: "Iv23x", GITHUB_CLIENT_SECRET: "s" };
  let calls = 0;
  const fetcher = (async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return Response.json({ access_token: "ghu_new", expires_in: 28800, refresh_token: "ghr_next", refresh_token_expires_in: 1000 });
  }) as unknown as typeof fetch;

  const fresh = encryptGitHubCredentials({ accessToken: "ghu_a", refreshToken: "ghr_1", expiresAt: now + 3600, refreshExpiresAt: now + 9999 }, secret);
  assert.equal(await refreshGitHubCookieIfNeeded(fresh, env, fetcher, now), null);
  assert.equal(calls, 0);

  const expiring = encryptGitHubCredentials({ accessToken: "ghu_a", refreshToken: "ghr_2", expiresAt: now + 60, refreshExpiresAt: now + 9999 }, secret);
  const [first, second] = await Promise.all([
    refreshGitHubCookieIfNeeded(expiring, env, fetcher, now),
    refreshGitHubCookieIfNeeded(expiring, env, fetcher, now),
  ]);
  assert.equal(calls, 1, "concurrent requests share one refresh");
  assert.equal(decryptGitHubToken(first!, secret), "ghu_new");
  assert.equal(decryptGitHubToken(second!, secret), "ghu_new");
  assert.equal(decryptGitHubCredentials(first!, secret)?.refreshToken, "ghr_next");

  const dead = encryptGitHubCredentials({ accessToken: "ghu_a", refreshToken: "ghr_3", expiresAt: now - 10, refreshExpiresAt: now - 1 }, secret);
  assert.equal(await refreshGitHubCookieIfNeeded(dead, env, fetcher, now), null);
  assert.equal(await refreshGitHubCookieIfNeeded(encryptGitHubToken("gho_classic", secret), env, fetcher, now), null, "classic OAuth tokens do not expire");
  const failing = (async () => Response.json({ error: "bad_refresh_token" })) as unknown as typeof fetch;
  const another = encryptGitHubCredentials({ accessToken: "ghu_a", refreshToken: "ghr_4", expiresAt: now, refreshExpiresAt: null }, secret);
  assert.equal(await refreshGitHubCookieIfNeeded(another, env, failing, now), null);
  assert.equal(calls, 1);
});
