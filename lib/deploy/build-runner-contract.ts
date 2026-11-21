export type IsolatedBuildLimits = {
  timeoutSeconds: number;
  memoryMiB: number;
  cpuMillicores: number;
  diskMiB: number;
  maxOutputFiles: number;
  maxOutputBytes: number;
  networkPolicy: "deny-by-default";
};

export type IsolatedBuildRequest = {
  jobId: string;
  sourceCommitSha: string;
  framework: "vite" | "react" | "create-react-app" | "nextjs-static";
  packageManager: "npm" | "pnpm" | "yarn" | "bun";
  outputDirectory: "dist" | "build" | "out";
  limits: IsolatedBuildLimits;
};

export type IsolatedBuildResult =
  | { status: "succeeded"; artifactId: string; outputFileCount: number; outputBytes: number }
  | { status: "failed"; errorCode: "dependency_install_failed" | "build_failed" | "timeout" | "resource_limit" | "runner_error" };

export const DEFAULT_ISOLATED_BUILD_LIMITS: IsolatedBuildLimits = {
  timeoutSeconds: 600,
  memoryMiB: 2048,
  cpuMillicores: 2000,
  diskMiB: 4096,
  maxOutputFiles: 5000,
  maxOutputBytes: 100 * 1024 * 1024,
  networkPolicy: "deny-by-default",
};

export type BuildRunnerConfiguration = {
  endpoint: URL;
  token: string;
};

export function readBuildRunnerConfiguration(
  env: Record<string, string | undefined> = process.env,
): BuildRunnerConfiguration | null {
  const rawEndpoint = env.DEPLO_BUILD_RUNNER_URL?.trim();
  const token = env.DEPLO_BUILD_RUNNER_TOKEN?.trim();
  if (!rawEndpoint || !token || token.length < 32) return null;
  try {
    const endpoint = new URL(rawEndpoint);
    if (endpoint.protocol !== "https:" && endpoint.hostname !== "localhost") return null;
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return null;
    return { endpoint, token };
  } catch {
    return null;
  }
}

/** Contract only: this module deliberately does not execute, download, or publish project code. */
export function createIsolatedBuildRequest(input: Omit<IsolatedBuildRequest, "limits">): IsolatedBuildRequest {
  if (!/^[0-9a-f]{40}$/.test(input.sourceCommitSha)) throw new Error("Invalid source commit SHA.");
  if (!/^[0-9a-f-]{36}$/.test(input.jobId)) throw new Error("Invalid build job ID.");
  const outputMatchesFramework =
    (input.framework === "vite" && input.outputDirectory === "dist") ||
    ((input.framework === "react" || input.framework === "create-react-app") && input.outputDirectory === "build") ||
    (input.framework === "nextjs-static" && input.outputDirectory === "out");
  if (!outputMatchesFramework) throw new Error("Build output directory does not match the framework.");
  return { ...input, limits: { ...DEFAULT_ISOLATED_BUILD_LIMITS } };
}
