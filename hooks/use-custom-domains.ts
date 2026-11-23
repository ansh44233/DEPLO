import { useCallback, useEffect, useState } from "react";
import type { CustomDomain, SignedInUser, Project } from "@/lib/dashboard/types";

export function useCustomDomains({ selected, signedInUser, setNotice }: { selected: Project; signedInUser: SignedInUser | null; setNotice: (message: string) => void }) {
  const [customDomains, setCustomDomains] = useState<CustomDomain[]>([]);
  const [domainsLoading, setDomainsLoading] = useState(false);
  const [domainsError, setDomainsError] = useState("");
  const [domainInput, setDomainInput] = useState("");
  const [domainSaving, setDomainSaving] = useState(false);
  const [domainDeleting, setDomainDeleting] = useState<string | null>(null);

  const refreshCustomDomains = useCallback(async (projectId?: string, authenticated = false) => {
    if (!authenticated || !projectId) {
      setCustomDomains([]);
      setDomainsError("");
      setDomainsLoading(false);
      return;
    }
    setDomainsLoading(true);
    setDomainsError("");
    try {
      const response = await fetch("/api/projects/" + encodeURIComponent(projectId) + "/domains", { cache: "no-store" });
      const data = await response.json() as { domains?: CustomDomain[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Custom domains could not be loaded.");
      setCustomDomains(Array.isArray(data.domains) ? data.domains : []);
    } catch (error) {
      setDomainsError(error instanceof Error ? error.message : "Custom domains could not be loaded.");
      setCustomDomains([]);
    } finally {
      setDomainsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshCustomDomains(selected.id, Boolean(signedInUser));
  }, [refreshCustomDomains, selected.id, signedInUser]);

  async function addCustomDomain() {
    if (!selected.id || !signedInUser || !domainInput.trim() || domainSaving) return;
    setDomainSaving(true);
    setDomainsError("");
    try {
      const response = await fetch("/api/projects/" + encodeURIComponent(selected.id) + "/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: domainInput }),
      });
      const data = await response.json() as { domain?: CustomDomain; error?: string };
      if (!response.ok) throw new Error(data.error || "Domain could not be added.");
      setDomainInput("");
      await refreshCustomDomains(selected.id, true);
      setNotice("Domain added to Cloudflare Pages. Follow the DNS instructions and refresh its status.");
    } catch (error) {
      setDomainsError(error instanceof Error ? error.message : "Domain could not be added.");
    } finally {
      setDomainSaving(false);
    }
  }

  async function removeCustomDomain(domain: string) {
    if (!selected.id || !signedInUser || domainDeleting) return;
    if (!window.confirm("Remove " + domain + " from this Pages project? Its DNS record may also need to be removed at your DNS provider.")) return;
    setDomainDeleting(domain);
    setDomainsError("");
    try {
      const response = await fetch("/api/projects/" + encodeURIComponent(selected.id) + "/domains?domain=" + encodeURIComponent(domain), { method: "DELETE" });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Domain could not be removed.");
      await refreshCustomDomains(selected.id, true);
      setNotice(domain + " was removed from the Pages project.");
    } catch (error) {
      setDomainsError(error instanceof Error ? error.message : "Domain could not be removed.");
    } finally {
      setDomainDeleting(null);
    }
  }

  return {
    customDomains,
    domainsLoading,
    domainsError,
    domainInput,
    setDomainInput,
    domainSaving,
    domainDeleting,
    refreshCustomDomains,
    addCustomDomain,
    removeCustomDomain,
  };
}
