import test from "node:test";
import assert from "node:assert/strict";
import { buildPaletteItems, filterPaletteItems, type PaletteContext } from "../../lib/dashboard/palette";
import type { Project } from "../../lib/dashboard/types";

const live: Project = {
  id: "p1", slug: "demo", sourceType: "github", repositoryUrl: "https://github.com/o/demo", name: "demo",
  domain: "https://demo.pages.dev", source: "github.com/o/demo", branch: "main", status: "Healthy", updated: "x", accent: "violet",
};
const zip: Project = { ...live, id: "p2", slug: "zip", sourceType: "zip", name: "zipsite", domain: "Not deployed yet", repositoryUrl: null };

function context(over: Partial<PaletteContext> = {}) {
  const calls: string[] = [];
  const ctx: PaletteContext = {
    activeNav: "home", selected: live, isDeployed: true,
    readiness: { provider: "cloudflare-pages", configured: true, uploadAuthenticationConfigured: true, legacySharedProjectConfigured: false, ready: true, missing: [] },
    projects: [live, zip], signedInUser: { id: 1, login: "octo", name: null, avatarUrl: null }, githubAppStatus: null,
    openNewProject: () => calls.push("new"), goHome: () => calls.push("home"), deploySelectedProject: () => calls.push("deploy"),
    setProjectTab: (tab) => calls.push("tab:" + tab), openProject: (name) => calls.push("open:" + name), signOut: () => calls.push("signout"),
    ...over,
  };
  return { ctx, calls };
}
const ids = (items: { id: string }[]) => items.map((item) => item.id);

test("home lists new project, all projects, each project and the account actions", () => {
  const { ctx } = context();
  assert.deepEqual(ids(buildPaletteItems(ctx)), ["new", "home", "p-p1", "p-p2", "app", "signout"]);
});

test("a project page adds deploy, visit and one entry per tab", () => {
  const { ctx } = context({ activeNav: "project" });
  const found = ids(buildPaletteItems(ctx));
  assert.ok(found.includes("deploy") && found.includes("visit"));
  assert.equal(found.filter((id) => id.startsWith("tab-")).length, 7);
});

test("deploy needs a saved GitHub project and a ready host; visit needs a live site", () => {
  const notReady = buildPaletteItems(context({ activeNav: "project", readiness: null }).ctx);
  assert.equal(ids(notReady).includes("deploy"), false);
  const upload = buildPaletteItems(context({ activeNav: "project", selected: zip, isDeployed: false }).ctx);
  assert.equal(ids(upload).includes("deploy"), false);
  assert.equal(ids(upload).includes("visit"), false);
});

test("signed-out visitors are offered sign-in, not sign-out", () => {
  const found = ids(buildPaletteItems(context({ signedInUser: null }).ctx));
  assert.ok(found.includes("signin"));
  assert.equal(found.includes("signout") || found.includes("app"), false);
});

test("the GitHub App entry reflects whether it is connected", () => {
  const label = (connected: boolean) => buildPaletteItems(context({ githubAppStatus: { configured: true, connected, accountLogin: null, accountType: null } }).ctx).find((item) => item.id === "app")?.label;
  assert.equal(label(true), "Manage GitHub App");
  assert.equal(label(false), "Connect GitHub App");
});

test("items run the matching handler", () => {
  const { ctx, calls } = context({ activeNav: "project" });
  for (const item of buildPaletteItems(ctx)) if (["new", "home", "deploy", "tab-domains", "p-p1", "signout"].includes(item.id)) item.run();
  assert.deepEqual(calls, ["new", "home", "deploy", "tab:domains", "open:demo", "signout"]);
});

test("filtering is case-insensitive over label and hint, and capped at 12", () => {
  const { ctx } = context({ activeNav: "project" });
  const items = buildPaletteItems(ctx);
  assert.deepEqual(ids(filterPaletteItems(items, "  NEW ")), ["new"]);
  assert.ok(filterPaletteItems(items, "demo").length >= 3, "matches project names and hints");
  assert.equal(filterPaletteItems(items, "").length, 12);
  assert.deepEqual(filterPaletteItems(items, "zzzz-nothing"), []);
});
