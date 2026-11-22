const SHA_PATTERN = /^[a-f0-9]{40}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
// Git branch names: no control characters, spaces, or the characters git forbids in refs.
const BRANCH_PATTERN = /^(?!\/)(?!.*\.\.)[^\x00-\x20~^:?*[\\\x7f]{1,200}(?<!\/)(?<!\.lock)$/;
const MAX_PULL_REQUEST_NUMBER = 999_999_999;

/** Pull request actions that put new code on the PR head and deserve a fresh preview. */
const PREVIEW_ACTIONS = new Set(["opened", "synchronize", "reopened"]);

export type PullRequestPreviewEvent =
  | {
      kind: "deploy";
      repositoryFullName: string;
      /** The branch the PR targets; DEPLO projects are matched on this branch. */
      baseBranch: string;
      headSha: string;
      number: number;
      senderGithubId: number | null;
    }
  | { kind: "ignore"; reason: "action-not-previewed" | "fork-pull-request" }
  | { kind: "invalid" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates a GitHub `pull_request` webhook payload and decides whether it should
 * produce a preview deployment. Pull requests from forks are ignored: their code is
 * untrusted and would otherwise be built with the base repository's installation token.
 */
export function normalizePullRequestEvent(payload: unknown): PullRequestPreviewEvent {
  if (!isRecord(payload)) return { kind: "invalid" };
  const action = payload.action;
  if (typeof action !== "string") return { kind: "invalid" };

  const pullRequest = isRecord(payload.pull_request) ? payload.pull_request : null;
  const repository = isRecord(payload.repository) ? payload.repository : null;
  const number = payload.number ?? pullRequest?.number;
  const base = pullRequest && isRecord(pullRequest.base) ? pullRequest.base : null;
  const head = pullRequest && isRecord(pullRequest.head) ? pullRequest.head : null;
  const headRepository = head && isRecord(head.repo) ? head.repo : null;
  const repositoryFullName = repository?.full_name;

  if (
    typeof repositoryFullName !== "string" || !REPOSITORY_PATTERN.test(repositoryFullName) ||
    typeof number !== "number" || !Number.isSafeInteger(number) || number < 1 || number > MAX_PULL_REQUEST_NUMBER ||
    !base || typeof base.ref !== "string" || !BRANCH_PATTERN.test(base.ref) ||
    !head || typeof head.sha !== "string" || !SHA_PATTERN.test(head.sha)
  ) return { kind: "invalid" };

  if (!PREVIEW_ACTIONS.has(action)) return { kind: "ignore", reason: "action-not-previewed" };

  // A deleted fork has no head repository; treat it like any other fork.
  const headFullName = headRepository?.full_name;
  if (typeof headFullName !== "string" || headFullName.toLowerCase() !== repositoryFullName.toLowerCase()) {
    return { kind: "ignore", reason: "fork-pull-request" };
  }

  const sender = isRecord(payload.sender) ? payload.sender.id : null;
  return {
    kind: "deploy",
    repositoryFullName: repositoryFullName.toLowerCase(),
    baseBranch: base.ref,
    headSha: head.sha,
    number,
    senderGithubId: typeof sender === "number" && Number.isSafeInteger(sender) ? sender : null,
  };
}

/** Cloudflare Pages branch that holds a pull request's preview; never the production branch. */
export function previewBranchFor(pullRequestNumber: number): string {
  if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber < 1 || pullRequestNumber > MAX_PULL_REQUEST_NUMBER) {
    throw new Error("Invalid pull request number.");
  }
  return "pr-" + pullRequestNumber;
}

/**
 * The stable branch alias Cloudflare Pages serves a preview branch at:
 * https://<branch>.<project subdomain>.pages.dev
 */
export function previewUrlFor(productionUrl: string, pullRequestNumber: number): string {
  const match = /^https:\/\/([a-z0-9-]+\.pages\.dev)$/.exec(productionUrl);
  if (!match) throw new Error("Invalid Cloudflare Pages production URL.");
  return "https://" + previewBranchFor(pullRequestNumber) + "." + match[1];
}
