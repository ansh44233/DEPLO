import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/auth/session";
import { createOwnedProject, listOwnedProjects, ProjectStoreError, type ProjectSourceType } from "@/lib/db/supabase-projects";
import { parsePublicGitHubUrl } from "@/lib/github/parse-repository-url";
import { isValidGitHubBranch, isValidDeploymentSlug } from "@/lib/github/deploy-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authenticatedUser(request: NextRequest) {
  return verifySessionToken(
    request.cookies.get("deplo_session")?.value,
    process.env.DEPLO_SESSION_SECRET ?? "",
  );
}

function errorResponse(error: unknown) {
  if (error instanceof ProjectStoreError) {
    return NextResponse.json({ error: error.message }, {
      status: error.status,
      headers: { "Cache-Control": "no-store" },
    });
  }
  return NextResponse.json({ error: "Project storage is temporarily unavailable." }, {
    status: 502,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(request: NextRequest) {
  const user = authenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Sign in with GitHub to view your projects." }, { status: 401 });

  try {
    const projects = await listOwnedProjects(user.id);
    return NextResponse.json({ projects }, {
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const user = authenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Sign in with GitHub to create a project." }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Send project details as JSON." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const slug = typeof body.slug === "string"
    ? body.slug.trim()
    : name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 58);
  const sourceType = body.sourceType;
  if (name.length < 1 || name.length > 60) {
    return NextResponse.json({ error: "Project name must contain 1 to 60 characters." }, { status: 400 });
  }
  if (!isValidDeploymentSlug(slug)) {
    return NextResponse.json({ error: "Project slug must use lowercase letters, numbers, and hyphens." }, { status: 400 });
  }
  if (sourceType !== "github" && sourceType !== "zip" && sourceType !== "html") {
    return NextResponse.json({ error: "Choose github, zip, or html as the project source." }, { status: 400 });
  }

  let repositoryUrl: string | null = null;
  let branch: string | null = null;
  if (sourceType === "github") {
    if (typeof body.repositoryUrl !== "string") {
      return NextResponse.json({ error: "A public GitHub repository URL is required." }, { status: 400 });
    }
    const repository = parsePublicGitHubUrl(body.repositoryUrl);
    if (!repository) return NextResponse.json({ error: "Enter a canonical GitHub repository URL." }, { status: 400 });
    if (typeof body.branch !== "string" || !isValidGitHubBranch(body.branch)) {
      return NextResponse.json({ error: "Enter a valid Git branch name." }, { status: 400 });
    }
    repositoryUrl = "https://github.com/" + repository.owner + "/" + repository.repository;
    branch = body.branch;
  }

  try {
    const project = await createOwnedProject({
      owner_github_id: user.id,
      name,
      slug,
      source_type: sourceType as ProjectSourceType,
      repository_url: repositoryUrl,
      branch,
    });
    return NextResponse.json({ project }, {
      status: 201,
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
