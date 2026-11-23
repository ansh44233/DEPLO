import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { createGitHubAppJwt, createInstallationAccessToken } from "../../lib/github/app-auth";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

test("creates a short-lived RS256 GitHub App JWT", () => {
  const token = createGitHubAppJwt("12345", pem, 1_700_000_000);
  const [header, payload, signature] = token.split(".");
  assert.ok(header && payload && signature);
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), { alg: "RS256", typ: "JWT" });
  assert.deepEqual(JSON.parse(Buffer.from(payload, "base64url").toString()), { iat: 1_699_999_940, exp: 1_700_000_480, iss: "12345" });
  const verifier = createVerify("RSA-SHA256");
  verifier.update(header + "." + payload);
  verifier.end();
  assert.equal(verifier.verify(publicKey, Buffer.from(signature, "base64url")), true);
});

test("rejects missing app credentials and invalid installation IDs", async () => {
  assert.throws(() => createGitHubAppJwt("", pem), /credentials/);
  await assert.rejects(() => createInstallationAccessToken(0, "12345", pem), /Invalid GitHub App installation/);
});

test("requests a read-only installation token", async () => {
  let requestUrl = "";
  let requestBody = "";
  const token = await createInstallationAccessToken(987, "12345", pem, async (input, init) => {
    requestUrl = String(input);
    requestBody = String(init?.body);
    return new Response(JSON.stringify({ token: "ghs_" + "x".repeat(35) }), { status: 201 });
  });
  assert.equal(token, "ghs_" + "x".repeat(35));
  assert.equal(requestUrl, "https://api.github.com/app/installations/987/access_tokens");
  assert.deepEqual(JSON.parse(requestBody), { permissions: { contents: "read", metadata: "read" } });
});

test("scopes the installation token to the requested repositories", async () => {
  let requestBody = "";
  await createInstallationAccessToken(987, "12345", pem, async (_input, init) => {
    requestBody = String(init?.body);
    return new Response(JSON.stringify({ token: "ghs_" + "x".repeat(35) }), { status: 201 });
  }, ["website"]);
  assert.deepEqual(JSON.parse(requestBody), { repositories: ["website"], permissions: { contents: "read", metadata: "read" } });
});

test("refuses an empty or malformed repository scope instead of widening the token", async () => {
  const fetcher = async () => { throw new Error("must not call GitHub"); };
  for (const scope of [[], [".."], ["."], ["a/b"], ["with space"], [""], ["x".repeat(101)]]) {
    await assert.rejects(() => createInstallationAccessToken(987, "12345", pem, fetcher as typeof fetch, scope), /Invalid GitHub repository scope/);
  }
});
