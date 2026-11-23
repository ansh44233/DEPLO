import { FileArchive, FileCode2, GitBranch, Github, Plus, Search } from "lucide-react";
import type { SignedInUser, Project, ProjectTab, Setter, Modal } from "@/lib/dashboard/types";
import { hostOf } from "@/lib/dashboard/format";
import { Landing } from "./Landing";

export function HomeView({ signedInUser, projects, search, setSearch, setModal, projectsError, authLoading, projectsLoading, filteredProjects, openProject }: { signedInUser: SignedInUser | null; projects: Project[]; search: string; setSearch: Setter<string>; setModal: Setter<Modal>; projectsError: string; authLoading: boolean; projectsLoading: boolean; filteredProjects: Project[]; openProject: (name: string, tab?: ProjectTab) => void }) {
  return (
    <>
      {(signedInUser || projects.length > 0) && <div className="home-head">
        <div>
          <p className="kicker">Your projects</p>
          <h1>{signedInUser ? "Welcome back, " + (signedInUser.name?.split(" ")[0] || signedInUser.login) : "Projects in this tab"}</h1>
        </div>
        <span className="mono muted">{projects.length} {projects.length === 1 ? "project" : "projects"} · {projects.filter((project) => /^https?:/.test(project.domain)).length} live</span>
      </div>}
      {(signedInUser || projects.length > 0) && <div className="toolbar">
        <label className="search">
          <Search size={16} aria-hidden="true" />
          <input id="project-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search projects" aria-label="Search projects" />
        </label>
        <button className="btn btn-primary" onClick={() => setModal("github")}><Plus size={16} /> Add new</button>
      </div>}

      {projectsError && <div className="banner banner-error" role="alert">{projectsError}</div>}

      {!authLoading && !signedInUser && projects.length === 0 ? (
          <Landing setModal={setModal} />
      ) : projectsLoading ? (
        <div className="grid tiles tiles-3">{[0, 1, 2].map((key) => <div className="tile card-skeleton" key={key} />)}</div>
      ) : filteredProjects.length === 0 ? (
        <section className="empty">
          <h2>{search ? "No projects match “" + search + "”" : "No projects yet"}</h2>
          <p>{search ? "Try a different name, or clear the search." : "Import a repository or upload a site to create your first project."}</p>
          {!search && <button className="btn btn-primary" onClick={() => setModal("github")}><Plus size={16} /> Add new project</button>}
        </section>
      ) : (
        <div className="grid tiles tiles-3">
          {filteredProjects.map((project) => {
            const live = /^https?:\/\//.test(project.domain);
            return (
              <button key={project.id ?? project.name} className="tile project-card" onClick={() => openProject(project.name)}>
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
    </>
  );
}
