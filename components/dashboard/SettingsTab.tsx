import type { SignedInUser, GitHubAppStatus, Project, Setter } from "@/lib/dashboard/types";
import { Empty } from "./Empty";

export function SettingsTab({ signedInUser, selected, projectNameInput, setProjectNameInput, renameSelectedProject, projectRenaming, githubAppStatus, deleteSelectedProject, projectDeleting }: { signedInUser: SignedInUser | null; selected: Project; projectNameInput: string; setProjectNameInput: Setter<string>; renameSelectedProject: () => Promise<void>; projectRenaming: boolean; githubAppStatus: GitHubAppStatus | null; deleteSelectedProject: () => Promise<void>; projectDeleting: boolean }) {
  return (
    <section className="section settings">
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
                </section>
  );
}
