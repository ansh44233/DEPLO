import type { DeploymentReadiness } from "@/lib/dashboard/types";

export function Footer({ readiness, readinessLoading, readinessError }: { readiness: DeploymentReadiness | null; readinessLoading: boolean; readinessError: string }) {
  return (
    <footer className="footer">
      <span className="footer-status">
        <span className={"dot " + (readinessLoading ? "dot-idle" : readiness?.ready ? "dot-ready" : "dot-error")} />
        {readinessLoading ? "Checking hosting" : readinessError ? "Hosting status unknown" : readiness?.ready ? "Cloudflare Pages connected" : "Hosting not configured"}
      </span>
      <span className="muted">DEPLO v0.1</span>
    </footer>
  );
}
