import { useEffect, useState } from "react";
import type { SignedInUser, Project, ProjectTab } from "@/lib/dashboard/types";
import { parseDotenv } from "@/lib/dashboard/format";

export function useEnvVars({ selected, signedInUser, projectTab, setNotice }: { selected: Project; signedInUser: SignedInUser | null; projectTab: ProjectTab; setNotice: (message: string) => void }) {
  const [envVars, setEnvVars] = useState<{ key: string; value: string }[]>([]);
  const [envLoadedFor, setEnvLoadedFor] = useState<string | null>(null);
  const [envLoading, setEnvLoading] = useState(false);
  const [envSaving, setEnvSaving] = useState(false);
  const [envError, setEnvError] = useState("");
  const [envDirty, setEnvDirty] = useState(false);
  const [envRevealed, setEnvRevealed] = useState<Set<number>>(new Set());
  const [envPasteOpen, setEnvPasteOpen] = useState(false);
  const [envPasteText, setEnvPasteText] = useState("");

  useEffect(() => {
    if (projectTab !== "environment" || !selected.id || !signedInUser || envLoadedFor === selected.id) return;
    const projectId = selected.id;
    setEnvLoading(true); setEnvError(""); setEnvDirty(false); setEnvRevealed(new Set());
    fetch("/api/projects/" + encodeURIComponent(projectId) + "/env", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({})) as { variables?: { key: string; value: string }[]; error?: string };
        if (!response.ok) throw new Error(data.error || "Environment variables could not be loaded.");
        setEnvVars(data.variables ?? []);
      })
      .catch((error: unknown) => { setEnvError(error instanceof Error ? error.message : "Environment variables could not be loaded."); setEnvVars([]); })
      .finally(() => { setEnvLoading(false); setEnvLoadedFor(projectId); });
  }, [projectTab, selected.id, signedInUser, envLoadedFor]);

  async function saveEnvVars(variables = envVars) {
    if (!selected.id) return;
    setEnvSaving(true); setEnvError("");
    try {
      const response = await fetch("/api/projects/" + encodeURIComponent(selected.id) + "/env", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ variables }),
      });
      const data = await response.json().catch(() => ({})) as { variables?: { key: string; value: string }[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Could not save environment variables.");
      setEnvVars(data.variables ?? []); setEnvDirty(false); setEnvRevealed(new Set());
      setNotice("Environment saved. Redeploy to use the new values.");
    } catch (error) {
      setEnvError(error instanceof Error ? error.message : "Could not save environment variables.");
    } finally { setEnvSaving(false); }
  }

  function applyPastedEnv() {
    const parsed = parseDotenv(envPasteText);
    if (!parsed.length) { setEnvError("No KEY=value lines found."); return; }
    setEnvVars((current) => {
      const map = new Map(current.map((item) => [item.key, item.value]));
      for (const item of parsed) map.set(item.key, item.value);
      return [...map].map(([key, value]) => ({ key, value }));
    });
    setEnvDirty(true); setEnvPasteOpen(false); setEnvPasteText(""); setEnvError("");
  }

  return {
    envVars,
    setEnvVars,
    envLoadedFor,
    setEnvLoadedFor,
    envLoading,
    envSaving,
    envError,
    setEnvError,
    envDirty,
    setEnvDirty,
    envRevealed,
    setEnvRevealed,
    envPasteOpen,
    setEnvPasteOpen,
    envPasteText,
    setEnvPasteText,
    saveEnvVars,
    applyPastedEnv,
  };
}
