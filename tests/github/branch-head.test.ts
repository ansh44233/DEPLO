import test from "node:test";
import assert from "node:assert/strict";
import { resolveBranchHead } from "../../lib/github/branch-head";

const sha = "0123456789abcdef0123456789abcdef01234567";

test("resolves a branch to one commit SHA", async () => {
  let seen: { url: string; accept: string | null; authorization: string | null } | null = null;
  const fetcher = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    seen = { url: String(input), accept: headers.get("accept"), authorization: headers.get("authorization") };
    return new Response(sha + "\n");
  }) as typeof fetch;
  assert.equal(await resolveBranchHead({ owner: "acme", repository: "site", branch: "feature/x y", token: "gho_t" }, fetcher), sha);
  assert.deepEqual(seen, { url: "https://api.github.com/repos/acme/site/commits/feature/x%20y", accept: "application/vnd.github.sha", authorization: "Bearer gho_t" });
});

test("anything but a clean SHA means unknown", async () => {
  for (const response of [new Response("not found", { status: 404 }), new Response("<html>"), new Response(sha.slice(0, 39))]) {
    assert.equal(await resolveBranchHead({ owner: "a", repository: "b", branch: "main", token: null }, (async () => response) as typeof fetch), null);
  }
  assert.equal(await resolveBranchHead({ owner: "a", repository: "b", branch: "main", token: null }, (async () => { throw new Error("down"); }) as typeof fetch), null);
});
