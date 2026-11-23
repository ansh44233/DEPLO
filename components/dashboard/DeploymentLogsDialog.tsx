import { X } from "lucide-react";
import type { CloudflareDeploymentLog, Setter } from "@/lib/dashboard/types";

export function DeploymentLogsDialog({ logsDeploymentId, setLogsDeploymentId, logsLoading, logsError, deploymentLogs }: { logsDeploymentId: string; setLogsDeploymentId: Setter<string | null>; logsLoading: boolean; logsError: string; deploymentLogs: CloudflareDeploymentLog[] }) {
  return (
    <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setLogsDeploymentId(null); }}>
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
          </div>
  );
}
