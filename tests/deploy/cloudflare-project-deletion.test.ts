import test from "node:test";
import assert from "node:assert/strict";
import { deleteCloudflarePagesProject } from "../../lib/deploy/cloudflare-projects";

const config = {
  accountId: "account-id",
  apiToken: "server-secret-token",
  projectName: "deplo-abc123-my-site",
};

test("deletes only the derived Pages project using server-side credentials", async () => {
  let requestedUrl = "";
  let method = "";
  let authorization: string | null = null;
  const result = await deleteCloudflarePagesProject(config, async (input, init) => {
    requestedUrl = String(input);
    method = init?.method ?? "";
    authorization = new Headers(init?.headers).get("authorization");
    return new Response(JSON.stringify({ success: true, result: { id: "project-id" } }), { status: 200 });
  });
  assert.equal(new URL(requestedUrl).pathname, "/client/v4/accounts/account-id/pages/projects/deplo-abc123-my-site");
  assert.equal(method, "DELETE");
  assert.equal(authorization, "Bearer server-secret-token");
  assert.equal(result, "deleted");
});

test("treats an already absent Pages project as safely cleaned up", async () => {
  const result = await deleteCloudflarePagesProject(config, async () => new Response("{}", { status: 404 }));
  assert.equal(result, "already-absent");
});

test("accepts a successful empty 204 deletion response", async () => {
  const result = await deleteCloudflarePagesProject(config, async () => new Response(null, { status: 204 }));
  assert.equal(result, "deleted");
});

test("fails closed when Cloudflare rejects project deletion", async () => {
  await assert.rejects(
    deleteCloudflarePagesProject(config, async () => new Response("{}", { status: 403 })),
    /could not be deleted/,
  );
});

test("rejects invalid project names before calling Cloudflare", async () => {
  let called = false;
  await assert.rejects(
    deleteCloudflarePagesProject({ ...config, projectName: "../bad" }, async () => {
      called = true;
      return new Response("{}");
    }),
    /Invalid Cloudflare Pages project name/,
  );
  assert.equal(called, false);
});
