import { useEffect, useState } from "react";
import type { DeploymentReadiness } from "@/lib/dashboard/types";

export function useReadiness() {
  const [readiness, setReadiness] = useState<DeploymentReadiness | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(true);
  const [readinessError, setReadinessError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/deploy/status", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load provider status.");
        return response.json() as Promise<DeploymentReadiness>;
      })
      .then((data) => { if (!cancelled) setReadiness(data); })
      .catch(() => { if (!cancelled) setReadinessError("Provider status is unavailable."); })
      .finally(() => { if (!cancelled) setReadinessLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return {
    readiness,
    readinessLoading,
    readinessError,
  };
}
