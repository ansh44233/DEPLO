import test from "node:test";
import assert from "node:assert/strict";
import { downloadGitHubSourceArchive, GitHubSourceArchiveError } from "../../lib/github/build-source";
const repository = { owner: "octocat", repository: "hello-world" };
const sha = "a".repeat(40); const token = "ghs_" + "x".repeat(36);
const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
test("downloads the exact commit archive with a short-lived installation token", async () => {
  let requestedUrl = ""; let init: RequestInit | undefined;
  const archive = await downloadGitHubSourceArchive(repository, sha, token, async (url, options) => {
    requestedUrl = String(url); init = options; return new Response(zip, { headers: { "Content-Length": String(zip.length) } });
  });
  assert.equal(requestedUrl, "https://api.github.com/repos/octocat/hello-world/zipball/" + sha);
  assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer " + token);
  assert.equal(init?.redirect, "follow"); assert.deepEqual([...archive], [...zip]);
});
test("rejects unsafe final redirect hosts", async () => {
  await assert.rejects(downloadGitHubSourceArchive(repository, sha, token, async () => {
    const response = new Response(zip, { headers: { "Content-Length": String(zip.length) } });
    Object.defineProperty(response, "url", { value: "https://evil.example/archive.zip" });
    return response;
  }), (error: unknown) => error instanceof GitHubSourceArchiveError && error.code === "invalid_source");
});
test("rejects invalid commit IDs and non-ZIP responses", async () => {
  await assert.rejects(downloadGitHubSourceArchive(repository, "main", token), /Invalid GitHub source request/);
  await assert.rejects(downloadGitHubSourceArchive(repository, sha, token, async () =>
    new Response("not zip", { headers: { "Content-Length": "7" } })),
  (error: unknown) => error instanceof GitHubSourceArchiveError && error.code === "invalid_archive");
});
