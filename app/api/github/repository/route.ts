import { NextRequest, NextResponse } from "next/server";
import { parsePublicGitHubUrl } from "@/lib/github/parse-repository-url";
import { decryptGitHubToken } from "@/lib/auth/github-token";

type GitHubRepository = {
  full_name: string;
  description: string | null;
  html_url: string;
  default_branch: string;
  stargazers_count: number;
  language: string | null;
};

type GitHubBranch = {
  name: string;
  commit: { sha: string };
};

export async function GET(request: NextRequest) {
  const input = request.nextUrl.searchParams.get("url") ?? "";
  const parsed = parsePublicGitHubUrl(input);

  if (!parsed) {
    return NextResponse.json(
      { error: "Enter a valid GitHub repository URL, such as https://github.com/vercel/next.js." },
      { status: 400 },
    );
  }

  const accessToken = decryptGitHubToken(
    request.cookies.get("deplo_github_token")?.value,
    process.env.GITHUB_TOKEN_ENCRYPTION_KEY ?? "",
  );
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "DEPLO",
    ...(accessToken ? { Authorization: "Bearer " + accessToken } : {}),
  };

  try {
    const base =
      "https://api.github.com/repos/" +
      encodeURIComponent(parsed.owner) +
      "/" +
      encodeURIComponent(parsed.repository);
    const requestOptions = {
      headers,
      signal: AbortSignal.timeout(8_000),
      cache: "no-store" as const,
    };
    const [repositoryResponse, branchesResponse] = await Promise.all([
      fetch(base, requestOptions),
      fetch(base + "/branches?per_page=100", requestOptions),
    ]);

    if (repositoryResponse.status === 404 || branchesResponse.status === 404) {
      return NextResponse.json(
        { error: "Repository not found or your GitHub account does not have access. Sign in with an account that can view this repository." },
        { status: 404 },
      );
    }

    if (
      repositoryResponse.status === 403 ||
      repositoryResponse.status === 429 ||
      branchesResponse.status === 403 ||
      branchesResponse.status === 429
    ) {
      return NextResponse.json(
        { error: "GitHub's API rate limit was reached. Please try again later." },
        { status: 429 },
      );
    }

    if (!repositoryResponse.ok || !branchesResponse.ok) {
      return NextResponse.json(
        { error: "GitHub could not return repository details right now." },
        { status: 502 },
      );
    }

    const repository = (await repositoryResponse.json()) as GitHubRepository;
    const branches = (await branchesResponse.json()) as GitHubBranch[];

    if (!Array.isArray(branches) || typeof repository.full_name !== "string") {
      return NextResponse.json(
        { error: "GitHub returned an unexpected repository response." },
        { status: 502 },
      );
    }

    return NextResponse.json({
      repository: {
        fullName: repository.full_name,
        description: repository.description,
        url: repository.html_url,
        defaultBranch: repository.default_branch,
        stars: repository.stargazers_count,
        language: repository.language,
      },
      branches: branches.map((branch) => ({
        name: branch.name,
        commit: branch.commit.sha,
      })),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return NextResponse.json(
        { error: "GitHub took too long to respond. Please try again." },
        { status: 504 },
      );
    }

    return NextResponse.json(
      { error: "Unable to reach GitHub. Check your connection and try again." },
      { status: 502 },
    );
  }
}
