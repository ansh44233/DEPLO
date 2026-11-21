export type InstallationLifecycleUpdate =
  | { operation: "suspend" | "unsuspend"; installationId: number }
  | { operation: "delete"; installationId: number };

export function normalizeInstallationLifecycleEvent(action: unknown, installationId: unknown): InstallationLifecycleUpdate | null {
  if (typeof installationId !== "number" || !Number.isSafeInteger(installationId) || installationId <= 0) return null;
  if (action === "suspend") return { operation: "suspend", installationId };
  if (action === "unsuspend" || action === "created") return { operation: "unsuspend", installationId };
  if (action === "deleted") return { operation: "delete", installationId };
  return null;
}
