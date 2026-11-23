import { RefreshCw } from "lucide-react";
import type { SignedInUser, Project } from "@/lib/dashboard/types";
import { hostOf, cap } from "@/lib/dashboard/format";
import { Empty } from "./Empty";
import type { useCustomDomains } from "@/hooks/use-custom-domains";

export function DomainsTab({ selected, signedInUser, isDeployed, domains }: { selected: Project; signedInUser: SignedInUser | null; isDeployed: boolean; domains: ReturnType<typeof useCustomDomains> }) {
  const { customDomains, domainsLoading, domainsError, domainInput, setDomainInput, domainSaving, domainDeleting, refreshCustomDomains, addCustomDomain, removeCustomDomain } = domains;

  return (
    <section className="section">
                  <div className="section-head">
                    <h2>Domains</h2>
                    <button className="btn btn-ghost btn-sm" onClick={() => void refreshCustomDomains(selected.id, Boolean(signedInUser))} disabled={domainsLoading || !selected.id || !signedInUser}><RefreshCw size={14} className={domainsLoading ? "spin" : ""} /> Refresh</button>
                  </div>
                  {!signedInUser || !selected.id ? <Empty title="Sign in to add domains" text="Custom domains are available for projects saved to your account." /> : <>
                    <form className="card form" onSubmit={(event) => { event.preventDefault(); void addCustomDomain(); }}>
                      <label className="field" htmlFor="custom-domain-input">Add a domain</label>
                      <div className="input-group">
                        <input id="custom-domain-input" className="mono" value={domainInput} onChange={(event) => setDomainInput(event.target.value)} placeholder="www.example.com" autoComplete="off" />
                        <button className="btn btn-primary" type="submit" disabled={domainSaving || !domainInput.trim() || !isDeployed}>{domainSaving ? "Adding…" : "Add"}</button>
                      </div>
                      <p className="hint">{isDeployed ? "For a subdomain, point a CNAME record at " + hostOf(selected.domain) + ". Apex domains must be a Cloudflare zone." : "Deploy this project before adding a domain."}</p>
                    </form>
                    {domainsError && <div className="banner banner-error" role="alert">{domainsError}</div>}
                    {domainsLoading && customDomains.length === 0 ? <div className="list"><div className="row row-skeleton" /></div>
                      : customDomains.length === 0 ? <Empty title="No custom domains" text={isDeployed ? "Your site is available at " + hostOf(selected.domain) + "." : "Deploy first, then connect your own domain."} />
                      : <div className="list">{customDomains.map((domain) => {
                        const tone = domain.status === "active" ? "ready" : domain.status === "error" || domain.status === "blocked" ? "error" : "building";
                        return <div className="domain" key={domain.name}>
                          <div className="domain-top">
                            <a className="mono domain-name" href={"https://" + domain.name} target="_blank" rel="noreferrer">{domain.name}</a>
                            <span className={"status status-" + tone}><span className={"dot dot-" + tone} />{domain.status === "active" ? "Valid configuration" : cap(domain.status)}</span>
                            <button className="btn btn-ghost btn-sm" onClick={() => void removeCustomDomain(domain.name)} disabled={domainDeleting !== null}>{domainDeleting === domain.name ? "Removing…" : "Remove"}</button>
                          </div>
                          {domain.status !== "active" && <table className="dns">
                            <thead><tr><th>Type</th><th>Name</th><th>Value</th></tr></thead>
                            <tbody>
                              <tr><td>CNAME</td><td className="mono">{domain.name.split(".")[0]}</td><td className="mono">{hostOf(selected.domain)}</td></tr>
                              {domain.validation.method === "txt" && domain.validation.txtName && domain.validation.txtValue && <tr><td>TXT</td><td className="mono">{domain.validation.txtName}</td><td className="mono">{domain.validation.txtValue}</td></tr>}
                            </tbody>
                          </table>}
                          {(domain.validation.error || domain.verification.error) && <p className="text-error">{domain.validation.error || domain.verification.error}</p>}
                          <p className="hint">Validation {domain.validation.status}, certificate {domain.verification.status}.</p>
                        </div>;
                      })}</div>}
                  </>}
                </section>
  );
}
