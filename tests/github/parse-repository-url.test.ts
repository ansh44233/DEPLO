import test from "node:test";
import assert from "node:assert/strict";
import { parsePublicGitHubUrl } from "../lib/github/parse-repository-url";

test("accepts a canonical public GitHub repository URL", () => {
  assert.deepEqual(
    parsePublicGitHubUrl("https://github.com/vercel/next.js"),
    { owner: "vercel", repository: "next.js" },
  );
});

test("accepts a trailing slash and .git suffix", () => {
  assert.deepEqual(
    parsePublicGitHubUrl("https://github.com/ansh44233/DEPLO.git/"),
    { owner: "ansh44233", repository: "DEPLO" },
  );
});

test("trims surrounding whitespace", () => {
  assert.deepEqual(
    parsePublicGitHubUrl("  https://github.com/vercel/next.js  "),
    { owner: "vercel", repository: "next.js" },
  );
});

test("rejects non-HTTPS URLs", () => {
  assert.equal(parsePublicGitHubUrl("http://github.com/vercel/next.js"), null);
});

test("rejects lookalike hosts", () => {
  assert.equal(parsePublicGitHubUrl("https://github.com.evil.example/vercel/next.js"), null);
});

test("rejects credentials and custom ports", () => {
  assert.equal(parsePublicGitHubUrl("https://user:pass@github.com/vercel/next.js"), null);
  assert.equal(parsePublicGitHubUrl("https://github.com:8443/vercel/next.js"), null);
});

test("rejects query strings and fragments", () => {
  assert.equal(parsePublicGitHubUrl("https://github.com/vercel/next.js?tab=readme"), null);
  assert.equal(parsePublicGitHubUrl("https://github.com/vercel/next.js#readme"), null);
});

test("rejects paths that are not repository roots", () => {
  assert.equal(parsePublicGitHubUrl("https://github.com/vercel/next.js/tree/main"), null);
  assert.equal(parsePublicGitHubUrl("https://github.com/vercel"), null);
});

test("rejects encoded path separators and malformed names", () => {
  assert.equal(parsePublicGitHubUrl("https://github.com/vercel%2Fevil/next.js"), null);
  assert.equal(parsePublicGitHubUrl("https://github.com/../next.js"), null);
  assert.equal(parsePublicGitHubUrl("not a URL"), null);
});
