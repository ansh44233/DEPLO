"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { hasZipSignature, validateUploadSelection } from "@/lib/uploads/validate-upload";
import {
  ArrowLeft, ExternalLink, FileArchive, FileCode2, GitBranch, Github, Loader2, Plus, RefreshCw,
  Rocket, Search, UploadCloud, X,
} from "lucide-react";

type RepositoryInfo = {
  fullName: string; description: string | null; url: string; defaultBranch: string;
  stars: number; language: string | null; branches: { name: string; commit: string }[];
};

type DeploymentReadiness = {
  provider: "cloudflare-pages";
  configured: boolean;
  uploadAuthenticationConfigured: boolean;
  legacySharedProjectConfigured: boolean;
  ready: boolean;
  missing: string[];
  maxUploadBytes?: number | null;
};

type CloudflareDeploymentLog = { timestamp: string | null; line: string };
type CustomDomain = { id: string; name: string; status: string; validation: { method: "http" | "txt" | null; status: string; error: string | null; txtName: string | null; txtValue: string | null }; verification: { status: string; error: string | null }; createdAt: string | null };
type WebhookDelivery = { delivery_id: string; repository_full_name: string; branch: string; commit_sha: string; status: "received" | "processing" | "deployed" | "ignored" | "failed"; received_at: string; processed_at: string | null; attempt_count: number; available_at: string; last_error_code: string | null; };
type RecoveryAttempt = { id: string; job_id: string; recovery_key: string; journal_sequence: number; observed_state: string; disposition: string; actions: string[]; next_action_index: number; status: "pending" | "reconciling" | "completed" | "blocked"; claimed_at: string | null; error_code: string | null; created_at: string; updated_at: string; };

type CloudflareDeployment = {
  id: string;
  url: string;
  environment: string;
  createdAt: string | null;
  branch: string | null;
  commitMessage: string | null;
  commitSha: string | null;
  status: "success" | "failure" | "building" | "unknown";
};

type BuildJobFramework = "vite" | "react" | "create-react-app" | "nextjs-static";
type BuildJobPackageManager = "npm" | "pnpm" | "yarn" | "bun";
type BuildJob = {
  id: string; source_commit_sha: string; framework: BuildJobFramework; package_manager: BuildJobPackageManager;
  output_directory: string; status: "pending" | "processing" | "succeeded" | "failed" | "cancelled";
  attempt_count: number; max_attempts: number; available_at: string; error_code: string | null;
  created_at: string; updated_at: string; runner_status?: "queued" | "running" | "succeeded" | null;
  artifact_id?: string | null; artifact_file_count?: number | null; artifact_bytes?: number | null;
};
const BUILD_FRAMEWORKS: { value: BuildJobFramework; label: string; output: string }[] = [
  { value: "vite", label: "Vite", output: "dist" },
  { value: "react", label: "React", output: "build" },
  { value: "create-react-app", label: "Create React App", output: "build" },
  { value: "nextjs-static", label: "Next.js (static export)", output: "out" },
];
const BUILD_PACKAGE_MANAGERS: BuildJobPackageManager[] = ["npm", "pnpm", "yarn", "bun"];

function describeBuildJob(job: BuildJob): { label: string; tone: "healthy" | "failed" | "building" | "queued" } {
  if (job.status === "succeeded") return { label: "Deployed", tone: "healthy" };
  if (job.status === "failed") return { label: "Failed", tone: "failed" };
  if (job.status === "cancelled") return { label: "Cancelled", tone: "failed" };
  if (job.artifact_id) return { label: "Publishing", tone: "building" };
  if (job.runner_status === "running") return { label: "Building", tone: "building" };
  if (job.runner_status === "queued") return { label: "Queued on runner", tone: "queued" };
  if (job.status === "processing") return { label: "Submitting", tone: "building" };
  return { label: job.attempt_count > 0 ? "Retry queued" : "Queued", tone: "queued" };
}

type SignedInUser = { id: number; login: string; name: string | null; avatarUrl: string | null };
type GitHubAppStatus = { configured: boolean; connected: boolean; accountLogin: string | null; accountType: "User" | "Organization" | null };
type AccountProject = {
  id: string; name: string; slug: string; source_type: "github" | "zip" | "html";
  repository_url: string | null; branch: string | null; deployment_url: string | null;
  created_at: string; updated_at: string;
};

type Project = {
  id?: string;
  slug?: string;
  sourceType?: AccountProject["source_type"];
  repositoryUrl?: string | null;
  name: string;
  domain: string;
  source: string;
  branch: string;
  status: "Healthy" | "Building" | "Failed" | "Connected";
  updated: string;
  accent: string;
};

const initialProjects: Project[] = [];



type ProjectTab = "overview" | "deployments" | "builds" | "domains" | "activity" | "settings";
const PROJECT_TABS: { id: ProjectTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "deployments", label: "Deployments" },
  { id: "builds", label: "Builds" },
  { id: "domains", label: "Domains" },
  { id: "activity", label: "Activity" },
  { id: "settings", label: "Settings" },
];

function timeAgo(value: string | number | Date): string {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "—";
  const seconds = Math.round((Date.now() - time) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes + "m ago";
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours + "h ago";
  const days = Math.round(hours / 24);
  if (days < 30) return days + "d ago";
  return new Date(time).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

export default function Home() {
  const [activeProject, setActiveProject] = useState("");
  const [activeNav, setActiveNav] = useState<"home" | "project">("home");
  const [projectTab, setProjectTab] = useState<ProjectTab>("overview");
  const [modal, setModal] = useState<"github" | "repo" | "upload" | "html" | null>(null);
  const [repoUrl, setRepoUrl] = useState("");
  const [repoInfo, setRepoInfo] = useState<RepositoryInfo | null>(null);
  const [repoBranch, setRepoBranch] = useState("");
  const [repoLoading, setRepoLoading] = useState(false);
  const [repoError, setRepoError] = useState("");
  const [search, setSearch] = useState("");
  const [projects, setProjects] = useState(initialProjects);
  const [notice, setNotice] = useState("");
  const [fileName, setFileName] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [readiness, setReadiness] = useState<DeploymentReadiness | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(true);
  const [readinessError, setReadinessError] = useState("");
  const [cloudflareDeployments, setCloudflareDeployments] = useState<CloudflareDeployment[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [webhookDeliveries, setWebhookDeliveries] = useState<WebhookDelivery[]>([]);
  const [webhookLoading, setWebhookLoading] = useState(false);
  const [webhookError, setWebhookError] = useState("");
  const [buildJobs, setBuildJobs] = useState<BuildJob[]>([]);
  const [buildJobsLoading, setBuildJobsLoading] = useState(false);
  const [buildJobsError, setBuildJobsError] = useState("");
  const [buildFramework, setBuildFramework] = useState<BuildJobFramework>("vite");
  const [buildPackageManager, setBuildPackageManager] = useState<BuildJobPackageManager>("npm");
  const [buildCommitSha, setBuildCommitSha] = useState("");
  const [buildCommitLoading, setBuildCommitLoading] = useState(false);
  const [buildQueueing, setBuildQueueing] = useState(false);
  const [buildCancelling, setBuildCancelling] = useState<string | null>(null);
  const [recoveryAttempts, setRecoveryAttempts] = useState<RecoveryAttempt[]>([]);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");
  const [signedInUser, setSignedInUser] = useState<SignedInUser | null>(null);
  const [githubAppStatus, setGithubAppStatus] = useState<GitHubAppStatus | null>(null);
  const [githubAppStatusLoading, setGithubAppStatusLoading] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState("");
  const [projectSaving, setProjectSaving] = useState(false);
  const [projectDeploying, setProjectDeploying] = useState(false);
  const [deployStartedAt, setDeployStartedAt] = useState<number | null>(null);
  const [deployElapsed, setDeployElapsed] = useState(0);
  const [deployResult, setDeployResult] = useState<{ ok: boolean; message: string; log: string | null } | null>(null);
  const [buildLogOpen, setBuildLogOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [communityHidden, setCommunityHidden] = useState(true);
  const [projectDeleting, setProjectDeleting] = useState(false);
  const [projectNameInput, setProjectNameInput] = useState("");
  const [projectRenaming, setProjectRenaming] = useState(false);
  const [rollbackDeploymentId, setRollbackDeploymentId] = useState<string | null>(null);
  const [logsDeploymentId, setLogsDeploymentId] = useState<string | null>(null);
  const [deploymentLogs, setDeploymentLogs] = useState<CloudflareDeploymentLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState("");
  const [customDomains, setCustomDomains] = useState<CustomDomain[]>([]);
  const [domainsLoading, setDomainsLoading] = useState(false);
  const [domainsError, setDomainsError] = useState("");
  const [domainInput, setDomainInput] = useState("");
  const [domainSaving, setDomainSaving] = useState(false);
  const [domainDeleting, setDomainDeleting] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/deploy/status", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load provider status.");
        return response.json() as Promise<DeploymentReadiness>;
      })
      .then((data) => { if (!cancelled) setReadiness(data); })
      .catch(() => { if (!cancelled) setReadinessError("Provider status is unavailable."); })
      .finally(() => { if (!cancelled) setReadinessLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const refreshDeploymentHistory = useCallback(async (projectId?: string, authenticated = false) => {
    if (!authenticated || !projectId) {
      setCloudflareDeployments([]);
      setHistoryError("");
      setHistoryLoading(false);
      return;
    }
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const response = await fetch("/api/deploy/history?projectId=" + encodeURIComponent(projectId), { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Deployment history is unavailable.");
      setCloudflareDeployments((data as { deployments: CloudflareDeployment[] }).deployments);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : "Deployment history is unavailable.");
      setCloudflareDeployments([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!signedInUser) return;
    let cancelled = false;
    setProjects([]);
    setProjectsLoading(true);
    setProjectsError("");
    fetch("/api/projects", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load your saved projects.");
        return data as { projects: AccountProject[] };
      })
      .then((data) => {
        if (cancelled) return;
        const owned = data.projects.map((project): Project => ({
          id: project.id,
          slug: project.slug,
          sourceType: project.source_type,
          repositoryUrl: project.repository_url,
          name: project.name,
          domain: project.deployment_url || "Not deployed yet",
          source: project.source_type === "github"
            ? project.repository_url?.replace("https://", "") || "GitHub repository"
            : project.source_type === "zip" ? "ZIP upload" : "index.html",
          branch: project.branch || "—",
          status: project.deployment_url ? "Healthy" : "Connected",
          updated: timeAgo(project.updated_at),
          accent: "violet",
        }));
        setProjects(owned);
        setActiveProject(owned[0]?.name ?? "");
      })
      .catch((error) => {
        if (!cancelled) setProjectsError(error instanceof Error ? error.message : "Could not load your saved projects.");
      })
      .finally(() => { if (!cancelled) setProjectsLoading(false); });
    return () => { cancelled = true; };
  }, [signedInUser]);

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

  async function signOut() {
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Sign-out failed.");
      setSignedInUser(null);
      setGithubAppStatus(null);
      setProjects(initialProjects);
      setCloudflareDeployments([]);
      setActiveProject("frontend");
      setProjectsError("");
      setNotice("You have signed out of DEPLO.");
    } catch {
      setNotice("Could not sign out. Please try again.");
    }
  }



  const selected = projects.find((project) => project.name === activeProject) ?? projects[0] ?? {
    name: "No project selected", domain: "—", source: "—", branch: "—",
    status: "Connected" as const, updated: "—", accent: "violet",
  };
  useEffect(() => { setProjectNameInput(selected.name); }, [selected.id, selected.name]);
  useEffect(() => {
    void refreshDeploymentHistory(selected.id, Boolean(signedInUser));
  }, [refreshDeploymentHistory, selected.id, signedInUser]);

  const refreshCustomDomains = useCallback(async (projectId?: string, authenticated = false) => {
    if (!authenticated || !projectId) {
      setCustomDomains([]);
      setDomainsError("");
      setDomainsLoading(false);
      return;
    }
    setDomainsLoading(true);
    setDomainsError("");
    try {
      const response = await fetch("/api/projects/" + encodeURIComponent(projectId) + "/domains", { cache: "no-store" });
      const data = await response.json() as { domains?: CustomDomain[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Custom domains could not be loaded.");
      setCustomDomains(Array.isArray(data.domains) ? data.domains : []);
    } catch (error) {
      setDomainsError(error instanceof Error ? error.message : "Custom domains could not be loaded.");
      setCustomDomains([]);
    } finally {
      setDomainsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshCustomDomains(selected.id, Boolean(signedInUser));
  }, [refreshCustomDomains, selected.id, signedInUser]);

  async function addCustomDomain() {
    if (!selected.id || !signedInUser || !domainInput.trim() || domainSaving) return;
    setDomainSaving(true);
    setDomainsError("");
    try {
      const response = await fetch("/api/projects/" + encodeURIComponent(selected.id) + "/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: domainInput }),
      });
      const data = await response.json() as { domain?: CustomDomain; error?: string };
      if (!response.ok) throw new Error(data.error || "Domain could not be added.");
      setDomainInput("");
      await refreshCustomDomains(selected.id, true);
      setNotice("Domain added to Cloudflare Pages. Follow the DNS instructions and refresh its status.");
    } catch (error) {
      setDomainsError(error instanceof Error ? error.message : "Domain could not be added.");
    } finally {
      setDomainSaving(false);
    }
  }

  async function removeCustomDomain(domain: string) {
    if (!selected.id || !signedInUser || domainDeleting) return;
    if (!window.confirm("Remove " + domain + " from this Pages project? Its DNS record may also need to be removed at your DNS provider.")) return;
    setDomainDeleting(domain);
    setDomainsError("");
    try {
      const response = await fetch("/api/projects/" + encodeURIComponent(selected.id) + "/domains?domain=" + encodeURIComponent(domain), { method: "DELETE" });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Domain could not be removed.");
      await refreshCustomDomains(selected.id, true);
      setNotice(domain + " was removed from the Pages project.");
    } catch (error) {
      setDomainsError(error instanceof Error ? error.message : "Domain could not be removed.");
    } finally {
      setDomainDeleting(null);
    }
  }


  const refreshWebhookDeliveries = useCallback(async (projectId?: string, authenticated = false) => {
    if (!authenticated || !projectId) { setWebhookDeliveries([]); setWebhookError(""); setWebhookLoading(false); return; }
    setWebhookLoading(true); setWebhookError("");
    try {
      const response = await fetch("/api/projects/" + encodeURIComponent(projectId) + "/webhook-deliveries", { cache: "no-store" });
      const data = await response.json() as { deliveries?: WebhookDelivery[]; error?: string };
      if (!response.ok) throw new Error(data.error || "GitHub delivery activity is unavailable.");
      setWebhookDeliveries(Array.isArray(data.deliveries) ? data.deliveries : []);
    } catch (error) {
      setWebhookError(error instanceof Error ? error.message : "GitHub delivery activity is unavailable."); setWebhookDeliveries([]);
    } finally { setWebhookLoading(false); }
  }, []);

  useEffect(() => {
    void refreshWebhookDeliveries(selected.id, Boolean(signedInUser) && selected.sourceType === "github");
  }, [refreshWebhookDeliveries, selected.id, selected.sourceType, signedInUser]);

  const refreshBuildJobs = useCallback(async (projectId?: string, authenticated = false, quiet = false) => {
    if (!authenticated || !projectId) { setBuildJobs([]); setBuildJobsError(""); setBuildJobsLoading(false); return; }
    if (!quiet) setBuildJobsLoading(true);
    setBuildJobsError("");
    try {
      const response = await fetch("/api/projects/" + encodeURIComponent(projectId) + "/build-jobs", { cache: "no-store" });
      const data = await response.json() as { jobs?: BuildJob[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Build jobs are unavailable.");
      setBuildJobs(Array.isArray(data.jobs) ? data.jobs : []);
    } catch (error) {
      setBuildJobsError(error instanceof Error ? error.message : "Build jobs are unavailable.");
      if (!quiet) setBuildJobs([]);
    } finally { if (!quiet) setBuildJobsLoading(false); }
  }, []);

  const buildJobsEnabled = Boolean(signedInUser) && selected.sourceType === "github";
  useEffect(() => {
    setBuildCommitSha("");
    void refreshBuildJobs(selected.id, buildJobsEnabled);
  }, [refreshBuildJobs, selected.id, buildJobsEnabled]);

  const hasActiveBuildJob = buildJobs.some((job) => job.status === "pending" || job.status === "processing");
  useEffect(() => {
    if (!hasActiveBuildJob || !buildJobsEnabled) return;
    const timer = window.setInterval(() => { void refreshBuildJobs(selected.id, true, true); }, 10_000);
    return () => window.clearInterval(timer);
  }, [hasActiveBuildJob, buildJobsEnabled, refreshBuildJobs, selected.id]);

  async function fetchLatestBranchCommit() {
    if (!selected.repositoryUrl || !selected.branch || buildCommitLoading) return;
    setBuildCommitLoading(true);
    setBuildJobsError("");
    try {
      const response = await fetch("/api/github/repository?url=" + encodeURIComponent(selected.repositoryUrl), { cache: "no-store" });
      const data = await response.json() as Partial<RepositoryInfo> & { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not read the latest branch commit.");
      const commit = data.branches?.find((branch) => branch.name === selected.branch)?.commit;
      if (!commit || !/^[a-f0-9]{40}$/.test(commit)) throw new Error("The saved branch " + selected.branch + " was not found in the repository.");
      setBuildCommitSha(commit);
    } catch (error) {
      setBuildJobsError(error instanceof Error ? error.message : "Could not read the latest branch commit.");
    } finally { setBuildCommitLoading(false); }
  }

  async function queueBuildJob() {
    const sha = buildCommitSha.trim().toLowerCase();
    if (!selected.id || !buildJobsEnabled || buildQueueing || !/^[a-f0-9]{40}$/.test(sha)) return;
    setBuildQueueing(true);
    setBuildJobsError("");
    try {
      const response = await fetch("/api/projects/" + encodeURIComponent(selected.id) + "/build-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceCommitSha: sha, framework: buildFramework, packageManager: buildPackageManager }),
      });
      const data = await response.json() as { job?: BuildJob; error?: string };
      if (!response.ok || !data.job) throw new Error(data.error || "The build could not be queued.");
      setBuildJobs((current) => [data.job as BuildJob, ...current.filter((job) => job.id !== data.job?.id)]);
      setNotice("Build queued for commit " + sha.slice(0, 7) + ". It runs when the build worker and isolated runner pick it up.");
    } catch (error) {
      setBuildJobsError(error instanceof Error ? error.message : "The build could not be queued.");
    } finally { setBuildQueueing(false); }
  }

  async function cancelBuildJob(jobId: string) {
    if (!selected.id || buildCancelling) return;
    setBuildCancelling(jobId);
    setBuildJobsError("");
    try {
      const response = await fetch("/api/projects/" + encodeURIComponent(selected.id) + "/build-jobs/" + encodeURIComponent(jobId), { method: "DELETE" });
      const data = await response.json() as { job?: BuildJob; error?: string };
      if (!response.ok || !data.job) throw new Error(data.error || "The build job could not be cancelled.");
      setBuildJobs((current) => current.map((job) => job.id === jobId ? { ...job, ...data.job } : job));
    } catch (error) {
      setBuildJobsError(error instanceof Error ? error.message : "The build job could not be cancelled.");
    } finally { setBuildCancelling(null); }
  }

  const refreshRecoveryAttempts = useCallback(async (projectId?: string, authenticated = false) => {
    if (!authenticated || !projectId) {
      setRecoveryAttempts([]);
      setRecoveryError("");
      setRecoveryLoading(false);
      return;
    }
    setRecoveryLoading(true);
    setRecoveryError("");
    try {
      const response = await fetch("/api/projects/" + encodeURIComponent(projectId) + "/recovery-attempts", { cache: "no-store" });
      const data = await response.json() as { attempts?: RecoveryAttempt[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Recovery history is unavailable.");
      setRecoveryAttempts(Array.isArray(data.attempts) ? data.attempts : []);
    } catch (error) {
      setRecoveryError(error instanceof Error ? error.message : "Recovery history is unavailable.");
      setRecoveryAttempts([]);
    } finally {
      setRecoveryLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshRecoveryAttempts(selected.id, Boolean(signedInUser));
  }, [refreshRecoveryAttempts, selected.id, signedInUser]);

  async function deploySelectedProject() {
    if (!selected.id || selected.sourceType !== "github" || !signedInUser || projectDeploying) return;
    setProjectDeploying(true);
    setDeployStartedAt(Date.now());
    setDeployResult(null);
    setNotice("");
    try {
      const response = await fetch("/api/projects/" + encodeURIComponent(selected.id) + "/deploy", { method: "POST" });
      const data = await response.json().catch(() => ({})) as { url?: string; error?: string; buildLog?: string; build?: { framework: string; outputDirectory: string; log: string } | null };
      if (!response.ok) {
        const message = data.error || (response.status === 504 ? "The deployment took longer than the server allows. Try again; a second build is usually faster." : "Deployment failed with HTTP " + response.status + ".");
        setDeployResult({ ok: false, message, log: data.buildLog ?? null });
        throw new Error(message);
      }
      setProjects((current) => current.map((project) => project.id === selected.id
        ? { ...project, domain: data.url || project.domain, status: "Healthy", updated: "just now" }
        : project));
      setDeployResult({ ok: true, message: data.build ? "Built with " + data.build.framework + " and published." : "Published.", log: data.build?.log ?? null });
      setNotice(data.url ? "Deployed: " + data.url : "Deployment completed.");
      await refreshDeploymentHistory(selected.id, true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Project deployment failed.");
    } finally {
      setProjectDeploying(false);
      setDeployStartedAt(null);
    }
  }




  async function renameSelectedProject() {
    if (!selected.id || !signedInUser || projectRenaming) return;
    const name = projectNameInput.trim();
    if (!name || name.length > 60) { setNotice("Project name must contain 1 to 60 characters."); return; }
    if (name === selected.name) return;
    setProjectRenaming(true); setNotice("");
    try {
      const response = await fetch("/api/projects/" + encodeURIComponent(selected.id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      const data = await response.json() as { project?: AccountProject; error?: string };
      if (!response.ok || !data.project) throw new Error(data.error || "Project name could not be updated.");
      setProjects(current => current.map(project => project.id === selected.id ? { ...project, name: data.project!.name, updated: "just now" } : project));
      setActiveProject(data.project.name);
      setNotice("Project name updated. Its deployment URL and repository settings are unchanged.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Project name could not be updated."); }
    finally { setProjectRenaming(false); }
  }

  async function deleteSelectedProject() {
    if (!selected.id || !signedInUser || projectDeleting) return;
    const confirmed = window.confirm(
      "Permanently delete " + selected.name + " and its hosted Cloudflare Pages site, including deployment history? This cannot be undone."
    );
    if (!confirmed) return;

    setProjectDeleting(true);
    setNotice("");
    try {
      const response = await fetch("/api/projects/" + encodeURIComponent(selected.id), { method: "DELETE" });
      const data = await response.json() as { deleted?: boolean; hostedSiteRemoved?: boolean; error?: string };
      if (!response.ok || !data.deleted) throw new Error(data.error || "Project deletion failed.");
      const remaining = projects.filter((project) => project.id !== selected.id);
      setProjects(remaining);
      setActiveProject(remaining[0]?.name ?? "");
      setCloudflareDeployments([]);
      setLogsDeploymentId(null);
      setDeploymentLogs([]);
      setNotice(data.hostedSiteRemoved
        ? "Project and its Cloudflare Pages site were deleted."
        : "Project deleted. It did not have a hosted Cloudflare Pages site.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Project deletion failed.");
    } finally {
      setProjectDeleting(false);
    }
  }

  async function openDeploymentLogs(deploymentId: string) {
    if (!selected.id || !signedInUser) return;
    setLogsDeploymentId(deploymentId);
    setDeploymentLogs([]);
    setLogsError("");
    setLogsLoading(true);
    try {
      const response = await fetch(
        "/api/projects/" + encodeURIComponent(selected.id) + "/deployments/" + encodeURIComponent(deploymentId) + "/logs",
        { cache: "no-store" },
      );
      const data = await response.json() as { logs?: CloudflareDeploymentLog[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Deployment logs could not be loaded.");
      setDeploymentLogs(Array.isArray(data.logs) ? data.logs : []);
    } catch (error) {
      setLogsError(error instanceof Error ? error.message : "Deployment logs could not be loaded.");
    } finally {
      setLogsLoading(false);
    }
  }

  async function rollbackSelectedDeployment(deploymentId: string) {
    if (!selected.id || !signedInUser || rollbackDeploymentId) return;
    const confirmed = window.confirm("Roll back " + selected.name + " to this previous successful production deployment? This changes the live production version.");
    if (!confirmed) return;

    setRollbackDeploymentId(deploymentId);
    setNotice("");
    try {
      const response = await fetch(
        "/api/projects/" + encodeURIComponent(selected.id) + "/deployments/" + encodeURIComponent(deploymentId) + "/rollback",
        { method: "POST" },
      );
      const data = await response.json() as { url?: string; error?: string; warning?: string };
      if (!response.ok) throw new Error(data.error || "Deployment rollback failed.");
      if (data.url) {
        setProjects((current) => current.map((project) => project.id === selected.id
          ? { ...project, domain: data.url || project.domain, status: "Healthy", updated: "just now" }
          : project));
      }
      setNotice(data.warning || "Production rolled back successfully" + (data.url ? ": " + data.url : "."));
      await refreshDeploymentHistory(selected.id, true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Deployment rollback failed.");
    } finally {
      setRollbackDeploymentId(null);
    }
  }

  const displayDeployments = cloudflareDeployments.map((deployment) => ({
    id: deployment.id,
    project: deployment.environment,
    message: deployment.commitMessage || deployment.url,
    commitSha: deployment.commitSha,
    branch: deployment.branch || "—",
    time: deployment.createdAt ? timeAgo(deployment.createdAt) : "—",
    createdAt: deployment.createdAt,
    status: deployment.status === "success" ? "Ready" : deployment.status === "failure" ? "Failed" : deployment.status === "building" ? "Building" : "Unknown",
    duration: "Cloudflare",
    url: deployment.url,
    canRollback: deployment.environment === "production" && deployment.status === "success" && deployment.branch === (selected.slug ? "site-" + selected.slug : ""),
  }));
  const filteredProjects = useMemo(
    () => projects.filter((project) => project.name.toLowerCase().includes(search.toLowerCase())),
    [projects, search]
  );

  async function inspectRepository() {
    setRepoLoading(true); setRepoError(""); setRepoInfo(null);
    try {
      const response = await fetch("/api/github/repository?url=" + encodeURIComponent(repoUrl));
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not inspect this repository.");
      setRepoInfo({ ...data.repository, branches: data.branches });
      setRepoBranch(data.repository.defaultBranch);
    } catch (error) {
      setRepoError(error instanceof Error ? error.message : "Something went wrong.");
    } finally { setRepoLoading(false); }
  }

  async function addRepositoryPreview() {
    if (!repoInfo) return;
    const projectName = repoInfo.fullName.split("/")[1].toLowerCase();
    const slug = projectName.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 58);
    const newProject: Project = {
      slug,
      name: projectName, domain: "Not deployed yet",
      source: "github.com/" + repoInfo.fullName, branch: repoBranch, repositoryUrl: repoInfo.url, sourceType: "github",
      status: "Connected", updated: "just now", accent: "violet",
    };
    if (signedInUser) {
      setProjectSaving(true);
      try {
        const response = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: projectName, slug, sourceType: "github", repositoryUrl: repoInfo.url, branch: repoBranch }),
        });
        const data = await response.json() as { project: AccountProject; error?: string };
        if (!response.ok) throw new Error(data.error || "Could not save this project.");
        const savedProject = { ...newProject, id: data.project.id, slug: data.project.slug, sourceType: data.project.source_type };
        setProjects((current) => [savedProject, ...current.filter((project) => project.name !== projectName)]);
        setActiveProject(projectName);
        setActiveNav("project"); setProjectTab("overview");
        setNotice("Imported " + projectName + ". Press Deploy to publish it.");
        setModal(null);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not save this project.");
      } finally {
        setProjectSaving(false);
      }
      return;
    }
    setProjects((current) => [newProject, ...current.filter((project) => project.name !== projectName)]);
    setActiveProject(projectName); setActiveNav("project"); setProjectTab("overview");
    setNotice("Imported. Sign in with GitHub to save and deploy it.");
    setModal(null);
  }

  async function startUpload(file: File | undefined, kind: "zip" | "html") {
    if (!file) return;
    setUploadError("");
    const hostLimit = readiness?.maxUploadBytes;
    const validationError = validateUploadSelection(file.name, file.size, kind) ??
      (hostLimit && file.size > hostLimit ? "This DEPLO host accepts uploads up to " + Math.floor(hostLimit / 1024 / 1024) + " MB. Deploy larger sites from GitHub instead." : null);
    if (validationError) {
      setUploadError(validationError);
      setFileName("");
      return;
    }

    if (kind === "zip") {
      const signature = new Uint8Array(await file.slice(0, 4).arrayBuffer());
      if (!hasZipSignature(signature)) {
        setUploadError("This file does not look like a valid ZIP archive.");
        setFileName("");
        return;
      }
    } else {
      const html = await file.text();
      if (!/<html[\s>]/i.test(html) && !/<!doctype\s+html/i.test(html)) {
        setUploadError("The file should contain a complete HTML document.");
        setFileName("");
        return;
      }
    }

    setFileName(file.name);
    setUploadError("");
    if (!signedInUser) {
      setNotice("File checks passed. Sign in with GitHub to save and deploy this upload to your account.");
      return;
    }

    const baseName = file.name.replace(/\.[^.]+$/, "").trim().slice(0, 60) || "Uploaded site";
    const slug = baseName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 58) || "uploaded-site";
    setProjectSaving(true);
    setNotice("Creating your project and preparing the upload…");
    try {
      let accountProject: AccountProject | null = null;
      const createResponse = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: baseName, slug, sourceType: kind }),
      });
      const createData = await createResponse.json() as { project?: AccountProject; error?: string };
      if (createResponse.ok && createData.project) {
        accountProject = createData.project;
      } else if (createResponse.status === 409) {
        const listResponse = await fetch("/api/projects", { cache: "no-store" });
        const listData = await listResponse.json() as { projects?: AccountProject[] };
        accountProject = listData.projects?.find((project) => project.slug === slug && project.source_type === kind) ?? null;
        if (!accountProject) throw new Error(createData.error || "A project with this name already exists.");
      } else {
        throw new Error(createData.error || "Could not create your project.");
      }

      const savedAccountProject = accountProject;
      const previewProject: Project = {
        id: savedAccountProject.id,
        slug: savedAccountProject.slug,
        sourceType: savedAccountProject.source_type,
        name: savedAccountProject.name,
        domain: savedAccountProject.deployment_url || "Not deployed yet",
        source: kind === "zip" ? "ZIP upload" : "index.html",
        branch: "—",
        status: savedAccountProject.deployment_url ? "Healthy" : "Connected",
        updated: timeAgo(savedAccountProject.updated_at),
        accent: "violet",
      };
      setProjects((current) => [previewProject, ...current.filter((project) => project.id !== previewProject.id)]);

      const form = new FormData();
      form.append("file", file);
      const uploadResponse = await fetch("/api/projects/" + encodeURIComponent(savedAccountProject.id) + "/upload", {
        method: "POST",
        body: form,
      });
      if (uploadResponse.status === 413) throw new Error("This upload is larger than the host allows. Deploy larger sites from GitHub instead.");
      const uploadData = await uploadResponse.json().catch(() => ({})) as { url?: string; error?: string };
      if (!uploadResponse.ok) throw new Error(uploadData.error || "Upload deployment failed.");

      const deployedProject: Project = {
        ...previewProject,
        domain: uploadData.url || previewProject.domain,
        status: "Healthy",
        updated: "just now",
      };
      setProjects((current) => [deployedProject, ...current.filter((project) => project.id !== deployedProject.id)]);
      setActiveProject(deployedProject.name);
      setActiveNav("project"); setProjectTab("overview");
      setNotice(uploadData.url ? "Your site is live: " + uploadData.url : "Upload deployment completed.");
      setModal(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Upload deployment failed.");
    } finally {
      setProjectSaving(false);
    }
  }

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 7000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!deployStartedAt) { setDeployElapsed(0); return; }
    const timer = window.setInterval(() => setDeployElapsed(Math.round((Date.now() - deployStartedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [deployStartedAt]);

  useEffect(() => { setDeployResult(null); }, [selected.id]);

  useEffect(() => {
    try { setCommunityHidden(window.localStorage.getItem("deplo:community-dismissed") === "1"); } catch { setCommunityHidden(false); }
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteQuery("");
        setPaletteOpen((open) => !open);
      } else if (event.key === "Escape") {
        setPaletteOpen(false); setBuildLogOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const isDeployed = Boolean(selected.id) && selected.domain !== "Not deployed yet" && /^https?:\/\//.test(selected.domain);
  const latestDeployment = displayDeployments[0];
  const openProject = (name: string, tab: ProjectTab = "overview") => { setActiveProject(name); setActiveNav("project"); setProjectTab(tab); };
  const goHome = () => { setActiveNav("home"); };
  const providerBlocked = !readinessLoading && !readinessError && readiness && !readiness.ready;

  const fmtElapsed = (seconds: number) => Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
  type PaletteItem = { id: string; label: string; hint?: string; run: () => void };
  const paletteItems: PaletteItem[] = [
    { id: "new", label: "New project", hint: "Import, ZIP or HTML", run: () => setModal("github") },
    { id: "home", label: "All projects", run: goHome },
    ...(activeNav === "project" && selected.id && selected.sourceType === "github" && readiness?.ready ? [{ id: "deploy", label: "Deploy " + selected.name, hint: "Build and publish", run: () => void deploySelectedProject() }] : []),
    ...(activeNav === "project" && isDeployed ? [{ id: "visit", label: "Visit " + hostOf(selected.domain), run: () => window.open(selected.domain, "_blank", "noopener") }] : []),
    ...(activeNav === "project" ? PROJECT_TABS.map((tab) => ({ id: "tab-" + tab.id, label: "Go to " + tab.label, hint: selected.name, run: () => setProjectTab(tab.id) })) : []),
    ...projects.map((project) => ({ id: "p-" + (project.id ?? project.name), label: project.name, hint: /^https?:/.test(project.domain) ? hostOf(project.domain) : "Project", run: () => openProject(project.name) })),
    ...(signedInUser
      ? [{ id: "app", label: githubAppStatus?.connected ? "Manage GitHub App" : "Connect GitHub App", hint: "Private repos and auto-deploy", run: () => { window.location.href = "/api/auth/github/install"; } },
         { id: "signout", label: "Sign out", run: () => void signOut() }]
      : [{ id: "signin", label: "Sign in with GitHub", run: () => { window.location.href = "/api/auth/github"; } }]),
  ];
  const paletteMatches = paletteItems.filter((item) => (item.label + " " + (item.hint ?? "")).toLowerCase().includes(paletteQuery.trim().toLowerCase())).slice(0, 12);
  const runPalette = (item: PaletteItem | undefined) => { if (!item) return; setPaletteOpen(false); item.run(); };
  const dismissCommunity = () => { setCommunityHidden(true); try { window.localStorage.setItem("deplo:community-dismissed", "1"); } catch { /* private mode */ } };

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-left">
          <button className="logo" onClick={goHome} aria-label="DEPLO projects">
            <img src="/deplo-mark.svg" alt="" width={22} height={22} />
            <span>deplo</span>
          </button>
          <span className="crumb-sep" aria-hidden="true">/</span>
          {authLoading ? <span className="crumb muted">…</span> : signedInUser ? (
            <button className="crumb" onClick={goHome}>
              {signedInUser.avatarUrl ? <img className="avatar" src={signedInUser.avatarUrl} alt="" /> : <span className="avatar avatar-fallback">{signedInUser.login[0]?.toUpperCase()}</span>}
              {signedInUser.login}
            </button>
          ) : <span className="crumb muted">Guest</span>}
          {activeNav === "project" && selected.id !== undefined && <>
            <span className="crumb-sep" aria-hidden="true">/</span>
            <span className="crumb crumb-current">{selected.name}</span>
          </>}
          {activeNav === "project" && !selected.id && selected.name !== "No project selected" && <>
            <span className="crumb-sep" aria-hidden="true">/</span>
            <span className="crumb crumb-current">{selected.name}</span>
          </>}
        </div>
        <div className="topbar-right">
          <button className="kbd-trigger" onClick={() => { setPaletteQuery(""); setPaletteOpen(true); }} aria-label="Open command menu">
            <Search size={14} /><span>Search</span><kbd>Ctrl K</kbd>
          </button>
          {signedInUser && <a className="btn btn-ghost btn-sm" href="/api/auth/github/install" title="Lets DEPLO read private repositories and redeploy on push">
            <span className={"dot " + (githubAppStatus?.connected ? "dot-ready" : "dot-idle")} />
            {githubAppStatusLoading ? "Checking GitHub App" : githubAppStatus?.connected ? "GitHub App connected" : "Connect GitHub App"}
          </a>}
          {authLoading ? null : signedInUser
            ? <button className="btn btn-ghost btn-sm" onClick={() => void signOut()}>Sign out</button>
            : <a className="btn btn-primary btn-sm" href="/api/auth/github"><Github size={15} /> Sign in with GitHub</a>}
        </div>
      </header>

      {activeNav === "project" && <nav className="tabs" aria-label="Project sections">
        <div className="tabs-inner">
          {PROJECT_TABS.map((tab) => (
            <button key={tab.id} className={"tab " + (projectTab === tab.id ? "tab-active" : "")} aria-current={projectTab === tab.id ? "page" : undefined} onClick={() => setProjectTab(tab.id)}>
              {tab.label}
              {tab.id === "builds" && hasActiveBuildJob && <span className="dot dot-building" />}
            </button>
          ))}
        </div>
      </nav>}

      <main className="page">
        {providerBlocked && <div className="banner banner-warn" role="status">
          <strong>Deployments are paused.</strong> The server is missing {readiness?.missing.join(", ")}. Add {readiness && readiness.missing.length > 1 ? "them" : "it"} to the environment and redeploy DEPLO.
        </div>}

        {activeNav === "home" ? <>
          {(signedInUser || projects.length > 0) && <div className="toolbar">
            <label className="search">
              <Search size={16} aria-hidden="true" />
              <input id="project-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search projects" aria-label="Search projects" />
            </label>
            <button className="btn btn-primary" onClick={() => setModal("github")}><Plus size={16} /> Add new</button>
          </div>}

          {projectsError && <div className="banner banner-error" role="alert">{projectsError}</div>}

          {!authLoading && !signedInUser && projects.length === 0 ? (
            <section className="hero-empty">
              <h1>Deploy a site in under a minute.</h1>
              <p>Import a GitHub repository, upload a ZIP, or drop in a single HTML file. DEPLO publishes it to a global edge network and gives you a URL.</p>
              <div className="hero-actions">
                <a className="btn btn-primary btn-lg" href="/api/auth/github"><Github size={17} /> Continue with GitHub</a>
                <button className="btn btn-secondary btn-lg" onClick={() => setModal("github")}>Try without signing in</button>
              </div>
            </section>
          ) : projectsLoading ? (
            <div className="grid">{[0, 1, 2].map((key) => <div className="card card-skeleton" key={key} />)}</div>
          ) : filteredProjects.length === 0 ? (
            <section className="empty">
              <h2>{search ? "No projects match “" + search + "”" : "No projects yet"}</h2>
              <p>{search ? "Try a different name, or clear the search." : "Import a repository or upload a site to create your first project."}</p>
              {!search && <button className="btn btn-primary" onClick={() => setModal("github")}><Plus size={16} /> Add new project</button>}
            </section>
          ) : (
            <div className="grid">
              {filteredProjects.map((project) => {
                const live = /^https?:\/\//.test(project.domain);
                return (
                  <button key={project.id ?? project.name} className="card project-card" onClick={() => openProject(project.name)}>
                    <div className="thumb" aria-hidden="true">
                      {live ? <iframe src={project.domain} title="" loading="lazy" sandbox="allow-scripts allow-same-origin" tabIndex={-1} /> : <span className="thumb-empty">{project.name[0]?.toUpperCase()}</span>}
                    </div>
                    <div className="project-card-top">
                      <span className="project-avatar" aria-hidden="true">{project.name[0]?.toUpperCase()}</span>
                      <span className="project-card-name">
                        <strong>{project.name}</strong>
                        <span className="mono muted">{live ? hostOf(project.domain) : "Not deployed"}</span>
                      </span>
                      <span className={"dot " + (live ? "dot-ready" : "dot-idle")} title={live ? "Live" : "Not deployed"} />
                    </div>
                    <div className="project-card-source">
                      {project.sourceType === "github" || project.source.startsWith("github.com") ? <Github size={14} /> : project.sourceType === "zip" || project.source === "ZIP upload" ? <FileArchive size={14} /> : <FileCode2 size={14} />}
                      <span className="truncate">{project.source.replace(/^github\.com\//, "")}</span>
                      {project.branch !== "—" && <span className="mono branch"><GitBranch size={12} />{project.branch}</span>}
                    </div>
                    <div className="project-card-foot muted">Updated {project.updated}</div>
                  </button>
                );
              })}
            </div>
          )}
        </> : (
          <>
            <div className="project-head">
              <div>
                <button className="back" onClick={goHome}><ArrowLeft size={15} /> All projects</button>
                <h1>{selected.name}</h1>
              </div>
              <div className="project-head-actions">
                {selected.repositoryUrl && <a className="btn btn-secondary" href={selected.repositoryUrl} target="_blank" rel="noreferrer"><Github size={15} /> Repository</a>}
                {isDeployed && <a className="btn btn-secondary" href={selected.domain} target="_blank" rel="noreferrer">Visit <ExternalLink size={14} /></a>}
                {selected.id && selected.sourceType === "github" && <button className="btn btn-primary" onClick={() => void deploySelectedProject()} disabled={projectDeploying || !readiness?.ready}>{projectDeploying ? <><Loader2 size={15} className="spin" /> Deploying {fmtElapsed(deployElapsed)}</> : isDeployed ? "Redeploy" : "Deploy"}</button>}
              </div>
            </div>

            {projectDeploying && <div className="deploy-strip" role="status">
              <span className="dot dot-building" />
              <div><strong>Building and deploying</strong><span className="muted">Cloning, installing and building can take 1 to 3 minutes for framework apps. Plain HTML sites publish in seconds.</span></div>
              <span className="mono">{fmtElapsed(deployElapsed)}</span>
            </div>}
            {!projectDeploying && deployResult && <div className={"deploy-strip " + (deployResult.ok ? "deploy-strip-ok" : "deploy-strip-error")} role={deployResult.ok ? "status" : "alert"}>
              <span className={"dot " + (deployResult.ok ? "dot-ready" : "dot-error")} />
              <div><strong>{deployResult.ok ? "Deployed" : "Deployment failed"}</strong><span className="muted">{deployResult.message}</span></div>
              <div className="deploy-strip-actions">
                {deployResult.log && <button className="btn btn-secondary btn-sm" onClick={() => setBuildLogOpen(true)}>View build log</button>}
                <button className="icon-btn" onClick={() => setDeployResult(null)} aria-label="Dismiss"><X size={15} /></button>
              </div>
            </div>}
            {!selected.id && <div className="banner">This project only exists in this browser tab. <a href="/api/auth/github">Sign in with GitHub</a> to save and deploy it.</div>}

            {projectTab === "overview" && <>
              <section className="card production">
                <div className="preview-frame">
                  {isDeployed ? <>
                    <iframe src={selected.domain} title={"Live preview of " + selected.name} loading="lazy" sandbox="allow-scripts allow-same-origin" tabIndex={-1} aria-hidden="true" />
                    <a className="preview-link" href={selected.domain} target="_blank" rel="noreferrer" aria-label={"Open " + selected.name} />
                  </> : <div className="preview-empty"><Rocket size={22} /><span>{selected.sourceType === "github" ? "Press Deploy to publish this repository." : "Not deployed yet."}</span></div>}
                </div>
                <dl className="production-meta">
                  <div><dt>Deployment</dt><dd>{isDeployed ? <a className="mono" href={selected.domain} target="_blank" rel="noreferrer">{hostOf(selected.domain)}</a> : <span className="muted">None yet</span>}</dd></div>
                  <div><dt>Domains</dt><dd>{customDomains.length ? customDomains.map((domain) => <span className="mono" key={domain.name}>{domain.name}</span>) : <button className="link" onClick={() => setProjectTab("domains")}>Add a domain</button>}</dd></div>
                  <div><dt>Status</dt><dd><span className={"status " + (isDeployed ? "status-ready" : "status-idle")}><span className={"dot " + (isDeployed ? "dot-ready" : "dot-idle")} />{isDeployed ? "Ready" : "Not deployed"}</span></dd></div>
                  <div><dt>Updated</dt><dd>{selected.updated}</dd></div>
                  <div><dt>Source</dt><dd className="source-line">
                    {selected.sourceType === "github" || selected.source.startsWith("github.com") ? <><Github size={14} /><span className="truncate">{selected.source.replace(/^github\.com\//, "")}</span>{selected.branch !== "—" && <span className="mono branch"><GitBranch size={12} />{selected.branch}</span>}</> : <span>{selected.source}</span>}
                    {latestDeployment?.commitSha && <span className="mono muted">{latestDeployment.commitSha.slice(0, 7)}</span>}
                  </dd></div>
                </dl>
              </section>

              <section className="section">
                <div className="section-head">
                  <h2>Recent deployments</h2>
                  {displayDeployments.length > 3 && <button className="link" onClick={() => setProjectTab("deployments")}>View all</button>}
                </div>
                <DeploymentList items={displayDeployments.slice(0, 3)} loading={historyLoading} error={historyError} onLogs={(id) => void openDeploymentLogs(id)} onRollback={(id) => void rollbackSelectedDeployment(id)} rollbackId={rollbackDeploymentId} signedIn={Boolean(signedInUser && selected.id)} />
              </section>
            </>}

            {projectTab === "deployments" && <section className="section">
              <div className="section-head">
                <h2>Deployments</h2>
                <button className="btn btn-ghost btn-sm" onClick={() => void refreshDeploymentHistory(selected.id, Boolean(signedInUser))} disabled={historyLoading}><RefreshCw size={14} className={historyLoading ? "spin" : ""} /> Refresh</button>
              </div>
              <DeploymentList items={displayDeployments} loading={historyLoading} error={historyError} onLogs={(id) => void openDeploymentLogs(id)} onRollback={(id) => void rollbackSelectedDeployment(id)} rollbackId={rollbackDeploymentId} signedIn={Boolean(signedInUser && selected.id)} />
              <p className="hint">Roll back is available on earlier successful production deployments. It switches the live site instantly; nothing is rebuilt.</p>
            </section>}

            {projectTab === "builds" && <section className="section">
              <div className="section-head">
                <h2>Framework builds</h2>
                <button className="btn btn-ghost btn-sm" onClick={() => void refreshBuildJobs(selected.id, buildJobsEnabled)} disabled={buildJobsLoading || !buildJobsEnabled}><RefreshCw size={14} className={buildJobsLoading ? "spin" : ""} /> Refresh</button>
              </div>
              {!signedInUser || !selected.id ? <Empty title="Sign in to build" text="Framework builds run for projects saved to your account." />
                : selected.sourceType !== "github" ? <Empty title="No build needed" text="ZIP and HTML uploads are published as they are." />
                : <>
                  <form className="card form" onSubmit={(event) => { event.preventDefault(); void queueBuildJob(); }}>
                    <div className="form-row">
                      <label className="field">Framework
                        <select value={buildFramework} onChange={(event) => setBuildFramework(event.target.value as BuildJobFramework)}>
                          {BUILD_FRAMEWORKS.map((option) => <option key={option.value} value={option.value}>{option.label} (outputs {option.output}/)</option>)}
                        </select>
                      </label>
                      <label className="field">Package manager
                        <select value={buildPackageManager} onChange={(event) => setBuildPackageManager(event.target.value as BuildJobPackageManager)}>
                          {BUILD_PACKAGE_MANAGERS.map((manager) => <option key={manager} value={manager}>{manager}</option>)}
                        </select>
                      </label>
                    </div>
                    <label className="field" htmlFor="build-commit-input">Commit on {selected.branch}</label>
                    <div className="input-group">
                      <input id="build-commit-input" className="mono" value={buildCommitSha} onChange={(event) => setBuildCommitSha(event.target.value.trim())} placeholder="40-character commit SHA" autoComplete="off" spellCheck={false} maxLength={40} />
                      <button className="btn btn-secondary" type="button" onClick={() => void fetchLatestBranchCommit()} disabled={buildCommitLoading || !selected.repositoryUrl}>{buildCommitLoading ? "Reading…" : "Use latest"}</button>
                      <button className="btn btn-primary" type="submit" disabled={buildQueueing || !/^[a-f0-9]{40}$/i.test(buildCommitSha)}>{buildQueueing ? "Queueing…" : "Start build"}</button>
                    </div>
                    <p className="hint">Needs the GitHub App and an isolated build runner. The runner checks the commit itself, so the framework here is a hint.</p>
                  </form>
                  {buildJobsError && <div className="banner banner-error" role="alert">{buildJobsError}</div>}
                  {buildJobsLoading && buildJobs.length === 0 ? <div className="list"><div className="row row-skeleton" /></div>
                    : buildJobs.length === 0 ? <Empty title="No builds yet" text="Start a build to compile this repository and publish its output." />
                    : <div className="list">{buildJobs.map((job) => {
                      const state = describeBuildJob(job);
                      const cancellable = job.status === "pending" || job.status === "processing";
                      const frameworkLabel = BUILD_FRAMEWORKS.find((option) => option.value === job.framework)?.label ?? job.framework;
                      return <div className="row" key={job.id}>
                        <span className={"status status-" + toneClass(state.tone)}><span className={"dot dot-" + toneClass(state.tone)} />{state.label}</span>
                        <div className="row-main"><strong>{frameworkLabel} with {job.package_manager}</strong><span className="mono muted">{job.source_commit_sha.slice(0, 7)}</span></div>
                        <div className="row-meta muted">
                          {job.artifact_file_count != null && job.artifact_bytes != null && <span>{job.artifact_file_count} files, {(job.artifact_bytes / 1024 / 1024).toFixed(2)} MiB</span>}
                          {job.error_code && <span className="text-error mono">{job.error_code}</span>}
                          <span>Attempt {job.attempt_count}/{job.max_attempts}</span>
                          <span>{timeAgo(job.created_at)}</span>
                        </div>
                        {cancellable ? <button className="btn btn-ghost btn-sm" onClick={() => void cancelBuildJob(job.id)} disabled={buildCancelling !== null}>{buildCancelling === job.id ? "Cancelling…" : "Cancel"}</button> : <span />}
                      </div>;
                    })}</div>}
                  {hasActiveBuildJob && <p className="hint">Refreshing every 10 seconds while a build is running.</p>}

                  <details className="disclosure">
                    <summary>Runner recovery log ({recoveryAttempts.length})</summary>
                    <p className="hint">What the build runner planned after a crash or restart. This is a record only; DEPLO does not run these steps on its own yet.</p>
                    {recoveryError ? <div className="banner banner-error" role="alert">{recoveryError}</div>
                      : recoveryAttempts.length === 0 ? <p className="muted">No recovery attempts recorded.</p>
                      : <div className="list">{recoveryAttempts.map((attempt) => {
                        const tone = attempt.status === "completed" ? "ready" : attempt.status === "blocked" ? "error" : attempt.status === "reconciling" ? "building" : "idle";
                        return <div className="row" key={attempt.id}>
                          <span className={"status status-" + tone}><span className={"dot dot-" + tone} />{cap(attempt.status)}</span>
                          <div className="row-main"><strong>{attempt.disposition.replaceAll("_", " ")}</strong><span className="muted">Runner state {attempt.observed_state}, step {Math.min(attempt.next_action_index, attempt.actions.length)} of {attempt.actions.length}</span></div>
                          <div className="row-meta muted">{attempt.error_code && <span className="text-error mono">{attempt.error_code}</span>}<span>{timeAgo(attempt.updated_at)}</span></div>
                          <span />
                        </div>;
                      })}</div>}
                  </details>
                </>}
            </section>}

            {projectTab === "domains" && <section className="section">
              <div className="section-head">
                <h2>Domains</h2>
                <button className="btn btn-ghost btn-sm" onClick={() => void refreshCustomDomains(selected.id, Boolean(signedInUser))} disabled={domainsLoading || !selected.id || !signedInUser}><RefreshCw size={14} className={domainsLoading ? "spin" : ""} /> Refresh</button>
              </div>
              {!signedInUser || !selected.id ? <Empty title="Sign in to add domains" text="Custom domains are available for projects saved to your account." /> : <>
                <form className="card form" onSubmit={(event) => { event.preventDefault(); void addCustomDomain(); }}>
                  <label className="field" htmlFor="custom-domain-input">Add a domain</label>
                  <div className="input-group">
                    <input id="custom-domain-input" className="mono" value={domainInput} onChange={(event) => setDomainInput(event.target.value)} placeholder="www.example.com" autoComplete="off" />
                    <button className="btn btn-primary" type="submit" disabled={domainSaving || !domainInput.trim() || !isDeployed}>{domainSaving ? "Adding…" : "Add"}</button>
                  </div>
                  <p className="hint">{isDeployed ? "For a subdomain, point a CNAME record at " + hostOf(selected.domain) + ". Apex domains must be a Cloudflare zone." : "Deploy this project before adding a domain."}</p>
                </form>
                {domainsError && <div className="banner banner-error" role="alert">{domainsError}</div>}
                {domainsLoading && customDomains.length === 0 ? <div className="list"><div className="row row-skeleton" /></div>
                  : customDomains.length === 0 ? <Empty title="No custom domains" text={isDeployed ? "Your site is available at " + hostOf(selected.domain) + "." : "Deploy first, then connect your own domain."} />
                  : <div className="list">{customDomains.map((domain) => {
                    const tone = domain.status === "active" ? "ready" : domain.status === "error" || domain.status === "blocked" ? "error" : "building";
                    return <div className="domain" key={domain.name}>
                      <div className="domain-top">
                        <a className="mono domain-name" href={"https://" + domain.name} target="_blank" rel="noreferrer">{domain.name}</a>
                        <span className={"status status-" + tone}><span className={"dot dot-" + tone} />{domain.status === "active" ? "Valid configuration" : cap(domain.status)}</span>
                        <button className="btn btn-ghost btn-sm" onClick={() => void removeCustomDomain(domain.name)} disabled={domainDeleting !== null}>{domainDeleting === domain.name ? "Removing…" : "Remove"}</button>
                      </div>
                      {domain.status !== "active" && <table className="dns">
                        <thead><tr><th>Type</th><th>Name</th><th>Value</th></tr></thead>
                        <tbody>
                          <tr><td>CNAME</td><td className="mono">{domain.name.split(".")[0]}</td><td className="mono">{hostOf(selected.domain)}</td></tr>
                          {domain.validation.method === "txt" && domain.validation.txtName && domain.validation.txtValue && <tr><td>TXT</td><td className="mono">{domain.validation.txtName}</td><td className="mono">{domain.validation.txtValue}</td></tr>}
                        </tbody>
                      </table>}
                      {(domain.validation.error || domain.verification.error) && <p className="text-error">{domain.validation.error || domain.verification.error}</p>}
                      <p className="hint">Validation {domain.validation.status}, certificate {domain.verification.status}.</p>
                    </div>;
                  })}</div>}
              </>}
            </section>}

            {projectTab === "activity" && <section className="section">
              <div className="section-head">
                <h2>Push activity</h2>
                <button className="btn btn-ghost btn-sm" onClick={() => void refreshWebhookDeliveries(selected.id, Boolean(signedInUser) && selected.sourceType === "github")} disabled={webhookLoading || !selected.id || !signedInUser || selected.sourceType !== "github"}><RefreshCw size={14} className={webhookLoading ? "spin" : ""} /> Refresh</button>
              </div>
              {!signedInUser || !selected.id ? <Empty title="Sign in to see activity" text="Pushes to your connected branches appear here." />
                : selected.sourceType !== "github" ? <Empty title="No Git activity" text="This project was uploaded, so pushes don't redeploy it." />
                : webhookError ? <div className="banner banner-error" role="alert">{webhookError}</div>
                : webhookDeliveries.length === 0 ? <Empty title="No pushes yet" text={"Push to " + selected.branch + " and DEPLO redeploys automatically once the GitHub App is connected."} />
                : <div className="list">{webhookDeliveries.map((delivery) => {
                  const label = delivery.status === "received" ? (delivery.attempt_count > 0 ? "Retrying" : "Queued") : delivery.status === "processing" ? "Deploying" : delivery.status === "deployed" ? "Deployed" : delivery.status === "ignored" ? "Ignored" : "Failed";
                  const tone = delivery.status === "deployed" ? "ready" : delivery.status === "failed" ? "error" : delivery.status === "processing" ? "building" : "idle";
                  return <div className="row" key={delivery.delivery_id}>
                    <span className={"status status-" + tone}><span className={"dot dot-" + tone} />{label}</span>
                    <div className="row-main"><strong className="mono">{delivery.commit_sha.slice(0, 7)}</strong><span className="mono muted branch"><GitBranch size={12} />{delivery.branch}</span></div>
                    <div className="row-meta muted">
                      {delivery.last_error_code && <span className="text-error mono">{delivery.last_error_code}</span>}
                      {delivery.status === "received" && delivery.attempt_count > 0 && <span>Next try {timeAgo(delivery.available_at).replace(" ago", "")}</span>}
                      <span>{timeAgo(delivery.received_at)}</span>
                    </div>
                    <span />
                  </div>;
                })}</div>}
            </section>}

            {projectTab === "settings" && <section className="section settings">
              <h2>Settings</h2>
              {!signedInUser || !selected.id ? <Empty title="Sign in to change settings" text="Settings are available for projects saved to your account." /> : <>
                <form className="card setting" onSubmit={(event) => { event.preventDefault(); void renameSelectedProject(); }}>
                  <div className="setting-body">
                    <h3>Project name</h3>
                    <p className="muted">Shown on your dashboard. The URL and repository don't change.</p>
                    <input id="project-display-name" value={projectNameInput} onChange={(event) => setProjectNameInput(event.target.value)} maxLength={60} aria-label="Project name" />
                  </div>
                  <div className="setting-foot"><span className="muted">Up to 60 characters.</span><button className="btn btn-primary btn-sm" type="submit" disabled={projectRenaming || !projectNameInput.trim() || projectNameInput.trim() === selected.name}>{projectRenaming ? "Saving…" : "Save"}</button></div>
                </form>
                <div className="card setting">
                  <div className="setting-body">
                    <h3>Git repository</h3>
                    <p className="muted">{selected.sourceType === "github" ? "Deploys come from " + selected.branch + ". Connect the GitHub App so pushes redeploy automatically and private repositories keep working." : "This project was uploaded directly and isn't linked to Git."}</p>
                  </div>
                  {selected.sourceType === "github" && <div className="setting-foot"><span className="muted">{githubAppStatus?.connected ? "Connected as " + (githubAppStatus.accountLogin ?? "your account") : "Not connected"}</span><a className="btn btn-secondary btn-sm" href="/api/auth/github/install">{githubAppStatus?.connected ? "Manage" : "Connect"}</a></div>}
                </div>
                <div className="card setting setting-danger">
                  <div className="setting-body">
                    <h3>Delete project</h3>
                    <p className="muted">Removes {selected.name}, its live site and every deployment. This can't be undone.</p>
                  </div>
                  <div className="setting-foot"><span /><button className="btn btn-danger btn-sm" onClick={() => void deleteSelectedProject()} disabled={projectDeleting}>{projectDeleting ? "Deleting…" : "Delete"}</button></div>
                </div>
              </>}
            </section>}
          </>
        )}
      </main>

      <footer className="footer">
        <span className="footer-status">
          <span className={"dot " + (readinessLoading ? "dot-idle" : readiness?.ready ? "dot-ready" : "dot-error")} />
          {readinessLoading ? "Checking hosting" : readinessError ? "Hosting status unknown" : readiness?.ready ? "Cloudflare Pages connected" : "Hosting not configured"}
        </span>
        <span className="muted">DEPLO v0.1</span>
      </footer>

      {notice && <div className="toast" role="status" aria-live="polite">
        <span>{notice}</span>
        <button className="icon-btn" onClick={() => setNotice("")} aria-label="Dismiss"><X size={15} /></button>
      </div>}

      {modal && <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}>
        <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="new-project-title">
          <div className="dialog-head">
            <h2 id="new-project-title">New project</h2>
            <button className="icon-btn" onClick={() => setModal(null)} aria-label="Close"><X size={18} /></button>
          </div>
          <div className="segmented" role="tablist">
            {([["github", "Git repository", Github], ["upload", "ZIP file", FileArchive], ["html", "HTML file", FileCode2]] as const).map(([id, label, Icon]) => {
              const active = modal === id || (id === "github" && modal === "repo");
              return <button key={id} role="tab" aria-selected={active} className={"segment " + (active ? "segment-active" : "")} onClick={() => { setUploadError(""); setFileName(""); if (id === "github") { setRepoInfo(null); setRepoError(""); setModal("repo"); } else setModal(id); }}><Icon size={15} />{label}</button>;
            })}
          </div>
          {modal === "github" || modal === "repo" ? <div className="dialog-body">
            <label className="field" htmlFor="repo-url">Repository URL</label>
            <div className="input-group">
              <input id="repo-url" className="mono" value={repoUrl} autoFocus onChange={(event) => setRepoUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void inspectRepository(); }} placeholder="https://github.com/owner/repo" />
              <button className="btn btn-secondary" onClick={() => void inspectRepository()} disabled={repoLoading || !repoUrl.trim()}>{repoLoading ? "Looking…" : "Find"}</button>
            </div>
            {repoError && <div className="banner banner-error" role="alert">{repoError}</div>}
            {repoInfo ? <div className="repo">
              <div className="repo-top"><Github size={18} /><div><strong>{repoInfo.fullName}</strong><span className="muted">{repoInfo.description || "No description"}</span></div></div>
              <label className="field" htmlFor="repo-branch">Branch to deploy</label>
              <select id="repo-branch" value={repoBranch} onChange={(event) => setRepoBranch(event.target.value)}>{repoInfo.branches.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}{branch.name === repoInfo.defaultBranch ? " (default)" : ""}</option>)}</select>
              <button className="btn btn-primary btn-block" onClick={() => void addRepositoryPreview()} disabled={projectSaving}>{projectSaving ? "Importing…" : "Import"}</button>
              <p className="hint">{signedInUser ? "Imports the project. You'll deploy it from the next screen." : "You're not signed in, so this project stays in this tab only."}</p>
            </div> : <p className="hint">Public repositories work right away. Private ones need you to sign in with GitHub.</p>}
          </div> : <div className="dialog-body">
            <label className={"dropzone " + (projectSaving ? "dropzone-busy" : "")}>
              <input type="file" disabled={projectSaving} accept={modal === "upload" ? ".zip,application/zip" : ".html,.htm,text/html"} onChange={(event) => void startUpload(event.target.files?.[0], modal === "upload" ? "zip" : "html")} />
              {projectSaving ? <Loader2 size={22} className="spin" /> : <UploadCloud size={22} />}
              <strong>{projectSaving ? "Uploading and deploying " + fileName : fileName || (modal === "upload" ? "Choose a .zip file" : "Choose an .html file")}</strong>
              <span className="muted">{modal === "upload" ? "Needs index.html at the top level. Up to " + Math.floor((readiness?.maxUploadBytes ?? 25 * 1024 * 1024) / 1024 / 1024) + " MB." : "A complete HTML page. Up to 2 MB."}</span>
            </label>
            {uploadError && <div className="banner banner-error" role="alert">{uploadError}</div>}
            {!signedInUser && <p className="hint"><a href="/api/auth/github">Sign in with GitHub</a> to deploy uploads.</p>}
          </div>}
        </div>
      </div>}

      {buildLogOpen && deployResult?.log && <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setBuildLogOpen(false); }}>
        <section className="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="build-log-title">
          <div className="dialog-head">
            <div><h2 id="build-log-title">Build log</h2><span className="muted">{deployResult.message}</span></div>
            <div className="row-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => { void navigator.clipboard?.writeText(deployResult.log ?? ""); setNotice("Build log copied."); }}>Copy</button>
              <button className="icon-btn" onClick={() => setBuildLogOpen(false)} aria-label="Close build log"><X size={18} /></button>
            </div>
          </div>
          <div className="terminal">{deployResult.log.split("\n").map((line, index) => <div className={"log-line log-line-plain " + (line.startsWith("$ ") ? "log-cmd" : /error|ERR!|failed/i.test(line) ? "log-err" : "")} key={index}><code>{line || " "}</code></div>)}</div>
        </section>
      </div>}

      {paletteOpen && <div className="overlay overlay-top" onMouseDown={(event) => { if (event.target === event.currentTarget) setPaletteOpen(false); }}>
        <div className="palette" role="dialog" aria-modal="true" aria-label="Command menu">
          <label className="palette-input">
            <Search size={16} aria-hidden="true" />
            <input autoFocus value={paletteQuery} onChange={(event) => setPaletteQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") runPalette(paletteMatches[0]); }} placeholder="Search projects and actions" aria-label="Search projects and actions" />
            <kbd>Esc</kbd>
          </label>
          <div className="palette-list" role="listbox">
            {paletteMatches.length === 0 ? <p className="muted palette-empty">Nothing matches “{paletteQuery}”.</p>
              : paletteMatches.map((item, index) => <button key={item.id} role="option" aria-selected={index === 0} className={"palette-item " + (index === 0 ? "palette-item-first" : "")} onClick={() => runPalette(item)}>
                <span>{item.label}</span>{item.hint && <span className="muted">{item.hint}</span>}
              </button>)}
          </div>
        </div>
      </div>}

      {!communityHidden && <aside className="community" aria-label="DEPLO is open source">
        <button className="icon-btn community-close" onClick={dismissCommunity} aria-label="Dismiss"><X size={15} /></button>
        <div className="community-art" aria-hidden="true">
          <img src="/deplo-mark.svg" alt="" width={28} height={28} />
          <span className="community-trail" />
        </div>
        <strong>Built in the open.</strong>
        <p className="muted">DEPLO is open source. Star the repo, report a bug, or send a pull request.</p>
        <div className="community-actions">
          <a className="btn btn-secondary btn-sm" href="https://github.com/ansh44233/DEPLO" target="_blank" rel="noreferrer" onClick={dismissCommunity}><Github size={14} /> Star</a>
          <a className="btn btn-secondary btn-sm" href="https://github.com/ansh44233/DEPLO/issues/new" target="_blank" rel="noreferrer">Report a bug</a>
        </div>
      </aside>}

      {logsDeploymentId && <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setLogsDeploymentId(null); }}>
        <section className="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="deployment-logs-title">
          <div className="dialog-head">
            <div><h2 id="deployment-logs-title">Build logs</h2><span className="mono muted">{logsDeploymentId}</span></div>
            <button className="icon-btn" onClick={() => setLogsDeploymentId(null)} aria-label="Close build logs"><X size={18} /></button>
          </div>
          {logsLoading ? <div className="terminal"><span className="muted">Loading logs…</span></div>
            : logsError ? <div className="banner banner-error" role="alert">{logsError}</div>
            : <div className="terminal">{deploymentLogs.length ? deploymentLogs.map((log, index) => <div className="log-line" key={logsDeploymentId + "-" + index}>
              <time>{log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : ""}</time><code>{log.line}</code>
            </div>) : <span className="muted">No log output for this deployment.</span>}</div>}
        </section>
      </div>}
    </div>
  );
}

type DisplayDeployment = { id: string; message: string; commitSha: string | null; branch: string; time: string; status: string; url: string; canRollback: boolean; project: string };

function cap(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

function toneClass(tone: "healthy" | "failed" | "building" | "queued"): "ready" | "error" | "building" | "idle" {
  return tone === "healthy" ? "ready" : tone === "failed" ? "error" : tone === "building" ? "building" : "idle";
}

function Empty({ title, text }: { title: string; text: string }) {
  return <div className="empty"><h3>{title}</h3><p>{text}</p></div>;
}

function DeploymentList({ items, loading, error, onLogs, onRollback, rollbackId, signedIn }: {
  items: DisplayDeployment[]; loading: boolean; error: string; signedIn: boolean;
  onLogs: (id: string) => void; onRollback: (id: string) => void; rollbackId: string | null;
}) {
  if (!signedIn) return <Empty title="No deployments" text="Sign in and deploy this project to see its history." />;
  if (error) return <div className="banner banner-error" role="alert">{error}</div>;
  if (loading && items.length === 0) return <div className="list"><div className="row row-skeleton" /><div className="row row-skeleton" /></div>;
  if (items.length === 0) return <Empty title="No deployments yet" text="Press Deploy to publish the first version." />;
  return <div className="list">{items.map((deployment, index) => {
    const tone = deployment.status === "Ready" ? "ready" : deployment.status === "Failed" ? "error" : deployment.status === "Building" ? "building" : "idle";
    return <div className="row deployment" key={deployment.id}>
      <span className={"status status-" + tone}><span className={"dot dot-" + tone} />{deployment.status}</span>
      <div className="row-main">
        <a className="mono" href={deployment.url} target="_blank" rel="noreferrer">{hostOf(deployment.url)}</a>
        <span className="muted truncate">{deployment.message !== deployment.url ? deployment.message : deployment.project === "production" ? "Production" : "Preview"}{index === 0 && deployment.status === "Ready" && deployment.project === "production" ? " · Current" : ""}</span>
      </div>
      <div className="row-meta muted">
        {deployment.commitSha && <span className="mono">{deployment.commitSha.slice(0, 7)}</span>}
        <span>{deployment.time}</span>
      </div>
      <div className="row-actions">
        <button className="btn btn-ghost btn-sm" onClick={() => onLogs(deployment.id)}>Logs</button>
        {deployment.canRollback && index > 0 && <button className="btn btn-ghost btn-sm" onClick={() => onRollback(deployment.id)} disabled={rollbackId !== null}>{rollbackId === deployment.id ? "Rolling back…" : "Roll back"}</button>}
      </div>
    </div>;
  })}</div>;
}
