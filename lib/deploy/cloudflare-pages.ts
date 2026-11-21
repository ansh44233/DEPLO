import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";

export type CloudflarePagesConfig = {
  accountId: string;
  apiToken: string;
  projectName: string;
};

export function readCloudflarePagesConfig(
  env: NodeJS.ProcessEnv = process.env,
): CloudflarePagesConfig | null {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? "";
  const apiToken = env.CLOUDFLARE_API_TOKEN?.trim() ?? "";
  const projectName = env.CLOUDFLARE_PAGES_PROJECT_NAME?.trim() ?? "";

  if (!accountId || !apiToken || !isValidPagesProjectName(projectName)) return null;
  return { accountId, apiToken, projectName };
}

export function isValidPagesProjectName(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(value);
}

export function isValidPagesBranch(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(value);
}

export function buildPagesDeployArgs(
  directory: string,
  projectName: string,
  branch: string,
): string[] {
  if (!isValidPagesProjectName(projectName)) throw new Error("Invalid Cloudflare Pages project name.");
  if (!isValidPagesBranch(branch)) throw new Error("Invalid Cloudflare Pages branch name.");
  return [
    "pages",
    "deploy",
    resolve(directory),
    "--project-name",
    projectName,
    "--branch",
    branch,
    "--commit-dirty=true",
  ];
}

export async function deployStaticDirectory(
  directory: string,
  branch: string,
  config: CloudflarePagesConfig,
): Promise<{ url: string; output: string }> {
  const args = buildPagesDeployArgs(directory, config.projectName, branch);
  const cliPath = resolve(process.cwd(), "node_modules", "wrangler", "bin", "wrangler.js");
  await access(cliPath);
  await access(resolve(directory));

  const output = await new Promise<string>((resolveOutput, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CLOUDFLARE_ACCOUNT_ID: config.accountId,
        CLOUDFLARE_API_TOKEN: config.apiToken,
        CI: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let combined = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, 180_000);

    const append = (chunk: Buffer) => {
      combined += chunk.toString("utf8");
      if (combined.length > 256_000) combined = combined.slice(-256_000);
    };

    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error("Cloudflare Pages deployment timed out after 3 minutes."));
        return;
      }
      if (code !== 0) {
        reject(new Error(`Cloudflare Pages deployment failed: ${combined.slice(-4_000)}`));
        return;
      }
      resolveOutput(combined);
    });
  });

  const url = output.match(/https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.pages\.dev(?:\/[a-z0-9._~!$&'()*+,;=:@%/-]*)?/i)?.[0];
  if (!url) throw new Error("Cloudflare completed the command but did not return a Pages deployment URL.");
  return { url, output: output.slice(-4_000) };
}
