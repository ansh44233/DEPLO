import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { chooseSandboxSource } from "../../lib/github/sandbox-source";

const appKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const userToken = "gho_" + "u".repeat(36);
const appToken = "ghs_" + "a".repeat(36);

function fake(options: { repo?: Record<string, unknown> | number; installation?: number | null; tokenStatus?: number }) {
  const calls: { url: string; method: string; authorization: string | null; body: unknown }[] = [];
  const fetcher = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url: url.toString(), method: init.method ?? "GET", authorization: new Headers(init.headers).get("authorization"), body: init.body ? JSON.parse(String(init.body)) : null });
    if (url.hostname === "api.github.com" && url.pathname === "/repos/acme/site") {
      if (typeof options.repo === "number") return new Response("{}", { status: options.repo });
      return Response.json(options.repo ?? { private: false, visibility: "public" });
    }
    if (url.pathname === "/rest/v1/github_app_installations") return Response.json(options.installation ? [{ installation_id: options.installation }] : []);
    if (url.pathname === "/app/installations/77/access_tokens") return Response.json({ token: appToken }, { status: options.tokenStatus ?? 201 });
    throw new Error("unexpected " + url);
  }) as typeof fetch;
  return { fetcher, calls };
}

const env = { SUPABASE_URL: "https://db.example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service", GITHUB_APP_ID: "123", GITHUB_APP_PRIVATE_KEY: appKey };
const base = { owner: "acme", repository: "site", ownerGithubId: 42, userToken, env };

test("public repositories are cloned without any token", async () => {
  const { fetcher, calls } = fake({});
  const source = await chooseSandboxSource({ ...base, fetcher });
  assert.deepEqual(source, { kind: "clone", repositoryUrl: "https://github.com/acme/site.git", accessToken: null, reason: "public" });
  assert.equal(calls.length, 1, "no installation token is minted for public repositories");
});

test("private repositories use a read-only token scoped to that one repository", async () => {
  const { fetcher, calls } = fake({ repo: { private: true, visibility: "private" }, installation: 77 });
  const source = await chooseSandboxSource({ ...base, fetcher });
  assert.deepEqual(source, { kind: "clone", repositoryUrl: "https://github.com/acme/site.git", accessToken: appToken, reason: "app-token" });
  const mint = calls.find((call) => call.url.endsWith("/access_tokens"));
  assert.deepEqual(mint?.body, { repositories: ["site"], permissions: { contents: "read", metadata: "read" } });
  assert.equal(JSON.stringify(source).includes(userToken), false);
});

test("private repositories without the GitHub App are copied in, never cloned with the user's token", async () => {
  for (const options of [
    { repo: { private: true }, installation: null },
    { repo: { private: true }, installation: 77, tokenStatus: 422 },
    { repo: { private: false, visibility: "internal" }, installation: null },
  ]) {
    const { fetcher } = fake(options);
    const source = await chooseSandboxSource({ ...base, fetcher });
    assert.deepEqual(source, { kind: "copy", reason: "private-without-app" });
  }
  const { fetcher } = fake({ repo: { private: true } });
  assert.deepEqual(await chooseSandboxSource({ ...base, env: { ...env, GITHUB_APP_ID: "" }, fetcher }), { kind: "copy", reason: "private-without-app" });
});

test("an unreadable repository is copied in", async () => {
  const { fetcher } = fake({ repo: 404 });
  assert.deepEqual(await chooseSandboxSource({ ...base, env: {}, fetcher }), { kind: "copy", reason: "visibility-unknown" });
});
