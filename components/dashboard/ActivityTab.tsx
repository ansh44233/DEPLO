import { GitBranch, RefreshCw } from "lucide-react";
import type { SignedInUser, Project } from "@/lib/dashboard/types";
import { timeAgo } from "@/lib/dashboard/format";
import { Empty } from "./Empty";
import type { useWebhookDeliveries } from "@/hooks/use-webhook-deliveries";

export function ActivityTab({ selected, signedInUser, webhooks }: { selected: Project; signedInUser: SignedInUser | null; webhooks: ReturnType<typeof useWebhookDeliveries> }) {
  const { webhookDeliveries, webhookLoading, webhookError, refreshWebhookDeliveries } = webhooks;

  return (
    <section className="section">
                  <div className="section-head">
                    <h2>Push activity</h2>
                    <button className="btn btn-ghost btn-sm" onClick={() => void refreshWebhookDeliveries(selected.id, Boolean(signedInUser) && selected.sourceType === "github")} disabled={webhookLoading || !selected.id || !signedInUser || selected.sourceType !== "github"}><RefreshCw size={14} className={webhookLoading ? "spin" : ""} /> Refresh</button>
                  </div>
                  {!signedInUser || !selected.id ? <Empty title="Sign in to see activity" text="Pushes to your connected branches appear here." />
                    : selected.sourceType !== "github" ? <Empty title="No Git activity" text="This project was uploaded, so pushes don't redeploy it." />
                    : webhookError ? <div className="banner banner-error" role="alert">{webhookError}</div>
                    : webhookDeliveries.length === 0 ? <Empty title="No pushes yet" text={"Push to " + selected.branch + " and DEPLO redeploys automatically once the GitHub App is connected."} />
                    : <div className="list">{webhookDeliveries.map((delivery) => {
                      const label = delivery.status === "received" ? (delivery.attempt_count > 0 ? "Retrying" : "Queued") : delivery.status === "processing" ? "Deploying" : delivery.status === "deployed" ? "Deployed" : delivery.status === "ignored" ? "Ignored" : "Failed";
                      const tone = delivery.status === "deployed" ? "ready" : delivery.status === "failed" ? "error" : delivery.status === "processing" ? "building" : "idle";
                      return <div className="row" key={delivery.delivery_id}>
                        <span className={"status status-" + tone}><span className={"dot dot-" + tone} />{label}</span>
                        <div className="row-main"><strong className="mono">{delivery.commit_sha.slice(0, 7)}</strong><span className="mono muted branch"><GitBranch size={12} />{delivery.branch}</span></div>
                        <div className="row-meta muted">
                          {delivery.last_error_code && <span className="text-error mono">{delivery.last_error_code}</span>}
                          {delivery.status === "received" && delivery.attempt_count > 0 && <span>Next try {timeAgo(delivery.available_at).replace(" ago", "")}</span>}
                          <span>{timeAgo(delivery.received_at)}</span>
                        </div>
                        <span />
                      </div>;
                    })}</div>}
                </section>
  );
}
