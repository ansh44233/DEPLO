import { useCallback, useEffect, useState } from "react";
import type { RecoveryAttempt, SignedInUser, Project } from "@/lib/dashboard/types";

export function useRecoveryAttempts({ selected, signedInUser }: { selected: Project; signedInUser: SignedInUser | null }) {
  const [recoveryAttempts, setRecoveryAttempts] = useState<RecoveryAttempt[]>([]);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");

  const refreshRecoveryAttempts = useCallback(async (projectId?: string, authenticated = false) => {
    if (!authenticated || !projectId) {
      setRecoveryAttempts([]);
      setRecoveryError("");
      setRecoveryLoading(false);
      return;
    }
    setRecoveryLoading(true);
    setRecoveryError("");
    try {
      const response = await fetch("/api/projects/" + encodeURIComponent(projectId) + "/recovery-attempts", { cache: "no-store" });
      const data = await response.json() as { attempts?: RecoveryAttempt[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Recovery history is unavailable.");
      setRecoveryAttempts(Array.isArray(data.attempts) ? data.attempts : []);
    } catch (error) {
      setRecoveryError(error instanceof Error ? error.message : "Recovery history is unavailable.");
      setRecoveryAttempts([]);
    } finally {
      setRecoveryLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshRecoveryAttempts(selected.id, Boolean(signedInUser));
  }, [refreshRecoveryAttempts, selected.id, signedInUser]);

  return {
    recoveryAttempts,
    recoveryLoading,
    recoveryError,
    refreshRecoveryAttempts,
  };
}
