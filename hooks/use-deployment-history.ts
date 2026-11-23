import { useCallback, useEffect, useState } from "react";
import type { CloudflareDeploymentLog, CloudflareDeployment, SignedInUser, Project } from "@/lib/dashboard/types";

export function useDeploymentHistory({ selected, signedInUser }: { selected: Project; signedInUser: SignedInUser | null }) {
  const [cloudflareDeployments, setCloudflareDeployments] = useState<CloudflareDeployment[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");

  const [logsDeploymentId, setLogsDeploymentId] = useState<string | null>(null);
  const [deploymentLogs, setDeploymentLogs] = useState<CloudflareDeploymentLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState("");

  const refreshDeploymentHistory = useCallback(async (projectId?: string, authenticated = false) => {
    if (!authenticated || !projectId) {
      setCloudflareDeployments([]);
      setHistoryError("");
      setHistoryLoading(false);
      return;
    }
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const response = await fetch("/api/deploy/history?projectId=" + encodeURIComponent(projectId), { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Deployment history is unavailable.");
      setCloudflareDeployments((data as { deployments: CloudflareDeployment[] }).deployments);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : "Deployment history is unavailable.");
      setCloudflareDeployments([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshDeploymentHistory(selected.id, Boolean(signedInUser));
  }, [refreshDeploymentHistory, selected.id, signedInUser]);

  async function openDeploymentLogs(deploymentId: string) {
    if (!selected.id || !signedInUser) return;
    setLogsDeploymentId(deploymentId);
    setDeploymentLogs([]);
    setLogsError("");
    setLogsLoading(true);
    try {
      const response = await fetch(
        "/api/projects/" + encodeURIComponent(selected.id) + "/deployments/" + encodeURIComponent(deploymentId) + "/logs",
        { cache: "no-store" },
      );
      const data = await response.json() as { logs?: CloudflareDeploymentLog[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Deployment logs could not be loaded.");
      setDeploymentLogs(Array.isArray(data.logs) ? data.logs : []);
    } catch (error) {
      setLogsError(error instanceof Error ? error.message : "Deployment logs could not be loaded.");
    } finally {
      setLogsLoading(false);
    }
  }

  return {
    cloudflareDeployments,
    setCloudflareDeployments,
    historyLoading,
    historyError,
    refreshDeploymentHistory,
    logsDeploymentId,
    setLogsDeploymentId,
    deploymentLogs,
    setDeploymentLogs,
    logsLoading,
    logsError,
    openDeploymentLogs,
  };
}
