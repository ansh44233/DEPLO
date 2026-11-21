"use client";

import { useMemo, useState } from "react";
import {
  Activity, ArrowDownToLine, ArrowUpRight, Bell, Check, ChevronDown,
  ChevronRight, CircleHelp, Clock3, Cloud, Code2, Command, ExternalLink,
  FileArchive, FileCode2, FolderGit2, Gauge, Github, Globe2, HardDrive,
  LayoutDashboard, LifeBuoy, MoreHorizontal, Plus, Search, Settings2,
  ShieldCheck, Sparkles, TerminalSquare, UploadCloud, X
} from "lucide-react";

type RepositoryInfo = {
  fullName: string; description: string | null; url: string; defaultBranch: string;
  stars: number; language: string | null; branches: { name: string; commit: string }[];
};

type Project = {
  name: string;
  domain: string;
  source: string;
  branch: string;
  status: "Healthy" | "Building" | "Failed";
  updated: string;
  accent: string;
};

const initialProjects: Project[] = [
  { name: "frontend", domain: "frontend-deplo.pages.dev", source: "github.com/ansh44233/frontend", branch: "main", status: "Healthy", updated: "4 min ago", accent: "violet" },
  { name: "docs-site", domain: "docs-site-deplo.pages.dev", source: "ZIP upload", branch: "production", status: "Healthy", updated: "Yesterday", accent: "blue" },
  { name: "portfolio", domain: "portfolio-deplo.pages.dev", source: "index.html", branch: "—", status: "Healthy", updated: "2 days ago", accent: "pink" },
];

const deployments = [
  { id: "dpl_8f31a2", project: "frontend", message: "Update hero section and navigation", branch: "main", time: "4 min ago", status: "Ready", duration: "38s" },
  { id: "dpl_71c0e9", project: "frontend", message: "Add responsive project cards", branch: "main", time: "Yesterday", status: "Ready", duration: "42s" },
  { id: "dpl_4a91bc", project: "docs-site", message: "Production upload", branch: "production", time: "Yesterday", status: "Ready", duration: "12s" },
  { id: "dpl_29de10", project: "portfolio", message: "Initial deployment", branch: "—", time: "2 days ago", status: "Ready", duration: "8s" },
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

  const selected = projects.find((project) => project.name === activeProject) ?? projects[0];
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

  function addRepositoryPreview() {
    if (!repoInfo) return;
    const projectName = repoInfo.fullName.split("/")[1].toLowerCase();
    const newProject: Project = {
      name: projectName, domain: "Not deployed yet",
      source: "github.com/" + repoInfo.fullName, branch: repoBranch,
      status: "Connected", updated: "Just now", accent: "violet",
    };
    setProjects((current) => [newProject, ...current.filter((project) => project.name !== projectName)]);
    setActiveProject(projectName); setActiveNav("Projects");
    setNotice("Repository added to this dashboard preview. It is not saved to an account or deployed yet.");
    setModal(null);
  }

  function startUpload(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setNotice(`${file.name} selected. Connect a deployment provider to publish it.`);
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
              {label === "Deployments" && <span className="nav-count">4</span>}
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
            <div className="usage-top"><span>Build minutes</span><span>18%</span></div>
            <div className="usage-track"><span /></div>
            <small>90 of 500 minutes used</small>
            <button onClick={() => setNotice("Plan management will be added after billing is configured.")}>View usage <ArrowUpRight size={13} /></button>
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
            <div className="status-pill"><span className="status-dot" /> All systems operational</div>
            <button className="icon-button" aria-label="Search" onClick={() => document.getElementById("project-search")?.focus()}><Search size={17} /></button>
            <button className="icon-button notification-button" aria-label="Notifications"><Bell size={17} /><i /></button>
            <div className="top-avatar">A</div>
          </div>
        </header>

        <div className="content">
          <div className="welcome-row">
            <div>
              <div className="eyebrow"><Sparkles size={13} /> YOUR DEPLOYMENT WORKSPACE</div>
              <h1>{activeNav === "Overview" ? "Good afternoon." : activeNav}</h1>
              <p className="page-subtitle">Everything you need to ship and manage your projects.</p>
            </div>
            <button className="primary-button" onClick={() => setModal("github")}><Plus size={17} /> New project</button>
          </div>

          {notice && <div className="notice"><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss"><X size={15} /></button></div>}

          <div className="stats-grid">
            <Stat icon={<FolderGit2 size={17} />} label="Total projects" value={String(projects.length).padStart(2, "0")} detail="+1 this week" />
            <Stat icon={<Cloud size={17} />} label="Deployments" value="24" detail="+8 this week" />
            <Stat icon={<Activity size={17} />} label="Success rate" value="98.4%" detail="Last 30 days" />
            <Stat icon={<Gauge size={17} />} label="Avg. build time" value="34s" detail="Across all projects" />
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
              <div className="project-list">
                {filteredProjects.map((project) => (
                  <button key={project.name} className={`project-row ${activeProject === project.name ? "selected" : ""}`} onClick={() => setActiveProject(project.name)}>
                    <div className={`project-icon ${project.accent}`}><Code2 size={18} /></div>
                    <div className="project-main"><strong>{project.name}</strong><small>{project.source}</small></div>
                    <div className="project-domain"><span>{project.domain}</span><small>{project.updated}</small></div>
                    <span className={`health-tag ${project.status.toLowerCase()}`}><i />{project.status}</span>
                    <ChevronRight className="row-chevron" size={16} />
                  </button>
                ))}
                {filteredProjects.length === 0 && <div className="empty-state">No projects match your search.</div>}
              </div>
              <button className="add-project-row" onClick={() => setModal("github")}><Plus size={16} /> Add a project</button>
            </section>

            <section className="panel selected-panel">
              <div className="panel-heading">
                <div><div className="section-kicker">SELECTED PROJECT</div><h2>{selected.name}</h2></div>
                <button className="icon-button subtle" aria-label="Project options"><MoreHorizontal size={18} /></button>
              </div>
              <div className="selected-domain"><Globe2 size={15} /><span>{selected.domain}</span><ExternalLink size={13} /></div>
              <div className="selected-status"><span className={"status-dot " + (selected.status === "Connected" ? "status-dot-idle" : "")} /> {selected.status === "Connected" ? "Repository connected · not deployed" : "Production deployment is healthy"}</div>
              <div className="project-details">
                <Detail label="Production branch" value={selected.branch} icon={<Github size={15} />} />
                <Detail label="Latest deployment" value={selected.updated} icon={<Clock3 size={15} />} />
                <Detail label="Source" value={selected.source} icon={<FolderGit2 size={15} />} />
              </div>
              <button className="outline-button" onClick={() => setNotice(`Project settings for ${selected.name} will be available in a later milestone.`)}>Project settings <ArrowUpRight size={14} /></button>
            </section>
          </div>

          <section className="panel deployments-panel">
            <div className="panel-heading">
              <div><h2>Recent deployments</h2><p>A timeline of what shipped to production.</p></div>
              <button className="text-button" onClick={() => setActiveNav("Deployments")}>Deployment history <ArrowUpRight size={14} /></button>
            </div>
            <div className="deployment-table-wrap">
              <table className="deployment-table">
                <thead><tr><th>PROJECT</th><th>DEPLOYMENT</th><th>BRANCH</th><th>STATUS</th><th>TIME</th><th /></tr></thead>
                <tbody>
                  {deployments.map((deployment) => (
                    <tr key={deployment.id}>
                      <td><span className="table-project-icon"><Code2 size={14} /></span><strong>{deployment.project}</strong></td>
                      <td><span className="deployment-message">{deployment.message}</span><small>{deployment.id}</small></td>
                      <td><span className="branch-chip"><Github size={12} /> {deployment.branch}</span></td>
                      <td><span className="health-tag healthy"><i />{deployment.status}</span></td>
                      <td><span className="time-cell">{deployment.time}</span><small>{deployment.duration} build</small></td>
                      <td><button className="icon-button table-more" aria-label={`More options for ${deployment.id}`}><MoreHorizontal size={17} /></button></td>
                    </tr>
                  ))}
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
            <label className="repo-label" htmlFor="repo-url">Public GitHub repository URL</label>
            <div className="repo-input-row"><input id="repo-url" value={repoUrl} onChange={(event) => setRepoUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void inspectRepository(); }} placeholder="https://github.com/owner/repository" /><button className="primary-button" onClick={() => void inspectRepository()} disabled={repoLoading || !repoUrl.trim()}>{repoLoading ? "Checking…" : "Find repository"}</button></div>
            <p className="repo-help">Public repositories are supported in this first integration step. Private repository OAuth is not connected yet.</p>
            {repoError && <div className="repo-error" role="alert">{repoError}</div>}
            {repoInfo && <div className="repo-result">
              <div className="repo-result-top"><span className="source-icon github-source"><Github size={19} /></span><div><strong>{repoInfo.fullName}</strong><small>{repoInfo.description || "No repository description"}</small></div></div>
              <div className="repo-meta"><span>{repoInfo.language || "Unknown language"}</span><span>★ {repoInfo.stars.toLocaleString()} stars</span><span>{repoInfo.branches.length} branches listed</span></div>
              <label className="repo-label" htmlFor="repo-branch">Deployment branch</label>
              <select id="repo-branch" value={repoBranch} onChange={(event) => setRepoBranch(event.target.value)}>{repoInfo.branches.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}{branch.name === repoInfo.defaultBranch ? " (default)" : ""}</option>)}</select>
              <button className="primary-button repo-confirm" onClick={addRepositoryPreview}>Add repository to dashboard <ArrowUpRight size={15} /></button>
              <p className="repo-help">This adds a preview entry only. Build execution, automatic deployments, and persistent account storage are upcoming steps.</p>
            </div>}
          </div> : <div className="upload-zone"><input type="file" accept={modal === "upload" ? ".zip,application/zip" : ".html,text/html"} onChange={(event) => startUpload(event.target.files?.[0])} /><div className="upload-icon"><UploadCloud size={24} /></div><strong>{fileName || (modal === "upload" ? "Choose a ZIP archive" : "Choose index.html")}</strong><span>{modal === "upload" ? "ZIP files up to your configured upload limit" : "A standalone HTML file"}</span><button className="primary-button" onClick={() => document.querySelector<HTMLInputElement>(".upload-zone input")?.click()}><ArrowDownToLine size={16} /> Browse files</button></div>}
          <div className="modal-foot"><ShieldCheck size={14} /> Your code stays yours. Provider connections are not configured yet.</div>
        </div>
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
