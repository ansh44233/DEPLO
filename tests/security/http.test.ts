import test from "node:test";
import assert from "node:assert/strict";
import { crossSiteRejection, securityHeaders } from "../../lib/security/http";

const env = { DEPLO_BASE_URL: "https://deplo.example", SUPABASE_URL: "https://abc.supabase.co" };
const request = (overrides: Partial<Parameters<typeof crossSiteRejection>[0]>) => ({
  method: "POST", pathname: "/api/projects", requestOrigin: "https://deplo.example", origin: "https://deplo.example", secFetchSite: "same-origin", ...overrides,
});

test("state-changing API calls from another site are refused", () => {
  assert.equal(crossSiteRejection(request({}), env), null);
  assert.equal(crossSiteRejection(request({ origin: "https://evil.example" }), env), "Request origin could not be verified.");
  assert.equal(crossSiteRejection(request({ origin: "null" }), env), "Request origin could not be verified.");
  assert.equal(crossSiteRejection(request({ origin: null, secFetchSite: "cross-site" }), env), "Request origin could not be verified.");
  for (const method of ["PUT", "PATCH", "DELETE", "delete"]) {
    assert.ok(crossSiteRejection(request({ method, origin: "https://evil.example" }), env));
  }
});

test("reads, non-browser clients and secret-authenticated endpoints are not blocked", () => {
  assert.equal(crossSiteRejection(request({ method: "GET", origin: "https://evil.example" }), env), null);
  assert.equal(crossSiteRejection(request({ origin: null, secFetchSite: null }), env), null);
  assert.equal(crossSiteRejection(request({ pathname: "/", origin: "https://evil.example" }), env), null);
  for (const pathname of ["/api/webhooks/github", "/api/internal/build-jobs/process", "/api/uploads", "/api/uploads/abc/deploy"]) {
    assert.equal(crossSiteRejection(request({ pathname, origin: "https://github.com", secFetchSite: "cross-site" }), env), null, pathname);
  }
  assert.ok(crossSiteRejection(request({ pathname: "/api/uploadsevil", origin: "https://evil.example" }), env), "prefix match is by path segment");
  // A preview deployment's own origin is accepted even when DEPLO_BASE_URL points at production.
  assert.equal(crossSiteRejection(request({ requestOrigin: "https://deplo-git-x.vercel.app", origin: "https://deplo-git-x.vercel.app" }), env), null);
});

test("every response gets a strict security header set", () => {
  const headers = securityHeaders({ https: true }, env);
  const csp = headers["Content-Security-Policy"];
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /connect-src 'self' https:\/\/abc\.supabase\.co(;|$)/);
  assert.doesNotMatch(csp, /unsafe-eval/);
  assert.match(csp, /script-src 'self'(;|$)/, "no inline scripts without a nonce");
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
  const withNonce = securityHeaders({ https: true, nonce: "abc123" }, env)["Content-Security-Policy"];
  assert.match(withNonce, /script-src 'self' 'nonce-abc123' 'strict-dynamic'/);
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.match(headers["Strict-Transport-Security"], /max-age=63072000/);

  const local = securityHeaders({ https: false, development: true }, {});
  assert.equal(local["Strict-Transport-Security"], undefined);
  assert.match(local["Content-Security-Policy"], /'unsafe-eval'/);
  assert.doesNotMatch(local["Content-Security-Policy"], /upgrade-insecure-requests/);
});
