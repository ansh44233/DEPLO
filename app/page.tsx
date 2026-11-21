"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { hasZipSignature, validateUploadSelection } from "@/lib/uploads/validate-upload";
import {
  Activity, ArrowDownToLine, ArrowUpRight, Bell, Check, ChevronDown,
  ChevronRight, CircleHelp, Clock3, Cloud, Code2, Command, ExternalLink,
  FileArchive, FileCode2, FolderGit2, Gauge, Github, Globe2, HardDrive,
  LayoutDashboard, LifeBuoy, MoreHorizontal, Plus, Search, Settings2,
  RefreshCw, RotateCcw, ShieldCheck, Sparkles, TerminalSquare, UploadCloud, X
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
};

type CloudflareDeploymentLog = { timestamp: string | null; line: string };
type WebhookDelivery = { delivery_id: string; repository_full_name: string; branch: string; commit_sha: string; status: "received" | "processing" | "deployed" | "ignored" | "failed"; received_at: string; processed_at: string | null; attempt_count: number; available_at: string; last_error_code: string | null; };

type CloudflareDeployment = {
  id: string;
  url: string;
  environment: string;
  createdAt: string | null;
  branch: string | null;
  commitMessage: string | null;
  status: "success" | "failure" | "building" | "unknown";
};

type SignedInUser = { id: number; login: string; name: string | null; avatarUrl: string | null };
type AccountProject = {
  id: string; name: string; slug: string; source_type: "github" | "zip" | "html";
  repository_url: string | null; branch: string | null; deployment_url: string | null;
  created_at: string; updated_at: string;
};

type Project = {
  id?: string;
  slug?: string;
  sourceType?: AccountProject["source_type"];
  name: string;
  domain: string;
  source: string;
  branch: string;
  status: "Healthy" | "Building" | "Failed" | "Connected";
  updated: string;
  accent: string;
};

const initialProjects: Project[] = [
  { name: "frontend", domain: "frontend-deplo.pages.dev", source: "github.com/ansh44233/frontend", branch: "main", status: "Healthy", updated: "4 min ago", accent: "violet" },
  { name: "docs-site", domain: "docs-site-deplo.pages.dev", source: "ZIP upload", branch: "production", status: "Healthy", updated: "Yesterday", accent: "blue" },
  { name: "portfolio", domain: "portfolio-deplo.pages.dev", source: "index.html", branch: "—", status: "Healthy", updated: "2 days ago", accent: "pink" },
];



export default function Home() {
  const [activeProject, setActiveProject] = useState("frontend");
  const [activeNav, setActiveNav] = useState("Overview");
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
  const [signedInUser, setSignedInUser] = useState<SignedInUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState("");
  const [projectSaving, setProjectSaving] = useState(false);
  const [projectDeploying, setProjectDeploying] = useState(false);
  const [projectDeleting, setProjectDeleting] = useState(false);
  const [rollbackDeploymentId, setRollbackDeploymentId] = useState<string | null>(null);
  const [logsDeploymentId, setLogsDeploymentId] = useState<string | null>(null);
  const [deploymentLogs, setDeploymentLogs] = useState<CloudflareDeploymentLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState("");

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
          name: project.name,
          domain: project.deployment_url || "Not deployed yet",
          source: project.source_type === "github"
            ? project.repository_url?.replace("https://", "") || "GitHub repository"
            : project.source_type === "zip" ? "ZIP upload" : "index.html",
          branch: project.branch || "—",
          status: project.deployment_url ? "Healthy" : "Connected",
          updated: new Date(project.updated_at).toLocaleString(),
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
    if (appResult === "connected") setNotice("GitHub App installed and linked to your DEPLO account. Private auto-deploy worker integration is the next step.");
    if (appResult === "error") setNotice("GitHub App installation could not be linked. Check the app setup URL, private key, and database migration.");
    if (appResult === "cancelled") setNotice("GitHub App installation was cancelled.");
    if (appResult === "signin_required") setNotice("Sign in with GitHub before installing the DEPLO GitHub App.");
    if (authResult || appResult) window.history.replaceState({}, "", window.location.pathname);
    return () => { cancelled = true; };
  }, []);

  async function signOut() {
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Sign-out failed.");
      setSignedInUser(null);
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
  useEffect(() => {
    void refreshDeploymentHistory(selected.id, Boolean(signedInUser));
  }, [refreshDeploymentHistory, selected.id, signedInUser]);

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

  async function deploySelectedProject() {
    if (!selected.id || selected.sourceType !== "github" || !signedInUser || projectDeploying) return;
    setProjectDeploying(true);
    setNotice("");
    try {
      const response = await fetch("/api/projects/" + encodeURIComponent(selected.id) + "/deploy", { method: "POST" });
      const data = await response.json() as { url?: string; error?: string };
      if (!response.ok) throw new Error(data.error || "Project deployment failed.");
      setProjects((current) => current.map((project) => project.id === selected.id
        ? { ...project, domain: data.url || project.domain, status: "Healthy", updated: "Just now" }
        : project));
      setNotice(data.url ? "Deployment published: " + data.url : "Deployment completed.");
      await refreshDeploymentHistory(selected.id, true);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Project deployment failed.");
    } finally {
      setProjectDeploying(false);
    }
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
          ? { ...project, domain: data.url || project.domain, status: "Healthy", updated: "Just now" }
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
    branch: deployment.branch || "—",
    time: deployment.createdAt ? new Date(deployment.createdAt).toLocaleString() : "—",
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
      source: "github.com/" + repoInfo.fullName, branch: repoBranch,
      status: "Connected", updated: "Just now", accent: "violet",
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
        setActiveNav("Projects");
        setNotice("Project saved to your GitHub account. It has not been deployed yet.");
        setModal(null);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Could not save this project.");
      } finally {
        setProjectSaving(false);
      }
      return;
    }
    setProjects((current) => [newProject, ...current.filter((project) => project.name !== projectName)]);
    setActiveProject(projectName); setActiveNav("Projects");
    setNotice("Repository added to this dashboard preview. Sign in and configure Supabase to save projects to your account.");
    setModal(null);
  }

  async function startUpload(file: File | undefined, kind: "zip" | "html") {
    if (!file) return;
    setUploadError("");
    const validationError = validateUploadSelection(file.name, file.size, kind);
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
      if (!/<html[\\s>]/i.test(html) && !/<!doctype\\s+html/i.test(html)) {
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

    const baseName = file.name.replace(/\\.[^.]+$/, "").trim().slice(0, 60) || "Uploaded site";
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
        updated: new Date(savedAccountProject.updated_at).toLocaleString(),
        accent: "violet",
      };
      setProjects((current) => [previewProject, ...current.filter((project) => project.id !== previewProject.id)]);

      const form = new FormData();
      form.append("file", file);
      const uploadResponse = await fetch("/api/projects/" + encodeURIComponent(savedAccountProject.id) + "/upload", {
        method: "POST",
        body: form,
      });
      const uploadData = await uploadResponse.json() as { url?: string; error?: string };
      if (!uploadResponse.ok) throw new Error(uploadData.error || "Upload deployment failed.");

      const deployedProject: Project = {
        ...previewProject,
        domain: uploadData.url || previewProject.domain,
        status: "Healthy",
        updated: "Just now",
      };
      setProjects((current) => [deployedProject, ...current.filter((project) => project.id !== deployedProject.id)]);
      setActiveProject(deployedProject.name);
      setActiveNav("Projects");
      setNotice(uploadData.url ? "Your site is live: " + uploadData.url : "Upload deployment completed.");
      setModal(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Upload deployment failed.");
    } finally {
      setProjectSaving(false);
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="DEPLO home">
          <img className="brand-logo" src="/deplo-mark.svg" alt="" />
          <span>deplo</span>
          <span className="brand-beta">BETA</span>
        </a>

        <button className="workspace-switcher">
          <span className="workspace-avatar">A</span>
          <span className="workspace-copy"><strong>Personal workspace</strong><small>Free plan</small></span>
          <ChevronDown size={15} />
        </button>

        <div className="side-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {[
            { label: "Overview", icon: LayoutDashboard },
            { label: "Projects", icon: FolderGit2 },
            { label: "Deployments", icon: Cloud },
            { label: "Analytics", icon: Gauge },
          ].map(({ label, icon: Icon }) => (
            <button key={label} className={`nav-item ${activeNav === label ? "active" : ""}`} onClick={() => setActiveNav(label)}>
              <Icon size={17} /><span>{label}</span>
              {label === "Deployments" && <span className="nav-count">{cloudflareDeployments.length}</span>}
            </button>
          ))}
        </nav>

        <div className="side-label side-label-spaced">DEVELOP</div>
        <nav className="side-nav" aria-label="Developer navigation">
          <button className="nav-item" onClick={() => setNotice("Domains will be available when custom-domain support is connected.")}><Globe2 size={17} /><span>Domains</span></button>
          <button className="nav-item" onClick={() => setNotice("Storage settings are coming in a later release.")}><HardDrive size={17} /><span>Storage</span></button>
          <button className="nav-item" onClick={() => setNotice("Environment variables are planned for the next milestone.")}><Settings2 size={17} /><span>Environment</span></button>
        </nav>

        <div className="sidebar-bottom">
          <div className="usage-card">
            <div className="usage-top"><span>Workspace mode</span><span>Preview</span></div>
            <div className="preview-note">Sample projects · live deployment history</div>
            <small>No builds or hosting usage are being counted yet.</small>
            <button onClick={() => setNotice("Billing and usage tracking will be configured after a deployment provider is connected.")}>About preview <ArrowUpRight size={13} /></button>
          </div>
          <button className="nav-item"><CircleHelp size={17} /><span>Help & support</span></button>
          <button className="nav-item"><Settings2 size={17} /><span>Settings</span></button>
          <div className="profile-row">
            <div className="profile-avatar">A</div>
            <div className="profile-copy"><strong>Workspace owner</strong><small>Personal account</small></div>
            <MoreHorizontal size={18} />
          </div>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><ChevronRight size={14} /><strong>{activeNav}</strong></div>
          <div className="topbar-actions">
            <div className="status-pill preview-pill"><span className="status-dot preview-dot" /> Preview environment</div>
            <button className="icon-button" aria-label="Search" onClick={() => document.getElementById("project-search")?.focus()}><Search size={17} /></button>
            <button className="icon-button notification-button" aria-label="Notifications"><Bell size={17} /><i /></button>
            {authLoading ? <span className="top-avatar">…</span> : signedInUser ? <button className="text-button" onClick={() => void signOut()} title={signedInUser.login}>Sign out</button> : <a className="text-button" href="/api/auth/github"><Github size={14} /> Sign in with GitHub</a>}
          </div>
        </header>

        <div className="content">
          <div className="welcome-row">
            <div>
              <div className="eyebrow"><Sparkles size={13} /> DEPLO · WORKSPACE PREVIEW</div>
              <h1>{activeNav === "Overview" ? "Good afternoon." : activeNav}</h1>
              <p className="page-subtitle">Manage projects and inspect deployment activity from your connected provider.</p>
            </div>
            <button className="primary-button" onClick={() => setModal("github")}><Plus size={17} /> New project</button>
          </div>

          {notice && <div className="notice"><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss"><X size={15} /></button></div>}

          <section className={`provider-readiness ${readiness?.ready ? "is-ready" : "is-pending"}`} aria-live="polite">
            <div className="provider-readiness-icon"><ShieldCheck size={17} /></div>
            <div className="provider-readiness-copy">
              <strong>{readinessLoading ? "Checking deployment provider…" : readinessError ? "Provider status unavailable" : readiness?.ready ? "Cloudflare Pages is configured" : "Cloudflare Pages setup required"}</strong>
              <span>{readinessLoading ? "Reading server configuration." : readinessError ? readinessError : readiness?.ready ? "Required settings are present. Provider credentials have not been verified." : `Missing or invalid settings: ${readiness?.missing.join(", ") || "upload authentication token"}.`}</span>
            </div>
            <span className="provider-readiness-state">{readinessLoading ? "CHECKING" : readinessError ? "UNKNOWN" : readiness?.ready ? "CONFIGURED" : "NOT READY"}</span>
          </section>

          <div className="stats-grid">
            <Stat icon={<FolderGit2 size={17} />} label="Total projects" value={String(projects.length).padStart(2, "0")} detail={signedInUser ? "Saved to your account" : "Preview workspace"} />
            <Stat icon={<Cloud size={17} />} label="Deployments" value={String(cloudflareDeployments.length).padStart(2, "0")} detail={historyLoading ? "Loading provider records" : historyError ? "Provider history unavailable" : "Cloudflare Pages records"} />
            <Stat icon={<Activity size={17} />} label="Live deployments" value={String(cloudflareDeployments.filter((deployment) => deployment.status === "success").length).padStart(2, "0")} detail="Successful provider deployments" />
            <Stat icon={<Gauge size={17} />} label="Build pipeline" value="—" detail="Not configured yet" />
          </div>

          <div className="dashboard-grid">
            <section className="panel projects-panel">
              <div className="panel-heading">
                <div><h2>Your projects</h2><p>Manage your deployed applications.</p></div>
                <button className="text-button" onClick={() => setActiveNav("Projects")}>View all <ArrowUpRight size={14} /></button>
              </div>
              <div className="project-toolbar">
                <div className="search-field"><Search size={15} /><input id="project-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search projects..." /></div>
                <button className="filter-button"><span>All projects</span><ChevronDown size={14} /></button>
              </div>
              {projectsError && <div className="repo-error" role="alert">{projectsError}</div>}
              <div className="project-list">
                {projectsLoading && <div className="empty-state">Loading your saved projects…</div>}
                {!projectsLoading && filteredProjects.map((project) => (
                  <button key={project.name} className={`project-row ${activeProject === project.name ? "selected" : ""}`} onClick={() => setActiveProject(project.name)}>
                    <div className={`project-icon ${project.accent}`}><Code2 size={18} /></div>
                    <div className="project-main"><strong>{project.name}</strong><small>{project.source}</small></div>
                    <div className="project-domain"><span>{project.domain}</span><small>{project.updated}</small></div>
                    <span className={`health-tag ${project.status.toLowerCase()}`}><i />{project.status}</span>
                    <ChevronRight className="row-chevron" size={16} />
                  </button>
                ))}
                {!projectsLoading && !projectsError && filteredProjects.length === 0 && <div className="empty-state">{signedInUser ? "No saved projects yet. Import a repository to get started." : "No projects match your search."}</div>}
              </div>
              <button className="add-project-row" onClick={() => setModal("github")}><Plus size={16} /> Add a project</button>
            </section>

            <section className="panel selected-panel">
              <div className="panel-heading">
                <div><div className="section-kicker">SELECTED PROJECT</div><h2>{selected.name}</h2></div>
                {selected.id && signedInUser && <button className="text-button" onClick={() => void deleteSelectedProject()} disabled={projectDeleting}>{projectDeleting ? "Deleting…" : "Delete project"}</button>}
              </div>
              <div className="selected-domain"><Globe2 size={15} /><span>{selected.domain}</span><ExternalLink size={13} /></div>
              <div className="selected-status"><span className={"status-dot " + (selected.status === "Connected" ? "status-dot-idle" : "")} /> {selected.status === "Connected" ? "Repository connected · not deployed" : "Production deployment is healthy"}</div>
              <div className="project-details">
                <Detail label="Production branch" value={selected.branch} icon={<Github size={15} />} />
                <Detail label="Latest deployment" value={selected.updated} icon={<Clock3 size={15} />} />
                <Detail label="Source" value={selected.source} icon={<FolderGit2 size={15} />} />
              </div>
              {selected.id && selected.sourceType === "github" && <button className="primary-button deploy-project-button" onClick={() => void deploySelectedProject()} disabled={projectDeploying || !readiness?.ready}>{projectDeploying ? "Deploying…" : "Deploy to Cloudflare Pages"} <ArrowUpRight size={14} /></button>}
              <button className="outline-button" onClick={() => setNotice(`Project settings for ${selected.name} will be available in a later milestone.`)}>Project settings <ArrowUpRight size={14} /></button>
            </section>
          </div>

          <section className="panel webhook-panel">
            <div className="panel-heading">
              <div><h2>GitHub push activity</h2><p>{webhookLoading ? "Loading verified webhook deliveries…" : webhookError ? webhookError : selected.sourceType !== "github" ? "Connect a GitHub repository to inspect automatic redeployments." : webhookDeliveries.length ? "Verified pushes and automatic deployment retry activity for this repository." : "No GitHub push deliveries have been recorded for this repository yet."}</p></div>
              <button className="text-button" onClick={() => void refreshWebhookDeliveries(selected.id, Boolean(signedInUser) && selected.sourceType === "github")} disabled={webhookLoading || !selected.id || !signedInUser || selected.sourceType !== "github"}><RefreshCw size={14} className={webhookLoading ? "spin" : ""} /> {webhookLoading ? "Refreshing…" : "Refresh"}</button>
            </div>
            {!signedInUser ? <div className="empty-state">Sign in with GitHub to view delivery activity for your own projects.</div>
              : webhookError ? <div className="webhook-error" role="alert">{webhookError}</div>
              : webhookLoading && webhookDeliveries.length === 0 ? <div className="empty-state">Loading GitHub delivery activity…</div>
              : webhookDeliveries.length ? <div className="webhook-list">
                {webhookDeliveries.map((delivery) => {
                  const statusLabel = delivery.status === "received" ? (delivery.attempt_count > 0 ? "Retry queued" : "Queued") : delivery.status === "processing" ? "Deploying" : delivery.status === "deployed" ? "Deployed" : delivery.status === "ignored" ? "Ignored" : "Failed";
                  const statusClass = delivery.status === "deployed" ? "healthy" : delivery.status === "failed" ? "failed" : delivery.status === "processing" ? "building" : "queued";
                  return <div className="webhook-row" key={delivery.delivery_id}>
                    <div className="webhook-row-main">
                      <span className={"health-tag " + statusClass}><i />{statusLabel}</span>
                      <strong>{delivery.repository_full_name}</strong>
                      <span className="branch-chip"><Github size={11} /> {delivery.branch}</span>
                      <code>{delivery.commit_sha.slice(0, 7)}</code>
                    </div>
                    <div className="webhook-row-meta">
                      <span>{delivery.attempt_count} {delivery.attempt_count === 1 ? "attempt" : "attempts"}</span>
                      <span>Received {new Date(delivery.received_at).toLocaleString()}</span>
                      {delivery.status === "received" && delivery.attempt_count > 0 && <span>Next retry {new Date(delivery.available_at).toLocaleString()}</span>}
                      {delivery.last_error_code && <span className="webhook-error-code">Error: {delivery.last_error_code}</span>}
                    </div>
                  </div>;
                })}
              </div>
              : <div className="empty-state">{selected.sourceType === "github" ? "Push to the connected repository branch to create a delivery record." : "This project does not use GitHub webhooks."}</div>}
            <div className="webhook-footnote"><ShieldCheck size={13} /> Delivery details are scoped to this signed-in project owner. Secrets and raw webhook payloads are never shown.</div>
          </section>
          <section className="panel deployments-panel">
            <div className="panel-heading">
              <div><h2>Deployment history</h2><p>{historyLoading ? "Loading Cloudflare Pages deployments…" : historyError ? historyError : cloudflareDeployments.length ? "Latest deployments from your Cloudflare Pages project." : "No deployments found in the configured Cloudflare Pages project."}</p></div>
              <button className="text-button" onClick={() => void refreshDeploymentHistory(selected.id, Boolean(signedInUser))} disabled={historyLoading}><RefreshCw size={14} className={historyLoading ? "spin" : ""} /> {historyLoading ? "Refreshing…" : "Refresh"}</button>
            </div>
            <div className="deployment-table-wrap">
              <table className="deployment-table">
                <thead><tr><th>PROJECT</th><th>DEPLOYMENT</th><th>BRANCH</th><th>STATUS</th><th>TIME</th><th>ACTIONS</th></tr></thead>
                <tbody>
                  {displayDeployments.map((deployment) => (
                    <tr key={deployment.id}>
                      <td><span className="table-project-icon"><Code2 size={14} /></span><strong>{deployment.project}</strong></td>
                      <td><span className="deployment-message">{deployment.message}</span><small>{deployment.id}</small></td>
                      <td><span className="branch-chip"><Github size={12} /> {deployment.branch}</span></td>
                      <td><span className={`health-tag ${deployment.status === "Ready" ? "healthy" : deployment.status.toLowerCase()}`}><i />{deployment.status}</span></td>
                      <td><span className="time-cell">{deployment.time}</span><small>{deployment.duration === "Cloudflare" ? "Provider" : `${deployment.duration} build`}</small></td>
                      <td>
                        <div className="table-actions">
                          <button className="icon-button table-more" onClick={() => void openDeploymentLogs(deployment.id)} title="View deployment logs" aria-label={`View logs for ${deployment.id}`}>
                            <TerminalSquare size={15} />
                          </button>
                          {deployment.canRollback && <button className="icon-button table-more" onClick={() => void rollbackSelectedDeployment(deployment.id)} disabled={rollbackDeploymentId !== null} title="Roll back production to this deployment" aria-label={`Roll back to ${deployment.id}`}>
                            <RotateCcw size={15} className={rollbackDeploymentId === deployment.id ? "spin" : ""} />
                          </button>}
                          <a className="icon-button table-more" href={deployment.url} target="_blank" rel="noreferrer" aria-label={`Open ${deployment.id}`}><ExternalLink size={15} /></a>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!historyLoading && !historyError && displayDeployments.length === 0 && <tr><td colSpan={6}><div className="empty-state">No Cloudflare deployments are available yet.</div></td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <footer className="footer"><span>DEPLO <span className="footer-muted">· Developer infrastructure, made simple.</span></span><span><span className="footer-live" /> Preview interface <span className="footer-separator">·</span> v0.1.0</span></footer>
        </div>
      </section>

      {modal && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}>
        <div className="modal">
          <div className="modal-head"><div><div className="eyebrow">NEW PROJECT</div><h2>Bring your code.</h2><p>Choose how you'd like to get started.</p></div><button className="icon-button" onClick={() => setModal(null)} aria-label="Close"><X size={18} /></button></div>
          {modal === "github" ? <div className="modal-options">
            <button className="source-option" onClick={() => { setRepoInfo(null); setRepoError(""); setRepoUrl(""); setModal("repo"); }}><span className="source-icon github-source"><Github size={20} /></span><span><strong>Import Git Repository</strong><small>Connect GitHub and deploy from a branch.</small></span><ArrowUpRight size={16} /></button>
            <button className="source-option" onClick={() => setModal("upload")}><span className="source-icon"><FileArchive size={20} /></span><span><strong>Upload a ZIP file</strong><small>Upload your project as a .zip archive.</small></span><ArrowUpRight size={16} /></button>
            <button className="source-option" onClick={() => setModal("html")}><span className="source-icon"><FileCode2 size={20} /></span><span><strong>Deploy a static HTML file</strong><small>Start with an index.html file.</small></span><ArrowUpRight size={16} /></button>
          </div> : modal === "repo" ? <div className="repo-connect">
            <label className="repo-label" htmlFor="repo-url">GitHub repository URL (public or private)</label>
            <div className="repo-input-row"><input id="repo-url" value={repoUrl} onChange={(event) => setRepoUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void inspectRepository(); }} placeholder="https://github.com/owner/repository" /><button className="primary-button" onClick={() => void inspectRepository()} disabled={repoLoading || !repoUrl.trim()}>{repoLoading ? "Checking…" : "Find repository"}</button></div>
            <p className="repo-help">DEPLO can inspect public repositories and private repositories your signed-in GitHub account can access.</p>
            {repoError && <div className="repo-error" role="alert">{repoError}</div>}
            {repoInfo && <div className="repo-result">
              <div className="repo-result-top"><span className="source-icon github-source"><Github size={19} /></span><div><strong>{repoInfo.fullName}</strong><small>{repoInfo.description || "No repository description"}</small></div></div>
              <div className="repo-meta"><span>{repoInfo.language || "Unknown language"}</span><span>★ {repoInfo.stars.toLocaleString()} stars</span><span>{repoInfo.branches.length} branches listed</span></div>
              <label className="repo-label" htmlFor="repo-branch">Deployment branch</label>
              <select id="repo-branch" value={repoBranch} onChange={(event) => setRepoBranch(event.target.value)}>{repoInfo.branches.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}{branch.name === repoInfo.defaultBranch ? " (default)" : ""}</option>)}</select>
              <button className="primary-button repo-confirm" onClick={() => void addRepositoryPreview()} disabled={projectSaving}>{projectSaving ? "Saving project…" : signedInUser ? "Save project to account" : "Add repository to dashboard"} <ArrowUpRight size={15} /></button>
              <p className="repo-help">{signedInUser ? "This saves repository metadata to your account. Deployment and automatic redeploys are separate steps." : "This adds a temporary preview entry. Sign in to save projects to an account."}</p>
            </div>}
          </div> : <div className="upload-zone"><input type="file" disabled={projectSaving} accept={modal === "upload" ? ".zip,application/zip" : ".html,text/html"} onChange={(event) => void startUpload(event.target.files?.[0], modal === "upload" ? "zip" : "html")} /><div className="upload-icon"><UploadCloud size={24} /></div><strong>{fileName || (modal === "upload" ? "Choose a ZIP archive" : "Choose index.html")}</strong><span>{modal === "upload" ? "ZIP archive · maximum 25 MB" : "HTML document · maximum 2 MB"}</span>{uploadError && <p className="repo-error" role="alert">{uploadError}</p>}<button className="primary-button" disabled={projectSaving} onClick={() => document.querySelector<HTMLInputElement>(".upload-zone input")?.click()}>{projectSaving ? "Uploading and deploying…" : <><ArrowDownToLine size={16} /> Browse files</>}</button></div>}
          <div className="modal-foot"><ShieldCheck size={14} /> {signedInUser ? "Uploads are saved to your account and published through your configured provider." : "Sign in with GitHub to save uploads and deploy them to your account."}</div>
        </div>
      </div>}
      {logsDeploymentId && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setLogsDeploymentId(null); }}>
        <section className="modal logs-modal" role="dialog" aria-modal="true" aria-labelledby="deployment-logs-title">
          <div className="modal-head">
            <div><div className="eyebrow">DEPLOYMENT OUTPUT</div><h2 id="deployment-logs-title">Deployment logs</h2><p>{logsDeploymentId}</p></div>
            <button className="icon-button" onClick={() => setLogsDeploymentId(null)} aria-label="Close deployment logs"><X size={18} /></button>
          </div>
          {logsLoading ? <div className="empty-state">Loading deployment logs…</div>
            : logsError ? <div className="repo-error" role="alert">{logsError}</div>
            : deploymentLogs.length ? <div className="logs-output">{deploymentLogs.map((log, index) => <div className="log-line" key={logsDeploymentId + "-" + index}>
              <time>{log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : "—"}</time><code>{log.line}</code>
            </div>)}</div>
            : <div className="empty-state">No log lines are available for this deployment.</div>}
          <div className="modal-foot"><ShieldCheck size={14} /> Logs are fetched from Cloudflare and are visible only to this project's owner.</div>
        </section>
      </div>}
    </main>
  );
}

function Stat({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail: string }) {
  return <div className="stat-card"><div className="stat-top"><span className="stat-icon">{icon}</span><span className="stat-label">{label}</span><MoreHorizontal size={16} className="stat-more" /></div><div className="stat-value">{value}</div><div className="stat-detail">{detail}</div></div>;
}
function Detail({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return <div className="detail-row"><span className="detail-label">{icon}{label}</span><strong>{value}</strong></div>;
}
