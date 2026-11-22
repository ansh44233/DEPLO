import test from "node:test";
import assert from "node:assert/strict";
import {
  ensureCloudflarePagesProject,
  getAccountPagesTarget,
} from "../../lib/deploy/cloudflare-projects";

const baseConfig = {
  accountId: "account-id",
  apiToken: "secret-token",
  projectName: "legacy-shared-project",
};

test("derives stable isolated Pages project names and production branches per account project", () => {
  const first = getAccountPagesTarget(baseConfig, 212031680, "portfolio");
  const repeated = getAccountPagesTarget(baseConfig, 212031680, "portfolio");
  const otherOwner = getAccountPagesTarget(baseConfig, 212031681, "portfolio");
  const otherProject = getAccountPagesTarget(baseConfig, 212031680, "docs-site");

  assert.deepEqual(first, repeated);
  assert.notEqual(first.config.projectName, otherOwner.config.projectName);
  assert.notEqual(first.config.projectName, otherProject.config.projectName);
  assert.match(first.config.projectName, /^[a-z0-9][a-z0-9-]{0,62}$/);
  assert.ok(first.config.projectName.length <= 63);
  assert.equal(first.productionBranch, "site-portfolio");
  assert.equal(first.config.accountId, baseConfig.accountId);
  assert.equal(first.config.apiToken, baseConfig.apiToken);
});

test("rejects invalid account IDs and project slugs", () => {
  assert.throws(() => getAccountPagesTarget(baseConfig, 0, "portfolio"), /Invalid GitHub account ID/);
  assert.throws(() => getAccountPagesTarget(baseConfig, 1.5, "portfolio"), /Invalid GitHub account ID/);
  assert.throws(() => getAccountPagesTarget(baseConfig, 123, "../private"), /Invalid DEPLO project slug/);
});

test("reuses an existing Pages project only when its production branch matches", async () => {
  const methods: string[] = [];
  await ensureCloudflarePagesProject(
    { ...baseConfig, projectName: "deplo-abc123-portfolio" },
    "site-portfolio",
    async (_input, init) => {
      methods.push(init?.method ?? "GET");
      return new Response(JSON.stringify({
        success: true,
        result: { name: "deplo-abc123-portfolio", production_branch: "site-portfolio" },
      }), { status: 200 });
    },
  );
  assert.deepEqual(methods, ["GET"]);
});

test("creates a missing Pages project with the intended production branch", async () => {
  const requests: { url: string; method: string; body?: string; authorization: string | null }[] = [];
  await ensureCloudflarePagesProject(
    { ...baseConfig, projectName: "deplo-abc123-portfolio" },
    "site-portfolio",
    async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : undefined,
        authorization: new Headers(init?.headers).get("authorization"),
      });
      if (init?.method === "GET") return new Response("{}", { status: 404 });
      return new Response(JSON.stringify({
        success: true,
        result: { name: "deplo-abc123-portfolio", production_branch: "site-portfolio" },
      }), { status: 200 });
    },
  );

  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.method, "GET");
  assert.equal(requests[1]?.method, "POST");
  assert.match(requests[0]?.url ?? "", /\/pages\/projects\/deplo-abc123-portfolio$/);
  assert.match(requests[1]?.url ?? "", /\/accounts\/[^/]+\/pages\/projects$/, "projects are created on the collection endpoint");
  assert.equal(requests[1]?.authorization, "Bearer secret-token");
  assert.deepEqual(JSON.parse(requests[1]?.body ?? "{}"), {
    name: "deplo-abc123-portfolio",
    production_branch: "site-portfolio",
  });
});

test("fails closed when an existing Pages project has a different production branch", async () => {
  await assert.rejects(
    ensureCloudflarePagesProject(
      { ...baseConfig, projectName: "deplo-abc123-portfolio" },
      "site-portfolio",
      async () => new Response(JSON.stringify({
        success: true,
        result: { name: "deplo-abc123-portfolio", production_branch: "main" },
      }), { status: 200 }),
    ),
    /does not match this DEPLO project/,
  );
});

test("verifies the winner when concurrent requests race to create a Pages project", async () => {
  let calls = 0;
  await ensureCloudflarePagesProject(
    { ...baseConfig, projectName: "deplo-abc123-portfolio" },
    "site-portfolio",
    async (_input, init) => {
      calls += 1;
      if (calls === 1) return new Response("{}", { status: 404 });
      if (init?.method === "POST") return new Response("{}", { status: 409 });
      return new Response(JSON.stringify({
        success: true,
        result: { name: "deplo-abc123-portfolio", production_branch: "site-portfolio" },
      }), { status: 200 });
    },
  );
  assert.equal(calls, 3);
});

test("rejects invalid project names and production branches before network calls", async () => {
  let called = false;
  await assert.rejects(
    ensureCloudflarePagesProject({ ...baseConfig, projectName: "../bad" }, "site-portfolio", async () => {
      called = true;
      return new Response("{}");
    }),
    /Invalid Cloudflare Pages project name/,
  );
  await assert.rejects(
    ensureCloudflarePagesProject({ ...baseConfig, projectName: "valid-project" }, "../bad", async () => {
      called = true;
      return new Response("{}");
    }),
    /Invalid Cloudflare Pages production branch/,
  );
  assert.equal(called, false);
});

test("surfaces Cloudflare's error code and a permission hint without the token", async () => {
  const originalError = console.error;
  console.error = () => undefined;
  try {
    await assert.rejects(
      ensureCloudflarePagesProject({ ...baseConfig, projectName: "deplo-abc123-portfolio" }, "site-portfolio", async (_input, init) => {
        if ((init?.method ?? "GET") === "GET") return new Response("{}", { status: 404 });
        return new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message: "Authentication error" }] }), { status: 403 });
      }),
      (error: Error) => {
        assert.match(error.message, /could not be created \(HTTP 403, 10000 Authentication error/);
        assert.match(error.message, /Cloudflare Pages: Edit/);
        assert.equal(error.message.includes("secret-token"), false);
        return true;
      },
    );
  } finally { console.error = originalError; }
});

test("keeps generated project names within Cloudflare's 58-character limit", () => {
  const target = getAccountPagesTarget({ accountId: "a", apiToken: "t" }, 42, "a".repeat(58));
  assert.ok(target.config.projectName.length <= 58, target.config.projectName);
  assert.match(target.config.projectName, /^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
});
