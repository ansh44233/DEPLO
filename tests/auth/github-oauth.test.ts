import test from "node:test";
import assert from "node:assert/strict";
import { exchangeGitHubCode } from "../../lib/auth/github-oauth";

const input = { clientId: "Ov23abc", clientSecret: "shh", code: "the-code", redirectUri: "https://deplo.example.com/api/auth/github/callback" };

test("sends a form-encoded body with a matching Content-Type", async () => {
  let seen: RequestInit | undefined;
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    seen = init;
    return Response.json({ access_token: "gho_token", token_type: "bearer" });
  }) as typeof fetch;
  assert.deepEqual(await exchangeGitHubCode(input, fetcher), { accessToken: "gho_token" });
  const headers = new Headers(seen?.headers);
  assert.equal(headers.get("content-type"), "application/x-www-form-urlencoded");
  assert.equal(headers.get("accept"), "application/json");
  const body = new URLSearchParams(String(seen?.body));
  assert.equal(body.get("client_id"), "Ov23abc");
  assert.equal(body.get("code"), "the-code");
  assert.equal(body.get("redirect_uri"), input.redirectUri);
});

test("reports GitHub OAuth errors and missing tokens without leaking secrets", async () => {
  const errorFetcher = (async () => Response.json({ error: "bad_verification_code" })) as unknown as typeof fetch;
  assert.deepEqual(await exchangeGitHubCode(input, errorFetcher), { error: "bad_verification_code" });
  const emptyFetcher = (async () => Response.json({})) as unknown as typeof fetch;
  assert.deepEqual(await exchangeGitHubCode(input, emptyFetcher), { error: "token_missing" });
  const httpFetcher = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
  assert.deepEqual(await exchangeGitHubCode(input, httpFetcher), { error: "token_http_500" });
  const downFetcher = (async () => { throw new Error("shh"); }) as unknown as typeof fetch;
  assert.deepEqual(await exchangeGitHubCode(input, downFetcher), { error: "github_unreachable" });
});
