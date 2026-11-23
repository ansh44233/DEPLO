import { defineConfig, devices } from "@playwright/test";

// Browser tests run against a production build (`next build && next start`) with
// no external services configured, so they check what any visitor sees.
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npm run start",
    url: "http://localhost:3000/api/deploy/status",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
