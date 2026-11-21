import test from "node:test";
import assert from "node:assert/strict";
import { deleteOwnedProject, ProjectStoreError, type OwnedProject } from "../../lib/db/supabase-projects";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "server-only-service-role-secret",
};
const project: OwnedProject = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "My Site",
  slug: "my-site",
  source_type: "github",
  repository_url: "https://github.com/example/site",
  branch: "main",
  deployment_url: "https://my-site.pages.dev",
  created_at: "2026-11-21T00:00:00.000Z",
  updated_at: "2026-11-21T00:00:00.000Z",
};

test("deletes only the project matching both its ID and authenticated owner", async () => {
  let requestedUrl = "";
  let method = "";
  let headers: Headers | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    requestedUrl = String(input);
    method = init?.method ?? "";
    headers = new Headers(init?.headers);
    return new Response(JSON.stringify([project]), { status: 200 });
  };
  const deleted = await deleteOwnedProject(12345, project.id, env, fetcher);
  const url = new URL(requestedUrl);
  assert.equal(method, "DELETE");
  assert.equal(url.searchParams.get("id"), "eq." + project.id);
  assert.equal(url.searchParams.get("owner_github_id"), "eq.12345");
  assert.equal(headers?.get("Prefer"), "return=representation");
  assert.equal(deleted, true);
});

test("does not report deletion when the project is not owned by the account", async () => {
  const fetcher: typeof fetch = async () => new Response("[]", { status: 200 });
  assert.equal(await deleteOwnedProject(99999, project.id, env, fetcher), false);
});

test("rejects deletion when account storage is not configured", async () => {
  await assert.rejects(
    deleteOwnedProject(12345, project.id, {}),
    (error: unknown) => error instanceof ProjectStoreError && error.status === 503,
  );
});
