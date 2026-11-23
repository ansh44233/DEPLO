"use client";

import { useEffect, useMemo, useState } from "react";
import { useSpotlight } from "./fx";
import type { AccountProject, Project, ProjectTab, Modal } from "@/lib/dashboard/types";
import { timeAgo, stableSiteUrl, slugify } from "@/lib/dashboard/format";
import { initialProjects } from "@/lib/dashboard/constants";
import { hasZipSignature, validateUploadSelection } from "@/lib/uploads/validate-upload";
import { buildPaletteItems, filterPaletteItems, type PaletteItem } from "@/lib/dashboard/palette";
import { useAuth } from "@/hooks/use-auth";
import { useBuildJobs } from "@/hooks/use-build-jobs";
import { useCustomDomains } from "@/hooks/use-custom-domains";
import { useDeploymentHistory } from "@/hooks/use-deployment-history";
import { useEnvVars } from "@/hooks/use-env-vars";
import { useNotice } from "@/hooks/use-notice";
import { useReadiness } from "@/hooks/use-readiness";
import { useRecoveryAttempts } from "@/hooks/use-recovery-attempts";
import { useRepoImport } from "@/hooks/use-repo-import";
import { useWebhookDeliveries } from "@/hooks/use-webhook-deliveries";
import { ActivityTab } from "@/components/dashboard/ActivityTab";
import { BuildLogDialog } from "@/components/dashboard/BuildLogDialog";
import { BuildsTab } from "@/components/dashboard/BuildsTab";
import { CommandPalette } from "@/components/dashboard/CommandPalette";
import { CommunityCard } from "@/components/dashboard/CommunityCard";
import { DeploymentLogsDialog } from "@/components/dashboard/DeploymentLogsDialog";
import { DeploymentsTab } from "@/components/dashboard/DeploymentsTab";
import { DomainsTab } from "@/components/dashboard/DomainsTab";
import { EnvironmentTab } from "@/components/dashboard/EnvironmentTab";
import { Footer } from "@/components/dashboard/Footer";
import { HomeView } from "@/components/dashboard/HomeView";
import { NewProjectDialog } from "@/components/dashboard/NewProjectDialog";
import { OverviewTab } from "@/components/dashboard/OverviewTab";
import { ProjectHeader } from "@/components/dashboard/ProjectHeader";
import { ProjectTabsNav } from "@/components/dashboard/ProjectTabsNav";
import { SettingsTab } from "@/components/dashboard/SettingsTab";
import { Toast } from "@/components/dashboard/Toast";
import { TopBar } from "@/components/dashboard/TopBar";

export default function Home() {
  useSpotlight();
  const [activeProject, setActiveProject] = useState("");
  const [activeNav, setActiveNav] = useState<"home" | "project">("home");
  const [projectTab, setProjectTab] = useState<ProjectTab>("overview");
  const [modal, setModal] = useState<Modal>(null);
  const [search, setSearch] = useState("");
  const [projects, setProjects] = useState(initialProjects);
  const [fileName, setFileName] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsFetched, setProjectsFetched] = useState(false);
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

  const { notice, setNotice } = useNotice();
  const { readiness, readinessLoading, readinessError } = useReadiness();
  const { signedInUser, setSignedInUser, githubAppStatus, setGithubAppStatus, githubAppStatusLoading, authLoading } = useAuth({ setNotice });

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
          domain: stableSiteUrl(project.deployment_url) || "Not deployed yet",
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
      .finally(() => { if (!cancelled) { setProjectsLoading(false); setProjectsFetched(true); } });
    return () => { cancelled = true; };
  }, [signedInUser]);

  const selected = projects.find((project) => project.name === activeProject) ?? projects[0] ?? {
    name: "No project selected", domain: "—", source: "—", branch: "—",
    status: "Connected" as const, updated: "—", accent: "violet",
  };
  useEffect(() => { setProjectNameInput(selected.name); }, [selected.id, selected.name]);

  const history = useDeploymentHistory({ selected, signedInUser });
  const { cloudflareDeployments, setCloudflareDeployments, refreshDeploymentHistory, setLogsDeploymentId, setDeploymentLogs } = history;
  const domains = useCustomDomains({ selected, signedInUser, setNotice });
  const webhooks = useWebhookDeliveries({ selected, signedInUser });
  const recovery = useRecoveryAttempts({ selected, signedInUser });
  const builds = useBuildJobs({ selected, signedInUser, setNotice });
  const repo = useRepoImport({ signedInUser, modal });
  const { repoInfo, repoBranch, importEnvText, setImportEnvText } = repo;
  const env = useEnvVars({ selected, signedInUser, projectTab, setNotice });

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

  async function deploySelectedProject(target?: { id: string }) {
    const projectId = target?.id ?? selected.id;
    if (!projectId || (!target && selected.sourceType !== "github") || !signedInUser || projectDeploying) return;
    setProjectDeploying(true);
    setDeployStartedAt(Date.now());
    setDeployResult(null);
    setNotice("");
    try {
      const response = await fetch("/api/projects/" + encodeURIComponent(projectId) + "/deploy", { method: "POST" });
      const data = await response.json().catch(() => ({})) as { url?: string; error?: string; buildLog?: string; build?: { framework: string; outputDirectory: string; log: string } | null };
      if (!response.ok) {
        const message = data.error || (response.status === 504 ? "The deployment took longer than the server allows. Try again; a second build is usually faster." : "Deployment failed with HTTP " + response.status + ".");
        setDeployResult({ ok: false, message, log: data.buildLog ?? null });
        throw new Error(message);
      }
      setProjects((current) => current.map((project) => project.id === projectId
        ? { ...project, domain: data.url || project.domain, status: "Healthy", updated: "just now" }
        : project));
      setDeployResult({ ok: true, message: data.build ? "Built with " + data.build.framework + " and published." : "Published.", log: data.build?.log ?? null });
      setNotice(data.url ? "Deployed: " + data.url : "Deployment completed.");
      await refreshDeploymentHistory(projectId, true);
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

  async function addRepositoryPreview(deployNow = false) {
    if (!repoInfo) return;
    const projectName = repoInfo.fullName.split("/")[1].toLowerCase();
    const slug = slugify(projectName);
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
        if (importEnvText.trim()) {
          const envResponse = await fetch("/api/projects/" + encodeURIComponent(data.project.id) + "/env", {
            method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dotenv: importEnvText }),
          });
          if (!envResponse.ok) {
            const envData = await envResponse.json().catch(() => ({})) as { error?: string };
            setNotice("Imported, but the environment variables were not saved: " + (envData.error || "HTTP " + envResponse.status));
          }
        }
        setProjects((current) => [savedProject, ...current.filter((project) => project.name !== projectName)]);
        setActiveProject(projectName);
        setActiveNav("project"); setProjectTab("overview");
        setImportEnvText("");
        setModal(null);
        if (deployNow && readiness?.ready) {
          setProjectSaving(false);
          void deploySelectedProject({ id: data.project.id });
        } else {
          setNotice("Imported " + projectName + ". Press Deploy to publish it.");
        }
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
    // Files above the host's request limit are uploaded straight to private storage instead.
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
    const slug = slugify(baseName) || "uploaded-site";
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
        domain: stableSiteUrl(savedAccountProject.deployment_url) || "Not deployed yet",
        source: kind === "zip" ? "ZIP upload" : "index.html",
        branch: "—",
        status: savedAccountProject.deployment_url ? "Healthy" : "Connected",
        updated: timeAgo(savedAccountProject.updated_at),
        accent: "violet",
      };
      setProjects((current) => [previewProject, ...current.filter((project) => project.id !== previewProject.id)]);

      const uploadEndpoint = "/api/projects/" + encodeURIComponent(savedAccountProject.id) + "/upload";
      let uploadResponse: Response;
      if (hostLimit && file.size > hostLimit) {
        setNotice("Uploading " + (file.size / 1024 / 1024).toFixed(1) + " MB to private storage…");
        const linkResponse = await fetch("/api/projects/" + encodeURIComponent(savedAccountProject.id) + "/upload-url", { method: "POST" });
        const link = await linkResponse.json().catch(() => ({})) as { uploadUrl?: string; path?: string; error?: string };
        if (!linkResponse.ok || !link.uploadUrl || !link.path) throw new Error(link.error || "Could not start the upload.");
        const body = new FormData();
        body.append("cacheControl", "60");
        body.append("", file);
        const put = await fetch(link.uploadUrl, { method: "PUT", body });
        if (!put.ok) throw new Error("The file could not be uploaded to storage (HTTP " + put.status + ").");
        setNotice(kind === "zip" ? "Uploaded. Building and deploying…" : "Uploaded. Deploying…");
        uploadResponse = await fetch(uploadEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stagedPath: link.path, fileName: file.name }),
        });
      } else {
        const form = new FormData();
        form.append("file", file);
        uploadResponse = await fetch(uploadEndpoint, { method: "POST", body: form });
      }
      if (uploadResponse.status === 413) throw new Error("This upload is larger than the host allows. Deploy larger sites from GitHub instead.");
      const uploadData = await uploadResponse.json().catch(() => ({})) as { url?: string; error?: string; buildLog?: string; build?: { framework: string; log: string } | null };
      if (!uploadResponse.ok) {
        if (uploadData.buildLog) setDeployResult({ ok: false, message: uploadData.error || "The build failed.", log: uploadData.buildLog });
        throw new Error(uploadData.error || "Upload deployment failed (HTTP " + uploadResponse.status + ").");
      }
      if (uploadData.build) setDeployResult({ ok: true, message: "Built with " + uploadData.build.framework + " and published.", log: uploadData.build.log });

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
    if (!deployStartedAt) { setDeployElapsed(0); return; }
    const timer = window.setInterval(() => setDeployElapsed(Math.round((Date.now() - deployStartedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [deployStartedAt]);

  useEffect(() => { setDeployResult(null); }, [selected.id]);

  useEffect(() => {
    let dismissed = false;
    try { dismissed = window.localStorage.getItem("deplo:community-dismissed") === "1"; } catch { /* private mode */ }
    if (dismissed) return;
    if (!window.matchMedia("(max-width: 640px)").matches) { setCommunityHidden(false); return; }
    // On phones the compact strip arrives a moment after load, or as soon as the visitor scrolls.
    const show = () => { setCommunityHidden(false); window.removeEventListener("scroll", show); window.clearTimeout(timer); };
    const timer = window.setTimeout(show, 2500);
    window.addEventListener("scroll", show, { passive: true, once: true });
    return () => { window.clearTimeout(timer); window.removeEventListener("scroll", show); };
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

  const paletteItems = buildPaletteItems({
    activeNav, selected, isDeployed, readiness, projects, signedInUser, githubAppStatus,
    openNewProject: () => setModal("github"),
    goHome,
    deploySelectedProject: () => void deploySelectedProject(),
    setProjectTab,
    openProject,
    signOut: () => void signOut(),
  });
  const paletteMatches = filterPaletteItems(paletteItems, paletteQuery);
  const runPalette = (item: PaletteItem | undefined) => { if (!item) return; setPaletteOpen(false); item.run(); };
  const dismissCommunity = () => { setCommunityHidden(true); try { window.localStorage.setItem("deplo:community-dismissed", "1"); } catch { /* private mode */ } };

  return (
    <div className="shell">
      <TopBar
        goHome={goHome} authLoading={authLoading} signedInUser={signedInUser} activeNav={activeNav} selected={selected}
        setPaletteQuery={setPaletteQuery} setPaletteOpen={setPaletteOpen}
        githubAppStatus={githubAppStatus} githubAppStatusLoading={githubAppStatusLoading} signOut={signOut}
      />

      {activeNav === "project" && <ProjectTabsNav projectTab={projectTab} setProjectTab={setProjectTab} hasActiveBuildJob={builds.hasActiveBuildJob} />}

      <main className="page">
        {providerBlocked && <div className="banner banner-warn" role="status">
          <strong>Deployments are paused.</strong> The server is missing {readiness?.missing.join(", ")}. Add {readiness && readiness.missing.length > 1 ? "them" : "it"} to the environment and redeploy DEPLO.
        </div>}

        {activeNav === "home" ? (
          <HomeView
            signedInUser={signedInUser} projects={projects} search={search} setSearch={setSearch} setModal={setModal}
            projectsError={projectsError} authLoading={authLoading} projectsLoading={projectsLoading || (Boolean(signedInUser) && !projectsFetched)}
            filteredProjects={filteredProjects} openProject={openProject}
          />
        ) : (
          <>
            <ProjectHeader
              goHome={goHome} selected={selected} isDeployed={isDeployed} projectDeploying={projectDeploying} deployElapsed={deployElapsed}
              readiness={readiness} deploySelectedProject={deploySelectedProject} deployResult={deployResult}
              setBuildLogOpen={setBuildLogOpen} setDeployResult={setDeployResult}
            />

            {projectTab === "overview" && <OverviewTab
              selected={selected} isDeployed={isDeployed} projectDeploying={projectDeploying} readiness={readiness}
              deploySelectedProject={deploySelectedProject} deployElapsed={deployElapsed} setProjectTab={setProjectTab}
              latestDeployment={latestDeployment} displayDeployments={displayDeployments} signedInUser={signedInUser}
              rollbackSelectedDeployment={rollbackSelectedDeployment} rollbackDeploymentId={rollbackDeploymentId}
              domains={domains} history={history}
            />}
            {projectTab === "deployments" && <DeploymentsTab
              selected={selected} signedInUser={signedInUser} displayDeployments={displayDeployments}
              rollbackSelectedDeployment={rollbackSelectedDeployment} rollbackDeploymentId={rollbackDeploymentId} history={history}
            />}
            {projectTab === "builds" && <BuildsTab selected={selected} signedInUser={signedInUser} builds={builds} recovery={recovery} />}
            {projectTab === "environment" && <EnvironmentTab
              selected={selected} signedInUser={signedInUser} isDeployed={isDeployed} projectDeploying={projectDeploying}
              readiness={readiness} deploySelectedProject={deploySelectedProject} env={env}
            />}
            {projectTab === "domains" && <DomainsTab selected={selected} signedInUser={signedInUser} isDeployed={isDeployed} domains={domains} />}
            {projectTab === "activity" && <ActivityTab selected={selected} signedInUser={signedInUser} webhooks={webhooks} />}
            {projectTab === "settings" && <SettingsTab
              signedInUser={signedInUser} selected={selected} projectNameInput={projectNameInput} setProjectNameInput={setProjectNameInput}
              renameSelectedProject={renameSelectedProject} projectRenaming={projectRenaming} githubAppStatus={githubAppStatus}
              deleteSelectedProject={deleteSelectedProject} projectDeleting={projectDeleting}
            />}
          </>
        )}
      </main>

      <Footer readiness={readiness} readinessLoading={readinessLoading} readinessError={readinessError} />

      {notice && <Toast notice={notice} setNotice={setNotice} />}

      {modal && <NewProjectDialog
        modal={modal} setModal={setModal} setUploadError={setUploadError} setFileName={setFileName}
        signedInUser={signedInUser} projectSaving={projectSaving} readiness={readiness}
        addRepositoryPreview={addRepositoryPreview} projects={projects} startUpload={startUpload}
        fileName={fileName} uploadError={uploadError} repo={repo}
      />}

      {buildLogOpen && deployResult?.log && <BuildLogDialog message={deployResult.message} log={deployResult.log} setBuildLogOpen={setBuildLogOpen} setNotice={setNotice} />}

      {paletteOpen && <CommandPalette
        setPaletteOpen={setPaletteOpen} paletteQuery={paletteQuery} setPaletteQuery={setPaletteQuery}
        runPalette={runPalette} paletteMatches={paletteMatches}
      />}

      {!communityHidden && activeNav === "home" && <CommunityCard dismissCommunity={dismissCommunity} />}

      {history.logsDeploymentId && <DeploymentLogsDialog
        logsDeploymentId={history.logsDeploymentId} setLogsDeploymentId={history.setLogsDeploymentId}
        logsLoading={history.logsLoading} logsError={history.logsError} deploymentLogs={history.deploymentLogs}
      />}
    </div>
  );
}
