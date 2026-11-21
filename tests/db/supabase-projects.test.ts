import test from "node:test";
import assert from "node:assert/strict";
import { createOwnedProject, getOwnedProjectById, listOwnedProjects, ProjectStoreError, renameOwnedProject, updateOwnedProjectDeployment, type OwnedProject } from "../../lib/db/supabase-projects";

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


test("looks up a project using both its ID and authenticated owner ID", async () => {
  let requestedUrl = "";
  const fetcher: typeof fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify([project]), { status: 200 });
  };
  const result = await getOwnedProjectById(12345, project.id, env, fetcher);
  const url = new URL(requestedUrl);
  assert.equal(url.searchParams.get("id"), "eq." + project.id);
  assert.equal(url.searchParams.get("owner_github_id"), "eq.12345");
  assert.equal(result?.id, project.id);
});

test("returns no project when the requested ID is not owned by the signed-in user", async () => {
  const fetcher: typeof fetch = async () => new Response("[]", { status: 200 });
  const result = await getOwnedProjectById(99999, project.id, env, fetcher);
  assert.equal(result, null);
});

test("updates deployment URL only for the matching account-owned project", async () => {
  let requestedUrl = "";
  let requestBody = "";
  const fetcher: typeof fetch = async (input, init) => {
    requestedUrl = String(input);
    requestBody = String(init?.body ?? "");
    return new Response(JSON.stringify([{ ...project, deployment_url: "https://site.pages.dev" }]), { status: 200 });
  };
  const result = await updateOwnedProjectDeployment(12345, project.id, "https://site.pages.dev", env, fetcher);
  const url = new URL(requestedUrl);
  assert.equal(url.searchParams.get("owner_github_id"), "eq.12345");
  assert.equal(url.searchParams.get("id"), "eq." + project.id);
  assert.equal(JSON.parse(requestBody).deployment_url, "https://site.pages.dev");
  assert.equal(result.deployment_url, "https://site.pages.dev");
});


test("renames only the project matching its ID and authenticated owner", async () => {
  let requestedUrl = "";
  let requestBody = "";
  const fetcher: typeof fetch = async (input, init) => { requestedUrl = String(input); requestBody = String(init?.body ?? ""); return new Response(JSON.stringify([{ ...project, name: "Renamed site" }]), { status: 200 }); };
  const result = await renameOwnedProject(12345, project.id, "Renamed site", env, fetcher);
  const url = new URL(requestedUrl);
  assert.equal(url.searchParams.get("id"), "eq." + project.id);
  assert.equal(url.searchParams.get("owner_github_id"), "eq.12345");
  assert.equal(JSON.parse(requestBody).name, "Renamed site");
  assert.equal(result.name, "Renamed site");
});

test("does not rename a project that is not owned by the signed-in account", async () => {
  const fetcher: typeof fetch = async () => new Response("[]", { status: 200 });
  await assert.rejects(renameOwnedProject(99999, project.id, "Renamed site", env, fetcher), (error: unknown) => error instanceof ProjectStoreError && error.status === 404);
});
