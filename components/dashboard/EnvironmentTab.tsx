import { Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import type { DeploymentReadiness, SignedInUser, Project } from "@/lib/dashboard/types";
import { Empty } from "./Empty";
import type { useEnvVars } from "@/hooks/use-env-vars";

export function EnvironmentTab({ selected, signedInUser, isDeployed, projectDeploying, readiness, deploySelectedProject, env }: { selected: Project; signedInUser: SignedInUser | null; isDeployed: boolean; projectDeploying: boolean; readiness: DeploymentReadiness | null; deploySelectedProject: (target?: { id: string }) => Promise<void>; env: ReturnType<typeof useEnvVars> }) {
  const { envVars, setEnvVars, setEnvLoadedFor, envLoading, envSaving, envError, setEnvError, envDirty, setEnvDirty, envRevealed, setEnvRevealed, envPasteOpen, setEnvPasteOpen, envPasteText, setEnvPasteText, saveEnvVars, applyPastedEnv } = env;

  return (
    <section className="section">
                  <div className="section-head">
                    <div><p className="kicker">Build-time configuration</p><h2>Environment variables</h2></div>
                    <div className="row-actions">
                      <button className="btn btn-secondary btn-sm" onClick={() => { setEnvPasteOpen((open) => !open); setEnvError(""); }} disabled={!signedInUser || !selected.id}>Paste .env</button>
                      <button className="btn btn-secondary btn-sm" onClick={() => { setEnvVars((current) => [...current, { key: "", value: "" }]); setEnvDirty(true); }} disabled={!signedInUser || !selected.id}><Plus size={14} /> Add</button>
                    </div>
                  </div>
                  {!signedInUser || !selected.id ? <Empty title="Sign in to manage variables" text="Environment variables are stored encrypted for projects saved to your account." /> : <>
                    <p className="hint">Values are encrypted at rest and handed to <span className="mono">install</span> and <span className="mono">build</span> only. A static site can&rsquo;t read them at runtime, so expose browser values with your framework&rsquo;s prefix: <span className="mono">VITE_</span>, <span className="mono">NEXT_PUBLIC_</span> or <span className="mono">REACT_APP_</span>. Redeploy after changes.</p>
                    {envPasteOpen && <div className="tile paste">
                      <label className="field" htmlFor="env-paste">Paste the contents of a .env file</label>
                      <textarea id="env-paste" className="mono" rows={6} value={envPasteText} onChange={(event) => setEnvPasteText(event.target.value)} placeholder={"VITE_API_URL=https://api.example.com\nSTRIPE_PUBLIC_KEY=pk_live_..."} spellCheck={false} />
                      <div className="row-actions"><button className="btn btn-primary btn-sm" onClick={applyPastedEnv} disabled={!envPasteText.trim()}>Add these</button><button className="btn btn-ghost btn-sm" onClick={() => setEnvPasteOpen(false)}>Cancel</button></div>
                    </div>}
                    {envError && <div className="banner banner-error" role="alert">{envError}</div>}
                    {envLoading ? <div className="list"><div className="row row-skeleton" /><div className="row row-skeleton" /></div>
                      : envVars.length === 0 ? <Empty title="No variables yet" text="Add a variable or paste a .env file. They apply to the next deploy." />
                      : <div className="env-table" role="table" aria-label="Environment variables">
                        <div className="env-row env-head" role="row"><span role="columnheader">Key</span><span role="columnheader">Value</span><span /></div>
                        {envVars.map((item, index) => <div className="env-row" role="row" key={index}>
                          <input className="mono" aria-label="Key" value={item.key} placeholder="NAME" spellCheck={false} onChange={(event) => { const key = event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"); setEnvVars((current) => current.map((entry, i) => i === index ? { ...entry, key } : entry)); setEnvDirty(true); }} />
                          <div className="env-value">
                            <input className="mono" aria-label={"Value of " + (item.key || "variable")} type={envRevealed.has(index) ? "text" : "password"} value={item.value} placeholder="value" spellCheck={false} autoComplete="off" onChange={(event) => { const value = event.target.value; setEnvVars((current) => current.map((entry, i) => i === index ? { ...entry, value } : entry)); setEnvDirty(true); }} />
                            <button className="icon-btn" onClick={() => setEnvRevealed((current) => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next; })} aria-label={envRevealed.has(index) ? "Hide value" : "Show value"}>{envRevealed.has(index) ? <EyeOff size={15} /> : <Eye size={15} />}</button>
                          </div>
                          <button className="icon-btn" onClick={() => { setEnvVars((current) => current.filter((_, i) => i !== index)); setEnvRevealed(new Set()); setEnvDirty(true); }} aria-label={"Remove " + (item.key || "variable")}><Trash2 size={15} /></button>
                        </div>)}
                      </div>}
                    <div className="save-bar">
                      <span className="muted">{envDirty ? "Unsaved changes" : envVars.length + " saved"}</span>
                      <div className="row-actions">
                        {envDirty && <button className="btn btn-ghost btn-sm" onClick={() => setEnvLoadedFor(null)}>Discard</button>}
                        <button className="btn btn-primary btn-sm" onClick={() => void saveEnvVars(envVars.filter((item) => item.key.trim()))} disabled={!envDirty || envSaving}>{envSaving ? "Saving…" : "Save"}</button>
                        {!envDirty && isDeployed && selected.sourceType === "github" && <button className="btn btn-secondary btn-sm" onClick={() => void deploySelectedProject()} disabled={projectDeploying || !readiness?.ready}>Redeploy</button>}
                      </div>
                    </div>
                  </>}
                </section>
  );
}
