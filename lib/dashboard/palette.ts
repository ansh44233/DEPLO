import { PROJECT_TABS } from "./constants";
import { hostOf } from "./format";
import type { DeploymentReadiness, GitHubAppStatus, Project, ProjectTab, SignedInUser } from "./types";

export type PaletteItem = { id: string; label: string; hint?: string; run: () => void };

export type PaletteContext = {
  activeNav: "home" | "project";
  selected: Project;
  isDeployed: boolean;
  readiness: DeploymentReadiness | null;
  projects: Project[];
  signedInUser: SignedInUser | null;
  githubAppStatus: GitHubAppStatus | null;
  openNewProject: () => void;
  goHome: () => void;
  deploySelectedProject: () => void;
  setProjectTab: (tab: ProjectTab) => void;
  openProject: (name: string) => void;
  signOut: () => void;
};

/** The actions listed in the Ctrl+K command menu for the current dashboard state. */
export function buildPaletteItems(context: PaletteContext): PaletteItem[] {
  const { activeNav, selected, isDeployed, readiness, projects, signedInUser, githubAppStatus } = context;
  return [
    { id: "new", label: "New project", hint: "Import, ZIP or HTML", run: context.openNewProject },
    { id: "home", label: "All projects", run: context.goHome },
    ...(activeNav === "project" && selected.id && selected.sourceType === "github" && readiness?.ready ? [{ id: "deploy", label: "Deploy " + selected.name, hint: "Build and publish", run: () => context.deploySelectedProject() }] : []),
    ...(activeNav === "project" && isDeployed ? [{ id: "visit", label: "Visit " + hostOf(selected.domain), run: () => { window.open(selected.domain, "_blank", "noopener"); } }] : []),
    ...(activeNav === "project" ? PROJECT_TABS.map((tab) => ({ id: "tab-" + tab.id, label: "Go to " + tab.label, hint: selected.name, run: () => context.setProjectTab(tab.id) })) : []),
    ...projects.map((project) => ({ id: "p-" + (project.id ?? project.name), label: project.name, hint: /^https?:/.test(project.domain) ? hostOf(project.domain) : "Project", run: () => context.openProject(project.name) })),
    ...(signedInUser
      ? [{ id: "app", label: githubAppStatus?.connected ? "Manage GitHub App" : "Connect GitHub App", hint: "Private repos and auto-deploy", run: () => { window.location.href = "/api/auth/github/install"; } },
         { id: "signout", label: "Sign out", run: context.signOut }]
      : [{ id: "signin", label: "Sign in with GitHub", run: () => { window.location.href = "/api/auth/github"; } }]),
  ];
}

/** Case-insensitive match on label and hint; the menu shows at most 12 results. */
export function filterPaletteItems(items: PaletteItem[], query: string): PaletteItem[] {
  const needle = query.trim().toLowerCase();
  return items.filter((item) => (item.label + " " + (item.hint ?? "")).toLowerCase().includes(needle)).slice(0, 12);
}
