import type { DisplayDeployment } from "@/lib/dashboard/types";
import { hostOf } from "@/lib/dashboard/format";
import { Empty } from "./Empty";

export function DeploymentList({ items, loading, error, onLogs, onRollback, rollbackId, signedIn }: {
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
