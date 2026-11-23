import { RefreshCw } from "lucide-react";
import type { SignedInUser, Project, DisplayDeployment } from "@/lib/dashboard/types";
import { DeploymentList } from "./DeploymentList";
import type { useDeploymentHistory } from "@/hooks/use-deployment-history";

export function DeploymentsTab({ selected, signedInUser, displayDeployments, rollbackSelectedDeployment, rollbackDeploymentId, history }: { selected: Project; signedInUser: SignedInUser | null; displayDeployments: DisplayDeployment[]; rollbackSelectedDeployment: (deploymentId: string) => Promise<void>; rollbackDeploymentId: string | null; history: ReturnType<typeof useDeploymentHistory> }) {
  const { historyLoading, historyError, refreshDeploymentHistory, openDeploymentLogs } = history;

  return (
    <section className="section">
                  <div className="section-head">
                    <h2>Deployments</h2>
                    <button className="btn btn-ghost btn-sm" onClick={() => void refreshDeploymentHistory(selected.id, Boolean(signedInUser))} disabled={historyLoading}><RefreshCw size={14} className={historyLoading ? "spin" : ""} /> Refresh</button>
                  </div>
                  <DeploymentList items={displayDeployments} loading={historyLoading} error={historyError} onLogs={(id) => void openDeploymentLogs(id)} onRollback={(id) => void rollbackSelectedDeployment(id)} rollbackId={rollbackDeploymentId} signedIn={Boolean(signedInUser && selected.id)} />
                  <p className="hint">Roll back is available on earlier successful production deployments. It switches the live site instantly; nothing is rebuilt.</p>
                </section>
  );
}
