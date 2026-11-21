import test from "node:test";
import assert from "node:assert/strict";
import { createOwnedProject, listOwnedProjects, ProjectStoreError, type OwnedProject } from "../../lib/db/supabase-projects";

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
  deployment_url: null,
  created_at: "2026-11-21T00:00:00.000Z",
  updated_at: "2026-11-21T00:00:00.000Z",
};

test("lists projects filtered by the authenticated GitHub account ID", async () => {
  let requestedUrl = "";
  let requestInit: RequestInit | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    requestedUrl = String(input);
    requestInit = init;
    return new Response(JSON.stringify([project]), { status: 200 });
  };
  const rows = await listOwnedProjects(12345, env, fetcher);
  const url = new URL(requestedUrl);
  assert.equal(url.searchParams.get("owner_github_id"), "eq.12345");
  assert.equal(url.searchParams.get("select")?.includes("owner_github_id"), false);
  assert.deepEqual(rows, [project]);
  const headers = new Headers(requestInit?.headers);
  assert.equal(headers.get("apikey"), env.SUPABASE_SERVICE_ROLE_KEY);
  assert.equal(headers.get("Authorization"), "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY);
  assert.equal(requestInit?.cache, "no-store");
});

test("creates a project using the server-provided owner ID", async () => {
  let body = "";
  let method = "";
  const fetcher: typeof fetch = async (_input, init) => {
    method = init?.method ?? "";
    body = String(init?.body ?? "");
    return new Response(JSON.stringify([project]), { status: 201 });
  };
  const result = await createOwnedProject({
    owner_github_id: 12345,
    name: "My Site",
    slug: "my-site",
    source_type: "github",
    repository_url: "https://github.com/example/site",
    branch: "main",
  }, env, fetcher);
  assert.equal(method, "POST");
  assert.equal(JSON.parse(body).owner_github_id, 12345);
  assert.equal(result.id, project.id);
});

test("rejects missing or unsafe database configuration", async () => {
  await assert.rejects(
    listOwnedProjects(12345, {}),
    (error: unknown) => error instanceof ProjectStoreError && error.status === 503,
  );
  await assert.rejects(
    listOwnedProjects(12345, { ...env, SUPABASE_URL: "http://example.com" }),
    (error: unknown) => error instanceof ProjectStoreError && error.status === 503,
  );
});

test("normalizes duplicate project slug responses to a conflict", async () => {
  const fetcher: typeof fetch = async () => new Response("duplicate", { status: 409 });
  await assert.rejects(
    createOwnedProject({
      owner_github_id: 12345,
      name: "My Site",
      slug: "my-site",
      source_type: "html",
      repository_url: null,
      branch: null,
    }, env, fetcher),
    (error: unknown) => error instanceof ProjectStoreError && error.status === 409,
  );
});
