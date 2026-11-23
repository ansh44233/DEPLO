import { useEffect, useState } from "react";
import type { RepositoryInfo, SignedInUser, RepoSummary, Modal } from "@/lib/dashboard/types";

export function useRepoImport({ signedInUser, modal }: { signedInUser: SignedInUser | null; modal: Modal }) {
  const [repoUrl, setRepoUrl] = useState("");
  const [repoInfo, setRepoInfo] = useState<RepositoryInfo | null>(null);
  const [repoBranch, setRepoBranch] = useState("");
  const [repoLoading, setRepoLoading] = useState(false);
  const [repoError, setRepoError] = useState("");

  const [myRepos, setMyRepos] = useState<RepoSummary[] | null>(null);
  const [myReposLoading, setMyReposLoading] = useState(false);
  const [myReposError, setMyReposError] = useState("");
  const [repoQuery, setRepoQuery] = useState("");
  const [showUrlImport, setShowUrlImport] = useState(false);
  const [importEnvText, setImportEnvText] = useState("");

  useEffect(() => {
    if (!signedInUser || (modal !== "github" && modal !== "repo") || myRepos !== null || myReposLoading) return;
    setMyReposLoading(true); setMyReposError("");
    fetch("/api/github/repos", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({})) as { repositories?: RepoSummary[]; error?: string };
        if (!response.ok) throw new Error(data.error || "Repositories could not be loaded.");
        setMyRepos(data.repositories ?? []);
      })
      .catch((error: unknown) => { setMyReposError(error instanceof Error ? error.message : "Repositories could not be loaded."); setMyRepos([]); })
      .finally(() => setMyReposLoading(false));
  }, [signedInUser, modal, myRepos, myReposLoading]);

  async function inspectRepository(url: string = repoUrl) {
    setRepoLoading(true); setRepoError(""); setRepoInfo(null);
    try {
      const response = await fetch("/api/github/repository?url=" + encodeURIComponent(url));
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not inspect this repository.");
      setRepoInfo({ ...data.repository, branches: data.branches });
      setRepoBranch(data.repository.defaultBranch);
    } catch (error) {
      setRepoError(error instanceof Error ? error.message : "Something went wrong.");
    } finally { setRepoLoading(false); }
  }

  return {
    repoUrl,
    setRepoUrl,
    repoInfo,
    setRepoInfo,
    repoBranch,
    setRepoBranch,
    repoLoading,
    repoError,
    setRepoError,
    myRepos,
    myReposLoading,
    myReposError,
    repoQuery,
    setRepoQuery,
    showUrlImport,
    setShowUrlImport,
    importEnvText,
    setImportEnvText,
    inspectRepository,
  };
}
