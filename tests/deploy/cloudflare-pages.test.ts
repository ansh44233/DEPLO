import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { resolve } from "node:path";
import {
  buildPagesDeployArgs,
  cloudflarePagesDeploymentFailure,
  deployStaticDirectory,
  isValidPagesBranch,
  isValidPagesProjectName,
  readCloudflarePagesConfig,
  readCloudflarePagesCredentials,
} from "../../lib/deploy/cloudflare-pages";

const config = {
  accountId: "account-123",
  apiToken: "secret-token",
  projectName: "deplo-sites",
};

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    kill: (signal: NodeJS.Signals) => boolean;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  return child;
}

const allowAccess = async () => undefined;

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

test("returns a stable public deployment error without including private CLI output", () => {
  const privateOutput = "Bearer secret-token /srv/deplo/private/work account=private-account";
  const error = cloudflarePagesDeploymentFailure();
  assert.equal(error.message, "Cloudflare Pages deployment failed. Check the server logs for details.");
  assert.equal(error.message.includes(privateOutput), false);
  assert.equal(error.message.includes("secret-token"), false);
  assert.equal(error.message.includes("/srv/deplo/private/work"), false);
});

test("redacts Wrangler process startup errors", async () => {
  const privateDetails = "spawn failed at /srv/deplo/private/wrangler.js with token secret-token";
  const child = fakeChild();
  const spawnProcess = (() => {
    process.nextTick(() => child.emit("error", new Error(privateDetails)));
    return child;
  }) as unknown as typeof import("node:child_process").spawn;

  await assert.rejects(
    deployStaticDirectory("/tmp/site", "site-demo", config, {
      accessPath: allowAccess,
      spawnProcess,
    }),
    (error: Error) => {
      assert.equal(error.message, "Cloudflare Pages deployment failed. Check the server logs for details.");
      assert.equal(error.message.includes(privateDetails), false);
      assert.equal(error.message.includes("secret-token"), false);
      assert.equal(error.message.includes("/srv/deplo/private"), false);
      return true;
    },
  );
});

test("redacts Wrangler non-zero exit output", async () => {
  const privateDetails = "account private-account token secret-token path /srv/deplo/private/site";
  const child = fakeChild();
  const spawnProcess = (() => {
    process.nextTick(() => {
      child.stdout.write(privateDetails);
      child.stderr.write("Wrangler failed: " + privateDetails);
      child.emit("close", 1);
    });
    return child;
  }) as unknown as typeof import("node:child_process").spawn;

  await assert.rejects(
    deployStaticDirectory("/tmp/site", "site-demo", config, {
      accessPath: allowAccess,
      spawnProcess,
    }),
    (error: Error) => {
      assert.equal(error.message, "Cloudflare Pages deployment failed. Check the server logs for details.");
      assert.equal(error.message.includes("secret-token"), false);
      assert.equal(error.message.includes("private-account"), false);
      assert.equal(error.message.includes("/srv/deplo/private/site"), false);
      return true;
    },
  );
});

test("redacts synchronous Wrangler spawn exceptions", async () => {
  const spawnProcess = (() => {
    throw new Error("private host /srv/deplo/private and secret-token");
  }) as unknown as typeof import("node:child_process").spawn;

  await assert.rejects(
    deployStaticDirectory("/tmp/site", "site-demo", config, {
      accessPath: allowAccess,
      spawnProcess,
    }),
    (error: Error) => {
      assert.equal(error.message, "Cloudflare Pages deployment failed. Check the server logs for details.");
      assert.equal(error.message.includes("secret-token"), false);
      assert.equal(error.message.includes("/srv/deplo/private"), false);
      return true;
    },
  );
});
