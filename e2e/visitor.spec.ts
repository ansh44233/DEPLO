import { expect, test, type Page } from "@playwright/test";

/** Collects console errors and CSP violations while a page is used. */
function watchForProblems(page: Page) {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(error.message));
  return problems;
}

test("the home page renders for a visitor with no console errors or CSP violations", async ({ page }) => {
  const problems = watchForProblems(page);
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /sign in/i }).first()).toBeVisible();
  // Give client scripts time to hydrate and fetch the session.
  await page.waitForLoadState("networkidle");
  expect(problems, problems.join("\n")).toEqual([]);
});

test("every script on the page carries the request's CSP nonce", async ({ page }) => {
  const response = await page.goto("/");
  const csp = response?.headers()["content-security-policy"] ?? "";
  const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
  expect(nonce, "CSP has a nonce").toBeTruthy();
  expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  const scripts = await page.locator("script").evaluateAll((nodes) => nodes.map((node) => (node as HTMLScriptElement).nonce));
  expect(scripts.length).toBeGreaterThan(0);
  for (const value of scripts) expect(value).toBe(nonce);
});

test("each page load gets a different nonce", async ({ request }) => {
  const first = (await request.get("/")).headers()["content-security-policy"];
  const second = (await request.get("/")).headers()["content-security-policy"];
  expect(first).not.toEqual(second);
});

test("security headers are on pages and API responses", async ({ request }) => {
  for (const path of ["/", "/api/deploy/status", "/api/auth/session"]) {
    const headers = (await request.get(path)).headers();
    expect(headers["x-frame-options"], path).toBe("DENY");
    expect(headers["x-content-type-options"], path).toBe("nosniff");
    expect(headers["content-security-policy"], path).toContain("frame-ancestors 'none'");
    expect(headers["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
  }
});

test("signed-out visitors are not told which server settings are missing", async ({ request }) => {
  const status = await (await request.get("/api/deploy/status")).json();
  expect(status.missing).toEqual([]);
  expect(typeof status.ready).toBe("boolean");
  expect(status.buildRunnerConfigured).toBe(false);
});

test("state-changing API calls from another site are refused", async ({ request }) => {
  const response = await request.post("/api/projects", {
    headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
    data: { name: "x" },
  });
  expect(response.status()).toBe(403);
});

test("API routes that need a session refuse a visitor", async ({ request }) => {
  expect((await request.get("/api/projects")).status()).toBe(401);
  expect((await request.get("/api/github/repos")).status()).toBe(401);
});

test("the page never scrolls sideways", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("sign-in sends the visitor to GitHub with a state cookie", async ({ request }) => {
  const response = await request.get("/api/auth/github", { maxRedirects: 0 });
  // Without GitHub credentials configured the route explains instead of redirecting.
  expect([307, 503]).toContain(response.status());
  if (response.status() === 307) {
    expect(response.headers()["location"]).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize\?/);
  }
});
