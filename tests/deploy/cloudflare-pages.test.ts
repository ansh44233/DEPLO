import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cloudflarePagesDeploymentFailure,
  contentTypeFor,
  deployStaticDirectory,
  forEachConcurrently,
  isValidPagesBranch,
  isValidPagesProjectName,
  pagesAssetHash,
  readCloudflarePagesConfig,
  readCloudflarePagesCredentials,
} from "../../lib/deploy/cloudflare-pages";
import { blake3Hex } from "../../lib/deploy/blake3";

const config = {
  accountId: "account-123",
  apiToken: "secret-token",
  projectName: "deplo-sites",
};

type Call = { url: string; method: string; authorization: string; body: unknown };

async function makeSite(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "deplo-pages-test-"));
  await writeFile(join(root, "index.html"), "<!doctype html><html><body>hi</body></html>");
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "assets", "app.js"), "console.log('hi')");
  await writeFile(join(root, "assets", "copy.js"), "console.log('hi')");
  await writeFile(join(root, "_headers"), "/*\n  X-Frame-Options: DENY\n");
  await writeFile(join(root, "_redirects"), "/old /new 301\n");
  await writeFile(join(root, ".DS_Store"), "junk");
  return root;
}

function fakeCloudflare(overrides: Partial<Record<string, (call: Call) => Response>> = {}) {
  const calls: Call[] = [];
  const ok = (result: unknown) => new Response(JSON.stringify({ success: true, result }), { status: 200 });
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    let body: unknown = init?.body;
    if (typeof body === "string") body = JSON.parse(body);
    const call = { url, method: init?.method ?? "GET", authorization: headers.get("authorization") ?? "", body };
    calls.push(call);
    const path = new URL(url).pathname.replace("/client/v4", "");
    const override = overrides[path];
    if (override) return override(call);
    if (path.endsWith("/upload-token")) return ok({ jwt: "upload-jwt" });
    if (path === "/pages/assets/check-missing") return ok((call.body as { hashes: string[] }).hashes);
    if (path === "/pages/assets/upload" || path === "/pages/assets/upsert-hashes") return ok(null);
    if (path.endsWith("/deployments")) return ok({ id: "dep-1", url: "https://abc123.deplo-sites.pages.dev" });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { calls, fetcher };
}

test("reads Cloudflare Pages configuration from server environment values", () => {
  assert.deepEqual(
    readCloudflarePagesConfig({
      CLOUDFLARE_ACCOUNT_ID: " account-123 ",
      CLOUDFLARE_API_TOKEN: " secret-token ",
      CLOUDFLARE_PAGES_PROJECT_NAME: "deplo-sites",
    }),
    { accountId: "account-123", apiToken: "secret-token", projectName: "deplo-sites" },
  );
});

test("requires all Cloudflare credentials and a valid project name", () => {
  assert.equal(readCloudflarePagesConfig({}), null);
  assert.equal(
    readCloudflarePagesConfig({
      CLOUDFLARE_ACCOUNT_ID: "account",
      CLOUDFLARE_API_TOKEN: "token",
      CLOUDFLARE_PAGES_PROJECT_NAME: "../unsafe",
    }),
    null,
  );
});

test("validates project and branch names without accepting shell syntax", () => {
  assert.equal(isValidPagesProjectName("deplo-sites"), true);
  assert.equal(isValidPagesProjectName("../deplo"), false);
  assert.equal(isValidPagesBranch("site-my-project"), true);
  assert.equal(isValidPagesBranch("site;rm"), false);
});


test("reads account-level Cloudflare credentials without requiring a legacy shared project", () => {
  assert.deepEqual(readCloudflarePagesCredentials({
    CLOUDFLARE_ACCOUNT_ID: " account-123 ",
    CLOUDFLARE_API_TOKEN: " secret-token ",
  }), {
    accountId: "account-123",
    apiToken: "secret-token",
  });
  assert.equal(readCloudflarePagesCredentials({ CLOUDFLARE_ACCOUNT_ID: "account" }), null);
});

test("returns a stable public deployment error without including private CLI output", () => {
  const privateOutput = "Bearer secret-token /srv/deplo/private/work account=private-account";
  const error = cloudflarePagesDeploymentFailure();
  assert.equal(error.message, "Cloudflare Pages deployment failed. Check the server logs for details.");
  assert.equal(error.message.includes(privateOutput), false);
  assert.equal(error.message.includes("secret-token"), false);
  assert.equal(error.message.includes("/srv/deplo/private/work"), false);
});

test("hashes assets the same way as Cloudflare Pages tooling", () => {
  const content = new TextEncoder().encode("console.log('hi')");
  const expected = blake3Hex(Buffer.from(content).toString("base64") + "js").slice(0, 32);
  assert.equal(pagesAssetHash(content, "assets/app.js"), expected);
  assert.equal(pagesAssetHash(content, "app.js").length, 32);
  assert.notEqual(pagesAssetHash(content, "app.js"), pagesAssetHash(content, "app.css"));
  assert.equal(contentTypeFor("index.HTML"), "text/html");
  assert.equal(contentTypeFor("blob.unknown"), "application/octet-stream");
});

test("matches published BLAKE3 test vectors", () => {
  const sequence = (length: number) => Uint8Array.from({ length }, (_, index) => index % 251);
  assert.equal(blake3Hex(new Uint8Array()), "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262");
  assert.equal(blake3Hex(sequence(1)), "2d3adedff11b61f14c886e35afa036736dcd87a74d27b5c1510225d0f592e213");
  assert.equal(blake3Hex(sequence(1024)), "42214739f095a406f3fc83deb889744ac00df831c10daa55189b5d121c855af7");
  assert.equal(blake3Hex(sequence(1025)), "d00278ae47eb27b34faecf67b4fe263f82d5412916c1ffd97c8cb7fb814b8444");
  assert.equal(blake3Hex(sequence(8193)), "bab6c09cb8ce8cf459261398d2e7aef35700bf488116ceb94a36d0f5f1b7bc3b");
  assert.equal(blake3Hex(sequence(102400)), "bc3e3d41a1146b069abffad3c0d44860cf664390afce4d9661f7902e7943e085");
});

test("publishes a directory through the Direct Upload API without a CLI process", async () => {
  const root = await makeSite();
  try {
    const { calls, fetcher } = fakeCloudflare();
    const result = await deployStaticDirectory(root, "site-demo", config, { fetcher });
    assert.equal(result.url, "https://abc123.deplo-sites.pages.dev");

    const paths = calls.map((call) => new URL(call.url).pathname.replace("/client/v4", ""));
    assert.deepEqual(paths, [
      "/accounts/account-123/pages/projects/deplo-sites/upload-token",
      "/pages/assets/check-missing",
      "/pages/assets/upload",
      "/pages/assets/upsert-hashes",
      "/accounts/account-123/pages/projects/deplo-sites/deployments",
    ]);
    // Account API token is used only for account endpoints; asset endpoints use the upload JWT.
    assert.equal(calls[0].authorization, "Bearer secret-token");
    for (const call of calls.slice(1, 4)) assert.equal(call.authorization, "Bearer upload-jwt");
    assert.equal(calls[4].authorization, "Bearer secret-token");

    // Identical files share one hash and are uploaded once; config files and junk are excluded.
    const uploaded = calls[2].body as { key: string; value: string; metadata: { contentType: string }; base64: boolean }[];
    assert.equal(uploaded.length, 2);
    assert.equal(uploaded.every((file) => file.base64 === true), true);
    assert.deepEqual(uploaded.map((file) => file.metadata.contentType).sort(), ["application/javascript", "text/html"]);

    const form = calls[4].body as FormData;
    assert.equal(form.get("branch"), "site-demo");
    const manifest = JSON.parse(String(form.get("manifest"))) as Record<string, string>;
    assert.deepEqual(Object.keys(manifest).sort(), ["/assets/app.js", "/assets/copy.js", "/index.html"]);
    assert.equal(manifest["/assets/app.js"], manifest["/assets/copy.js"]);
    assert.ok(form.get("_headers") instanceof Blob);
    assert.ok(form.get("_redirects") instanceof Blob);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("skips uploading assets Cloudflare already has", async () => {
  const root = await makeSite();
  try {
    const { calls, fetcher } = fakeCloudflare({
      "/pages/assets/check-missing": () => new Response(JSON.stringify({ success: true, result: [] })),
    });
    await deployStaticDirectory(root, "site-demo", config, { fetcher });
    assert.equal(calls.some((call) => call.url.endsWith("/pages/assets/upload")), false);
    assert.equal(calls.some((call) => call.url.endsWith("/pages/assets/upsert-hashes")), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("redacts provider failures behind a stable error", async () => {
  const root = await makeSite();
  const originalError = console.error;
  const logged: string[] = [];
  console.error = (...args: unknown[]) => { logged.push(args.join(" ")); };
  try {
    const { fetcher } = fakeCloudflare({
      "/accounts/account-123/pages/projects/deplo-sites/deployments": () => new Response(JSON.stringify({ success: false, errors: [{ message: "token secret-token invalid for private-account" }] }), { status: 403 }),
    });
    await assert.rejects(deployStaticDirectory(root, "site-demo", config, { fetcher }), (error: Error) => {
      assert.equal(error.message, "Cloudflare Pages deployment failed. Check the server logs for details.");
      return true;
    });
    assert.equal(logged.join("").includes("secret-token"), false);
    assert.equal(logged.join("").includes(root), false);
    assert.match(logged.join(""), /deployment failed with HTTP 403/);
  } finally {
    console.error = originalError;
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects unsafe branch and project names before any network call", async () => {
  const { calls, fetcher } = fakeCloudflare();
  await assert.rejects(deployStaticDirectory("/tmp/site", "../main", config, { fetcher }), /branch name/);
  await assert.rejects(deployStaticDirectory("/tmp/site", "site-demo", { ...config, projectName: "a;b" }, { fetcher }), /project name/);
  assert.equal(calls.length, 0);
});

test("refuses deployment URLs outside pages.dev", async () => {
  const root = await makeSite();
  try {
    const { fetcher } = fakeCloudflare({
      "/accounts/account-123/pages/projects/deplo-sites/deployments": () => new Response(JSON.stringify({ success: true, result: { id: "x", url: "https://evil.example.com" } })),
    });
    await assert.rejects(deployStaticDirectory(root, "site-demo", config, { fetcher }), /did not return a Pages deployment URL/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("runs work with bounded concurrency and stops after the first failure", async () => {
  let running = 0;
  let peak = 0;
  const done: number[] = [];
  await forEachConcurrently([1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
    running += 1; peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running -= 1; done.push(item);
  });
  assert.equal(peak, 3);
  assert.deepEqual(done.sort(), [1, 2, 3, 4, 5, 6, 7]);

  const started: number[] = [];
  await assert.rejects(forEachConcurrently([1, 2, 3, 4, 5, 6], 2, async (item) => {
    started.push(item);
    await new Promise((resolve) => setTimeout(resolve, 2));
    if (item === 2) throw new Error("upload 2 failed");
  }), /upload 2 failed/);
  assert.ok(started.length < 6, "no new uploads start after a failure");
  await forEachConcurrently([], 4, async () => { throw new Error("never called"); });
});

test("splits large sites into several uploads that run in parallel", async () => {
  const root = await mkdtemp(join(tmpdir(), "deplo-pages-many-"));
  try {
    await writeFile(join(root, "index.html"), "<!doctype html><title>many</title>");
    await mkdir(join(root, "assets"));
    for (let index = 0; index < 700; index += 1) await writeFile(join(root, "assets", "f" + index + ".js"), "export const v = " + index + ";");
    let inFlight = 0;
    let peak = 0;
    const { calls, fetcher } = fakeCloudflare();
    const slowFetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/pages/assets/upload")) {
        inFlight += 1; peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 10));
        inFlight -= 1;
        calls.push({ url: String(input), method: "POST", authorization: "", body: JSON.parse(String(init?.body)) });
        return new Response(JSON.stringify({ success: true, result: null }));
      }
      return fetcher(input, init);
    }) as typeof fetch;
    await deployStaticDirectory(root, "site-demo", config, { fetcher: slowFetcher });
    const uploads = calls.filter((call) => call.url.endsWith("/pages/assets/upload"));
    assert.equal(uploads.length, 3, "701 files split into buckets of at most 250");
    assert.equal(uploads.reduce((sum, call) => sum + (call.body as unknown[]).length, 0), 701);
    assert.ok(peak > 1, "uploads overlap");
  } finally { await rm(root, { recursive: true, force: true }); }
});
