import { useCallback, useEffect, useState } from "react";
import type { WebhookDelivery, SignedInUser, Project } from "@/lib/dashboard/types";

export function useWebhookDeliveries({ selected, signedInUser }: { selected: Project; signedInUser: SignedInUser | null }) {
  const [webhookDeliveries, setWebhookDeliveries] = useState<WebhookDelivery[]>([]);
  const [webhookLoading, setWebhookLoading] = useState(false);
  const [webhookError, setWebhookError] = useState("");

  const refreshWebhookDeliveries = useCallback(async (projectId?: string, authenticated = false) => {
    if (!authenticated || !projectId) { setWebhookDeliveries([]); setWebhookError(""); setWebhookLoading(false); return; }
    setWebhookLoading(true); setWebhookError("");
    try {
      const response = await fetch("/api/projects/" + encodeURIComponent(projectId) + "/webhook-deliveries", { cache: "no-store" });
      const data = await response.json() as { deliveries?: WebhookDelivery[]; error?: string };
      if (!response.ok) throw new Error(data.error || "GitHub delivery activity is unavailable.");
      setWebhookDeliveries(Array.isArray(data.deliveries) ? data.deliveries : []);
    } catch (error) {
      setWebhookError(error instanceof Error ? error.message : "GitHub delivery activity is unavailable."); setWebhookDeliveries([]);
    } finally { setWebhookLoading(false); }
  }, []);

  useEffect(() => {
    void refreshWebhookDeliveries(selected.id, Boolean(signedInUser) && selected.sourceType === "github");
  }, [refreshWebhookDeliveries, selected.id, selected.sourceType, signedInUser]);

  return {
    webhookDeliveries,
    webhookLoading,
    webhookError,
    refreshWebhookDeliveries,
  };
}
