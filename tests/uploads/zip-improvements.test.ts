import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSiteRoot } from "../../lib/uploads/site-root";
import { createStagedUpload, isOwnStagedPath, takeStagedUpload } from "../../lib/uploads/staged-upload";

const env = { SUPABASE_URL: "https://db.example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "sb_secret_x" };
const projectId = "11111111-1111-4111-8111-111111111111";

test("finds the site inside a zipped folder and ignores macOS metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "deplo-root-"));
  try {
    await mkdir(join(root, "__MACOSX", "my-site"), { recursive: true });
    await mkdir(join(root, "my-site", "assets"), { recursive: true });
    await writeFile(join(root, "my-site", "index.html"), "x");
    await writeFile(join(root, ".DS_Store"), "x");
    assert.equal(await resolveSiteRoot(root), join(root, "my-site"));

    const flat = await mkdtemp(join(tmpdir(), "deplo-root-flat-"));
    await writeFile(join(flat, "index.html"), "x");
    assert.equal(await resolveSiteRoot(flat), flat);

    const project = await mkdtemp(join(tmpdir(), "deplo-root-pkg-"));
    await mkdir(join(project, "app"));
    await writeFile(join(project, "app", "package.json"), "{}");
    assert.equal(await resolveSiteRoot(project), join(project, "app"));

    const two = await mkdtemp(join(tmpdir(), "deplo-root-two-"));
    await mkdir(join(two, "a")); await mkdir(join(two, "b"));
    assert.equal(await resolveSiteRoot(two), two, "ambiguous layouts are left alone");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("only accepts staged paths inside the caller's own project folder", () => {
  const own = "42/" + projectId + "/22222222-2222-4222-8222-222222222222.zip";
  assert.equal(isOwnStagedPath(own, 42, projectId), true);
  assert.equal(isOwnStagedPath(own, 43, projectId), false);
  assert.equal(isOwnStagedPath("42/" + projectId + "/../../other.zip", 42, projectId), false);
  assert.equal(isOwnStagedPath(null, 42, projectId), false);
});

test("creates the private bucket if needed and returns a signed upload URL", async () => {
  const calls: { url: string; method: string; body?: string }[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
    if (url.endsWith("/bucket")) return new Response('{"statusCode":"409","error":"Duplicate","message":"The resource already exists"}', { status: 400 });
    return Response.json({ url: "/object/upload/sign/deplo-uploads/x?token=abc" });
  }) as typeof fetch;
  const staged = await createStagedUpload(42, projectId, "zip", env, fetcher);
  assert.equal(staged.uploadUrl, "https://db.example.supabase.co/storage/v1/object/upload/sign/deplo-uploads/x?token=abc");
  assert.equal(isOwnStagedPath(staged.path, 42, projectId), true);
  assert.equal(JSON.parse(calls[0].body ?? "{}").public, false, "the bucket is private");
  assert.match(calls[1].url, /\/object\/upload\/sign\/deplo-uploads\/42\//);
});

test("reads a staged upload once and always deletes it", async () => {
  const methods: string[] = [];
  const ok = (async (input: string | URL | Request, init?: RequestInit) => {
    methods.push((init?.method ?? "GET") + " " + new URL(String(input)).pathname);
    if ((init?.method ?? "GET") === "DELETE") return new Response("[]");
    return new Response(new Uint8Array([80, 75, 3, 4]));
  }) as typeof fetch;
  const bytes = await takeStagedUpload("42/x.zip", env, ok);
  assert.deepEqual([...bytes], [80, 75, 3, 4]);
  assert.deepEqual(methods, ["GET /storage/v1/object/deplo-uploads/42/x.zip", "DELETE /storage/v1/object/deplo-uploads"]);

  const huge = (async (_input: string | URL | Request, init?: RequestInit) => {
    if ((init?.method ?? "GET") === "DELETE") { methods.push("DELETE"); return new Response("[]"); }
    return new Response("x", { headers: { "content-length": String(30 * 1024 * 1024) } });
  }) as typeof fetch;
  methods.length = 0;
  await assert.rejects(takeStagedUpload("42/x.zip", env, huge), /larger than 25 MB/);
  assert.deepEqual(methods, ["DELETE"], "oversized uploads are still removed");
});
