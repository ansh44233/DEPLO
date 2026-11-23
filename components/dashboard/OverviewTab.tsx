import { GitBranch, Github, Rocket } from "lucide-react";
import type { DeploymentReadiness, SignedInUser, Project, ProjectTab, DisplayDeployment, Setter } from "@/lib/dashboard/types";
import { hostOf, fmtElapsed } from "@/lib/dashboard/format";
import { DeploymentList } from "./DeploymentList";
import type { useCustomDomains } from "@/hooks/use-custom-domains";
import type { useDeploymentHistory } from "@/hooks/use-deployment-history";

export function OverviewTab({ selected, isDeployed, projectDeploying, readiness, deploySelectedProject, deployElapsed, setProjectTab, latestDeployment, displayDeployments, signedInUser, rollbackSelectedDeployment, rollbackDeploymentId, domains, history }: { selected: Project; isDeployed: boolean; projectDeploying: boolean; readiness: DeploymentReadiness | null; deploySelectedProject: (target?: { id: string }) => Promise<void>; deployElapsed: number; setProjectTab: Setter<ProjectTab>; latestDeployment: DisplayDeployment | undefined; displayDeployments: DisplayDeployment[]; signedInUser: SignedInUser | null; rollbackSelectedDeployment: (deploymentId: string) => Promise<void>; rollbackDeploymentId: string | null; domains: ReturnType<typeof useCustomDomains>; history: ReturnType<typeof useDeploymentHistory> }) {
  const { customDomains } = domains;
  const { historyLoading, historyError, openDeploymentLogs } = history;

  return (
    <>
                  <section className="card production">
                    <div className="preview-frame">
                      {isDeployed ? <>
                        <iframe src={selected.domain} title={"Live preview of " + selected.name} loading="lazy" sandbox="allow-scripts allow-same-origin" tabIndex={-1} aria-hidden="true" />
                        <a className="preview-link" href={selected.domain} target="_blank" rel="noreferrer" aria-label={"Open " + selected.name} />
                      </> : <div className="preview-empty">
                        <Rocket size={20} />
                        <strong>No deployment yet</strong>
                        <span>{selected.sourceType === "github" ? "Deploy to build " + selected.branch + " and get a live URL." : "Upload the site again to publish it."}</span>
                        {selected.id && selected.sourceType === "github" && <button className="btn btn-primary btn-sm" onClick={() => void deploySelectedProject()} disabled={projectDeploying || !readiness?.ready}>{projectDeploying ? "Deploying " + fmtElapsed(deployElapsed) : "Deploy now"}</button>}
                      </div>}
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
                </>
  );
}
