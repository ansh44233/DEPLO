import test from "node:test";
import assert from "node:assert/strict";
import { isValidRepositoryFullName, repositoryNameOf } from "../../lib/github/repository-name";

test("accepts ordinary owner/repository names", () => {
  for (const name of ["octocat/hello-world", "Example/Website", "a/b", "o_w.n-er/re.po_1", "a/..hidden", "a/.github"]) {
    assert.equal(isValidRepositoryFullName(name), true, name);
  }
});

test("rejects dot-segments that would rewrite the GitHub API path", () => {
  for (const name of ["../x", "x/..", "./x", "x/.", "../..", "./."]) {
    assert.equal(isValidRepositoryFullName(name), false, name);
  }
});

test("rejects anything that is not exactly two safe segments", () => {
  const bad: unknown[] = [
    "", "owner", "a/b/c", "/b", "a/", "a b/c", "a/b c", "a/b?x=1", "a/b#frag", "a/b%2e%2e", "a/b\\c", "a/b\n", "a\u0000/b",
    "ａ/b", "K/b", "a/é", "a/" + "x".repeat(101), "x".repeat(101) + "/b", 42, null, undefined, {}, ["a/b"],
  ];
  for (const name of bad) assert.equal(isValidRepositoryFullName(name), false, JSON.stringify(name));
});

test("repositoryNameOf returns the repository half and refuses invalid names", () => {
  assert.equal(repositoryNameOf("Example/Website"), "Website");
  assert.throws(() => repositoryNameOf("../x"));
  assert.throws(() => repositoryNameOf("no-slash"));
});
