import test from "node:test";
import assert from "node:assert/strict";
import { openSecret, sealSecret } from "../../lib/crypto/secret-box";
import { listProjectEnvVars, loadBuildEnv, normaliseEnvVars, parseDotEnv, replaceProjectEnvVars } from "../../lib/db/supabase-env-vars";

const secret = "k".repeat(40);
const env = { SUPABASE_URL: "https://db.example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "sb_secret_x", GITHUB_TOKEN_ENCRYPTION_KEY: secret };
const projectId = "11111111-1111-4111-8111-111111111111";

test("seals secrets per purpose with authenticated encryption", () => {
  const sealed = sealSecret("hunter2", secret, "a");
  assert.notEqual(sealed.includes("hunter2"), true);
  assert.equal(openSecret(sealed, secret, "a"), "hunter2");
  assert.equal(openSecret(sealed, secret, "b"), null, "a value sealed for one project cannot be opened for another");
  assert.equal(openSecret(sealed.slice(0, -2) + "AA", secret, "a"), null);
});

test("parses pasted .env text", () => {
  assert.deepEqual(parseDotEnv([
    "# comment", "", "export VITE_API_URL=https://api.example.com", "QUOTED=\"two words\"", "SINGLE='x # not a comment'",
    "TRAILING=value # comment", "MULTI=\"a\\nb\"", "not a line", "EMPTY=",
  ].join("\n")), [
    { key: "VITE_API_URL", value: "https://api.example.com" },
    { key: "QUOTED", value: "two words" },
    { key: "SINGLE", value: "x # not a comment" },
    { key: "TRAILING", value: "value" },
    { key: "MULTI", value: "a\nb" },
    { key: "EMPTY", value: "" },
  ]);
});

test("validates names, sizes and duplicates", () => {
  assert.deepEqual(normaliseEnvVars([{ key: "B", value: "1" }, { key: "A", value: "2" }, { key: "B", value: "3" }, { key: " ", value: "x" }]), [
    { key: "A", value: "2" }, { key: "B", value: "3" },
  ]);
  assert.throws(() => normaliseEnvVars([{ key: "1BAD", value: "" }]), /not a valid name/);
  assert.throws(() => normaliseEnvVars([{ key: "BIG", value: "x".repeat(9000) }]), /8 KB/);
  assert.throws(() => normaliseEnvVars(Array.from({ length: 101 }, (_, i) => ({ key: "K" + i, value: "" }))), /up to 100/);
  assert.throws(() => normaliseEnvVars("nope"), /list/);
});

test("stores only ciphertext, scoped to the owner and project, and reads it back", async () => {
  const calls: { url: string; method: string; body?: string }[] = [];
  let stored: { key: string; value_encrypted: string }[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); const method = init?.method ?? "GET";
    calls.push({ url, method, body: typeof init?.body === "string" ? init.body : undefined });
    if (method === "POST") { stored = JSON.parse(String(init?.body)); return new Response(null, { status: 201 }); }
    if (method === "GET") return Response.json(stored);
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  await replaceProjectEnvVars(42, projectId, [{ key: "API_KEY", value: "sk_live_123" }, { key: "MODE", value: "prod" }], env, fetcher);
  const del = calls.find((call) => call.method === "DELETE")!;
  assert.match(decodeURIComponent(del.url), /project_id=eq\.1111.*owner_github_id=eq\.42&key=not\.in\.\("API_KEY","MODE"\)/);
  const post = calls.find((call) => call.method === "POST")!;
  assert.equal(post.body?.includes("sk_live_123"), false, "plaintext never leaves the server");
  assert.match(post.url, /on_conflict=project_id,key/);

  const read = await listProjectEnvVars(42, projectId, env, fetcher);
  assert.deepEqual(read, [{ key: "API_KEY", value: "sk_live_123" }, { key: "MODE", value: "prod" }]);
  assert.match(decodeURIComponent(calls.at(-1)!.url), /owner_github_id=eq\.42/);
});

test("builds still run before migration 0013 is applied", async () => {
  const fetcher = (async () => new Response('{"message":"relation \\"public.project_env_vars\\" does not exist"}', { status: 404 })) as unknown as typeof fetch;
  assert.deepEqual(await loadBuildEnv(42, projectId, env, fetcher), {});
  await assert.rejects(listProjectEnvVars(42, projectId, env, fetcher), /migration 0013/);
});
