import { NextRequest, NextResponse } from "next/server";

type GitHubRepository = {
  full_name: string;
  description: string | null;
  html_url: string;
  default_branch: string;
  private: boolean;
  stargazers_count: number;
  language: string | null;
};

type GitHubBranch = {
  name: string;
  commit: { sha: string };
};

function parsePublicGitHubUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (parsed.hostname !== "github.com" || parsed.protocol !== "https:") return null;
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;

  const owner = parts[0];
  const repository = parts[1].replace(/\.git$/i, "");
  if (!/^[a-zA-Z0-9-]{1,39}$/.test(owner) || !/^[a-zA-Z0-9_.-]+$/.test(repository)) return null;
  return { owner, repository };
}

export async function GET(request: NextRequest) {
  const input = request.nextUrl.searchParams.get("url")?.trim() ?? "";
  const parsed = parsePublicGitHubUrl(input);

  if (!parsed) {
    return NextResponse.json(
      { error: "Enter a valid public GitHub repository URL, such as https://github.com/vercel/next.js." },
      { status: 400 },
    );
  }

  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "DEPLO",
  };

  try {
    const base = `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repository)}`;
    const [repositoryResponse, branchesResponse] = await Promise.all([
      fetch(base, { headers, next: { revalidate: 60 } }),
      fetch(`${base}/branches?per_page=100`, { headers, next: { revalidate: 60 } }),
    ]);

    if (repositoryResponse.status === 404) {
      return NextResponse.json(
        { error: "Repository not found. Check the URL and make sure the repository is public." },
        { status: 404 },
      );
    }
    if (repositoryResponse.status === 403 || branchesResponse.status === 403) {
      return NextResponse.json(
        { error: "GitHub's public API rate limit was reached. Please try again later." },
        { status: 429 },
      );
    }
    if (!repositoryResponse.ok || !branchesResponse.ok) {
      return NextResponse.json({ error: "GitHub could not return repository details right now." }, { status: 502 });
    }

    const repository = (await repositoryResponse.json()) as GitHubRepository;
    const branches = (await branchesResponse.json()) as GitHubBranch[];

    return NextResponse.json({
      repository: {
        fullName: repository.full_name,
        description: repository.description,
        url: repository.html_url,
        defaultBranch: repository.default_branch,
        stars: repository.stargazers_count,
        language: repository.language,
      },
      branches: branches.map((branch) => ({ name: branch.name, commit: branch.commit.sha })),
    });
  } catch {
    return NextResponse.json({ error: "Unable to reach GitHub. Check your connection and try again." }, { status: 502 });
  }
}
