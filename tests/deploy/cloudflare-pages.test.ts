import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import {
  buildPagesDeployArgs,
  isValidPagesBranch,
  isValidPagesProjectName,
  readCloudflarePagesConfig,
  readCloudflarePagesCredentials,
} from "../../lib/deploy/cloudflare-pages";

test("reads Cloudflare Pages configuration from server environment values", () => {
  assert.deepEqual(
    readCloudflarePagesConfig({
      CLOUDFLARE_ACCOUNT_ID: " account-123 ",
      CLOUDFLARE_API_TOKEN: " secret-token ",
      CLOUDFLARE_PAGES_PROJECT_NAME: "deplo-sites",
    }),
    { accountId: "account-123", apiToken: "secret-token", projectName: "deplo-sites" },
  );
});

test("requires all Cloudflare credentials and a valid project name", () => {
  assert.equal(readCloudflarePagesConfig({}), null);
  assert.equal(
    readCloudflarePagesConfig({
      CLOUDFLARE_ACCOUNT_ID: "account",
      CLOUDFLARE_API_TOKEN: "token",
      CLOUDFLARE_PAGES_PROJECT_NAME: "../unsafe",
    }),
    null,
  );
});

test("validates project and branch names without accepting shell syntax", () => {
  assert.equal(isValidPagesProjectName("deplo-sites"), true);
  assert.equal(isValidPagesProjectName("../deplo"), false);
  assert.equal(isValidPagesBranch("site-my-project"), true);
  assert.equal(isValidPagesBranch("site;rm"), false);
});

test("builds a fixed Wrangler argument list without shell interpolation", () => {
  assert.deepEqual(buildPagesDeployArgs("/tmp/deplo-site", "deplo-sites", "site-demo"), [
    "pages",
    "deploy",
    resolve("/tmp/deplo-site"),
    "--project-name",
    "deplo-sites",
    "--branch",
    "site-demo",
    "--commit-dirty=true",
  ]);
  assert.throws(() => buildPagesDeployArgs("/tmp/site", "deplo;bad", "site-demo"), /project name/);
  assert.throws(() => buildPagesDeployArgs("/tmp/site", "deplo-sites", "../main"), /branch name/);
});


test("reads account-level Cloudflare credentials without requiring a legacy shared project", () => {
  assert.deepEqual(readCloudflarePagesCredentials({
    CLOUDFLARE_ACCOUNT_ID: " account-123 ",
    CLOUDFLARE_API_TOKEN: " secret-token ",
  }), {
    accountId: "account-123",
    apiToken: "secret-token",
  });
  assert.equal(readCloudflarePagesCredentials({ CLOUDFLARE_ACCOUNT_ID: "account" }), null);
});
