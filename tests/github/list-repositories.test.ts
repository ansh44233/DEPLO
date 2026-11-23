import test from "node:test";
import assert from "node:assert/strict";
import { listUserRepositories, toRepositorySummary } from "../../lib/github/list-repositories";

const repo = (n: number, extra: Record<string, unknown> = {}) => ({
  full_name: "me/repo-" + n, html_url: "https://github.com/me/repo-" + n, private: n % 2 === 0,
  default_branch: "main", description: "d", language: "TypeScript", pushed_at: "2026-11-01T00:00:00Z", ...extra,
});

test("maps GitHub repositories to safe summaries and drops archived or malformed ones", () => {
  assert.deepEqual(toRepositorySummary(repo(2)), {
    fullName: "me/repo-2", name: "repo-2", owner: "me", private: true, defaultBranch: "main", description: "d",
    language: "TypeScript", updatedAt: "2026-11-01T00:00:00Z", url: "https://github.com/me/repo-2",
  });
  assert.equal(toRepositorySummary(repo(1, { archived: true })), null);
  assert.equal(toRepositorySummary(repo(1, { full_name: "../../etc" })), null);
  assert.equal(toRepositorySummary(repo(1, { html_url: "https://evil.example/me/repo" })), null);
});

test("pages through /user/repos with the user's token", async () => {
  const urls: string[] = [];
  let auth = "";
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    urls.push(String(input));
    auth = new Headers(init?.headers).get("authorization") ?? "";
    const page = Number(new URL(String(input)).searchParams.get("page"));
    const size = page === 1 ? 100 : 7;
    return Response.json(Array.from({ length: size }, (_, i) => repo(page * 1000 + i)));
  }) as typeof fetch;
  const result = await listUserRepositories("gho_x", fetcher);
  assert.equal(result.length, 107);
  assert.equal(urls.length, 2);
  assert.match(urls[0], /\/user\/repos\?per_page=100&sort=pushed/);
  assert.equal(auth, "Bearer gho_x");
});

test("reports an expired token distinctly", async () => {
  const fetcher = (async () => new Response("", { status: 401 })) as unknown as typeof fetch;
  await assert.rejects(listUserRepositories("gho_x", fetcher), (error: Error & { status?: number }) => error.status === 401);
});
