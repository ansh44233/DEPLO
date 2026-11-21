import test from "node:test";
import assert from "node:assert/strict";
import { addPagesDomain, listPagesDomains, normalizeCustomDomain, removePagesDomain } from "../../lib/deploy/cloudflare-domains";

const config = { accountId: "account-id", apiToken: "server-secret", projectName: "deplo-project" };

test("normalizes valid hostnames and rejects URLs, IPs, wildcards and provider hostnames", () => {
  assert.equal(normalizeCustomDomain(" WWW.Example.com. "), "www.example.com");
  for (const value of ["", "https://example.com", "example.com/path", "*.example.com", "127.0.0.1", "localhost", "demo.pages.dev", "bad_domain.example", "-bad.example"]) {
    assert.throws(() => normalizeCustomDomain(value));
  }
});

test("adds a domain through the authenticated Cloudflare Pages API and maps DNS verification data", async () => {
  let requestUrl = "";
  let requestBody = "";
  let authorization = "";
  const domain = await addPagesDomain(config, "www.example.com", async (input, init) => {
    requestUrl = String(input);
    requestBody = String(init?.body);
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    return new Response(JSON.stringify({ success: true, result: {
      id: "domain-id", name: "www.example.com", status: "pending", created_on: "2026-11-21T10:00:00Z",
      validation_data: { method: "txt", status: "pending", txt_name: "_cf-custom-hostname.www.example.com", txt_value: "verify-token" },
      verification_data: { status: "pending" },
    } }), { status: 200 });
  });
  assert.match(requestUrl, /accounts\/account-id\/pages\/projects\/deplo-project\/domains$/);
  assert.equal(requestBody, JSON.stringify({ name: "www.example.com" }));
  assert.equal(authorization, "Bearer server-secret");
  assert.equal(domain.name, "www.example.com");
  assert.equal(domain.validation.method, "txt");
  assert.equal(domain.validation.txtValue, "verify-token");
  assert.equal(domain.status, "pending");
});

test("lists and sanitizes provider domains", async () => {
  const domains = await listPagesDomains(config, async () => new Response(JSON.stringify({ success: true, result: [
    { id: "one", name: "example.com", status: "active", validation_data: { method: "http", status: "active" }, verification_data: { status: "active" } },
  ] }), { status: 200 }));
  assert.equal(domains.length, 1);
  assert.equal(domains[0]?.status, "active");
  assert.equal(domains[0]?.validation.method, "http");
});

test("removes a domain with a safely encoded hostname", async () => {
  let url = "";
  let method = "";
  await removePagesDomain(config, "www.example.com", async (input, init) => {
    url = String(input);
    method = init?.method ?? "";
    return new Response(null, { status: 204 });
  });
  assert.match(url, /domains\/www.example.com$/);
  assert.equal(method, "DELETE");
});

test("treats a 204 response as a successful domain removal", async () => {
  await removePagesDomain(config, "example.com", async () => new Response(null, { status: 204 }));
});

test("fails closed when Cloudflare rejects domain creation", async () => {
  await assert.rejects(addPagesDomain(config, "example.com", async () =>
    new Response(JSON.stringify({ success: false, errors: [{ message: "provider detail" }] }), { status: 400 }),
  ), /Cloudflare rejected this domain/);
});
