import { ArrowLeft, ExternalLink, Github, Loader2, X } from "lucide-react";
import type { DeploymentReadiness, Project, Setter } from "@/lib/dashboard/types";
import { fmtElapsed } from "@/lib/dashboard/format";

export function ProjectHeader({ goHome, selected, isDeployed, projectDeploying, deployElapsed, readiness, deploySelectedProject, deployResult, setBuildLogOpen, setDeployResult }: { goHome: () => void; selected: Project; isDeployed: boolean; projectDeploying: boolean; deployElapsed: number; readiness: DeploymentReadiness | null; deploySelectedProject: (target?: { id: string }) => Promise<void>; deployResult: { ok: boolean; message: string; log: string | null } | null; setBuildLogOpen: Setter<boolean>; setDeployResult: Setter<{ ok: boolean; message: string; log: string | null } | null> }) {
  return (
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
    </>
  );
}
