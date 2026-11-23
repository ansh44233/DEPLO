import type { BuildJobFramework, BuildJobPackageManager, Project, ProjectTab } from "./types";

export const BUILD_FRAMEWORKS: { value: BuildJobFramework; label: string; output: string }[] = [
  { value: "vite", label: "Vite", output: "dist" },
  { value: "react", label: "React", output: "build" },
  { value: "create-react-app", label: "Create React App", output: "build" },
  { value: "nextjs-static", label: "Next.js (static export)", output: "out" },
];
export const BUILD_PACKAGE_MANAGERS: BuildJobPackageManager[] = ["npm", "pnpm", "yarn", "bun"];

export const initialProjects: Project[] = [];

export const PROJECT_TABS: { id: ProjectTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "deployments", label: "Deployments" },
  { id: "builds", label: "Builds" },
  { id: "environment", label: "Environment" },
  { id: "domains", label: "Domains" },
  { id: "activity", label: "Activity" },
  { id: "settings", label: "Settings" },
];
