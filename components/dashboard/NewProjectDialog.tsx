import { ArrowLeft, FileArchive, FileCode2, Github, Loader2, Lock, Search, UploadCloud, X } from "lucide-react";
import type { DeploymentReadiness, SignedInUser, Project, Setter, Modal } from "@/lib/dashboard/types";
import { timeAgo } from "@/lib/dashboard/format";
import type { useRepoImport } from "@/hooks/use-repo-import";

export function NewProjectDialog({ modal, setModal, setUploadError, setFileName, signedInUser, projectSaving, readiness, addRepositoryPreview, projects, startUpload, fileName, uploadError, repo, githubAccess = "oauth" }: { githubAccess?: "app" | "oauth"; modal: NonNullable<Modal>; setModal: Setter<Modal>; setUploadError: Setter<string>; setFileName: Setter<string>; signedInUser: SignedInUser | null; projectSaving: boolean; readiness: DeploymentReadiness | null; addRepositoryPreview: (deployNow?: boolean) => Promise<void>; projects: Project[]; startUpload: (file: File | undefined, kind: "zip" | "html") => Promise<void>; fileName: string; uploadError: string; repo: ReturnType<typeof useRepoImport> }) {
  const { repoUrl, setRepoUrl, repoInfo, setRepoInfo, repoBranch, setRepoBranch, repoLoading, repoError, setRepoError, myRepos, myReposLoading, myReposError, repoQuery, setRepoQuery, showUrlImport, setShowUrlImport, importEnvText, setImportEnvText, inspectRepository } = repo;

  return (
    <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}>
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
                {repoInfo ? <div className="repo">
                  <button className="back" onClick={() => { setRepoInfo(null); setRepoError(""); }}><ArrowLeft size={14} /> Choose another repository</button>
                  <div className="repo-top"><Github size={18} /><div><strong>{repoInfo.fullName}</strong><span className="muted">{repoInfo.description || "No description"}</span></div></div>
                  <label className="field" htmlFor="repo-branch">Branch to deploy</label>
                  <select id="repo-branch" value={repoBranch} onChange={(event) => setRepoBranch(event.target.value)}>{repoInfo.branches.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}{branch.name === repoInfo.defaultBranch ? " (default)" : ""}</option>)}</select>
                  {signedInUser && <details className="disclosure disclosure-tight">
                    <summary>Environment variables {importEnvText.trim() ? "(" + importEnvText.split(/\n/).filter((line) => /^\s*[A-Za-z_][A-Za-z0-9_]*\s*=/.test(line)).length + ")" : ""}</summary>
                    <textarea className="mono" rows={5} value={importEnvText} onChange={(event) => setImportEnvText(event.target.value)} placeholder={"Paste your .env here\nVITE_API_URL=https://api.example.com"} spellCheck={false} aria-label="Environment variables" />
                    <p className="hint">Stored encrypted and used at build time. You can change them later under Environment.</p>
                  </details>}
                  {signedInUser ? <div className="dialog-actions">
                    <button className="btn btn-secondary" onClick={() => void addRepositoryPreview(false)} disabled={projectSaving}>Import only</button>
                    <button className="btn btn-primary" onClick={() => void addRepositoryPreview(true)} disabled={projectSaving || !readiness?.ready}>{projectSaving ? "Importing…" : "Deploy"}</button>
                  </div> : <button className="btn btn-primary btn-block" onClick={() => void addRepositoryPreview()} disabled={projectSaving}>Import</button>}
                  {!signedInUser && <p className="hint">You&rsquo;re not signed in, so this project stays in this tab only.</p>}
                </div> : <>
                  {signedInUser && !showUrlImport ? <>
                    <label className="search search-dialog">
                      <Search size={15} aria-hidden="true" />
                      <input autoFocus value={repoQuery} onChange={(event) => setRepoQuery(event.target.value)} placeholder="Search your repositories" aria-label="Search your repositories" />
                    </label>
                    <div className="repo-list" role="list">
                      {myReposLoading ? [0, 1, 2, 3].map((key) => <div className="repo-item row-skeleton" key={key} />)
                        : myReposError ? <div className="banner banner-error" role="alert">{myReposError} <a href="/api/auth/github">Sign in again</a></div>
                        : (myRepos ?? []).filter((repo) => repo.fullName.toLowerCase().includes(repoQuery.trim().toLowerCase())).slice(0, 50).map((repo) => {
                          const imported = projects.some((project) => project.repositoryUrl === repo.url);
                          return <div className="repo-item" role="listitem" key={repo.fullName}>
                            <Github size={16} aria-hidden="true" />
                            <div className="repo-item-main">
                              <strong>{repo.name}{repo.private && <Lock size={12} aria-label="Private" />}</strong>
                              <span className="muted mono">{repo.owner} · {repo.language ?? "—"} · {repo.updatedAt ? timeAgo(repo.updatedAt) : ""}</span>
                            </div>
                            <button className="btn btn-secondary btn-sm" disabled={repoLoading} onClick={() => { setRepoUrl(repo.url); void inspectRepository(repo.url); }}>{imported ? "Import again" : "Import"}</button>
                          </div>;
                        })}
                      {!myReposLoading && !myReposError && (myRepos ?? []).length > 0 && (myRepos ?? []).filter((repo) => repo.fullName.toLowerCase().includes(repoQuery.trim().toLowerCase())).length === 0 && <p className="muted palette-empty">No repository matches “{repoQuery}”.</p>}
                      {!myReposLoading && !myReposError && myRepos?.length === 0 && <p className="muted palette-empty">No repositories found on this GitHub account.</p>}
                    </div>
                    {githubAccess === "app" && <p className="hint">DEPLO only sees repositories where its GitHub App is installed. <a href="/api/auth/github/install">Add repositories on GitHub</a></p>}
                    {repoLoading && <p className="hint"><Loader2 size={13} className="spin" /> Reading branches…</p>}
                    {repoError && <div className="banner banner-error" role="alert">{repoError}</div>}
                    <button className="link" onClick={() => setShowUrlImport(true)}>Import a public repository by URL instead</button>
                  </> : <>
                    <label className="field" htmlFor="repo-url">Repository URL</label>
                    <div className="input-group">
                      <input id="repo-url" className="mono" value={repoUrl} autoFocus onChange={(event) => setRepoUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void inspectRepository(); }} placeholder="https://github.com/owner/repo" />
                      <button className="btn btn-secondary" onClick={() => void inspectRepository()} disabled={repoLoading || !repoUrl.trim()}>{repoLoading ? "Looking…" : "Find"}</button>
                    </div>
                    {repoError && <div className="banner banner-error" role="alert">{repoError}</div>}
                    {signedInUser ? <button className="link" onClick={() => setShowUrlImport(false)}>Back to your repositories</button>
                      : <p className="hint"><a href="/api/auth/github">Sign in with GitHub</a> to pick from your own repositories, including private ones.</p>}
                  </>}
                </>}
              </div> : <div className="dialog-body">
                <label className={"dropzone " + (projectSaving ? "dropzone-busy" : "")}>
                  <input type="file" disabled={projectSaving} accept={modal === "upload" ? ".zip,application/zip" : ".html,.htm,text/html"} onChange={(event) => void startUpload(event.target.files?.[0], modal === "upload" ? "zip" : "html")} />
                  {projectSaving ? <Loader2 size={22} className="spin" /> : <UploadCloud size={22} />}
                  <strong>{projectSaving ? "Uploading and deploying " + fileName : fileName || (modal === "upload" ? "Choose a .zip file" : "Choose an .html file")}</strong>
                  <span className="muted">{modal === "upload" ? "A built site, or a Vite / React / Next (export) project we build for you. A single wrapping folder is fine. Up to 25 MB." : "A complete HTML page. Up to 2 MB."}</span>
                </label>
                {uploadError && <div className="banner banner-error" role="alert">{uploadError}</div>}
                {!signedInUser && <p className="hint"><a href="/api/auth/github">Sign in with GitHub</a> to deploy uploads.</p>}
              </div>}
            </div>
          </div>
  );
}
