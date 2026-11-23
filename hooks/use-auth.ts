import { useEffect, useState } from "react";
import type { SignedInUser, GitHubAppStatus } from "@/lib/dashboard/types";

export function useAuth({ setNotice }: { setNotice: (message: string) => void }) {
  const [signedInUser, setSignedInUser] = useState<SignedInUser | null>(null);
  const [githubAppStatus, setGithubAppStatus] = useState<GitHubAppStatus | null>(null);
  const [githubAppStatusLoading, setGithubAppStatusLoading] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not check sign-in status.");
        return response.json() as Promise<{ authenticated: boolean; user: SignedInUser | null }>;
      })
      .then((data) => { if (!cancelled) setSignedInUser(data.authenticated ? data.user : null); })
      .catch(() => { if (!cancelled) setSignedInUser(null); })
      .finally(() => { if (!cancelled) setAuthLoading(false); });
    const authResult = new URLSearchParams(window.location.search).get("auth");
    if (authResult === "success") setNotice("Signed in with GitHub. Your saved projects are loading.");
    if (authResult === "error") setNotice("GitHub sign-in could not be completed. Check OAuth configuration and try again.");
    const appResult = new URLSearchParams(window.location.search).get("github_app");
    if (appResult === "connected") setNotice("GitHub App connected. Private repository push deployments are enabled for repositories selected in the installation.");
    if (appResult === "error") setNotice("GitHub App installation could not be linked. Check the app setup URL, private key, and database migration.");
    if (appResult === "cancelled") setNotice("GitHub App installation was cancelled.");
    if (appResult === "signin_required") setNotice("Sign in with GitHub before installing the DEPLO GitHub App.");
    if (authResult || appResult) window.history.replaceState({}, "", window.location.pathname);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!signedInUser) {
      setGithubAppStatus(null);
      setGithubAppStatusLoading(false);
      return;
    }
    let cancelled = false;
    setGithubAppStatusLoading(true);
    fetch("/api/auth/github/app-status", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as GitHubAppStatus & { error?: string };
        if (!response.ok) throw new Error(data.error || "Could not load GitHub App status.");
        return data;
      })
      .then((data) => { if (!cancelled) setGithubAppStatus(data); })
      .catch(() => { if (!cancelled) setGithubAppStatus(null); })
      .finally(() => { if (!cancelled) setGithubAppStatusLoading(false); });
    return () => { cancelled = true; };
  }, [signedInUser]);

  return {
    signedInUser,
    setSignedInUser,
    githubAppStatus,
    setGithubAppStatus,
    githubAppStatusLoading,
    authLoading,
  };
}
