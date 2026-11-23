import { RefreshCw } from "lucide-react";
import type { BuildJobFramework, BuildJobPackageManager, SignedInUser, Project } from "@/lib/dashboard/types";
import { describeBuildJob, timeAgo, cap, toneClass } from "@/lib/dashboard/format";
import { BUILD_FRAMEWORKS, BUILD_PACKAGE_MANAGERS } from "@/lib/dashboard/constants";
import { Empty } from "./Empty";
import type { useBuildJobs } from "@/hooks/use-build-jobs";
import type { useRecoveryAttempts } from "@/hooks/use-recovery-attempts";

export function BuildsTab({ selected, signedInUser, builds, recovery }: { selected: Project; signedInUser: SignedInUser | null; builds: ReturnType<typeof useBuildJobs>; recovery: ReturnType<typeof useRecoveryAttempts> }) {
  const { buildJobs, buildJobsLoading, buildJobsError, buildFramework, setBuildFramework, buildPackageManager, setBuildPackageManager, buildCommitSha, setBuildCommitSha, buildCommitLoading, buildQueueing, buildCancelling, refreshBuildJobs, buildJobsEnabled, hasActiveBuildJob, fetchLatestBranchCommit, queueBuildJob, cancelBuildJob } = builds;
  const { recoveryAttempts, recoveryError } = recovery;

  return (
    <section className="section">
                  <div className="section-head">
                    <h2>Framework builds</h2>
                    <button className="btn btn-ghost btn-sm" onClick={() => void refreshBuildJobs(selected.id, buildJobsEnabled)} disabled={buildJobsLoading || !buildJobsEnabled}><RefreshCw size={14} className={buildJobsLoading ? "spin" : ""} /> Refresh</button>
                  </div>
                  {!signedInUser || !selected.id ? <Empty title="Sign in to build" text="Framework builds run for projects saved to your account." />
                    : selected.sourceType !== "github" ? <Empty title="No build needed" text="ZIP and HTML uploads are published as they are." />
                    : <>
                      <form className="card form" onSubmit={(event) => { event.preventDefault(); void queueBuildJob(); }}>
                        <div className="form-row">
                          <label className="field">Framework
                            <select value={buildFramework} onChange={(event) => setBuildFramework(event.target.value as BuildJobFramework)}>
                              {BUILD_FRAMEWORKS.map((option) => <option key={option.value} value={option.value}>{option.label} (outputs {option.output}/)</option>)}
                            </select>
                          </label>
                          <label className="field">Package manager
                            <select value={buildPackageManager} onChange={(event) => setBuildPackageManager(event.target.value as BuildJobPackageManager)}>
                              {BUILD_PACKAGE_MANAGERS.map((manager) => <option key={manager} value={manager}>{manager}</option>)}
                            </select>
                          </label>
                        </div>
                        <label className="field" htmlFor="build-commit-input">Commit on {selected.branch}</label>
                        <div className="input-group">
                          <input id="build-commit-input" className="mono" value={buildCommitSha} onChange={(event) => setBuildCommitSha(event.target.value.trim())} placeholder="40-character commit SHA" autoComplete="off" spellCheck={false} maxLength={40} />
                          <button className="btn btn-secondary" type="button" onClick={() => void fetchLatestBranchCommit()} disabled={buildCommitLoading || !selected.repositoryUrl}>{buildCommitLoading ? "Reading…" : "Use latest"}</button>
                          <button className="btn btn-primary" type="submit" disabled={buildQueueing || !/^[a-f0-9]{40}$/i.test(buildCommitSha)}>{buildQueueing ? "Queueing…" : "Start build"}</button>
                        </div>
                        <p className="hint">Needs the GitHub App and an isolated build runner. The runner checks the commit itself, so the framework here is a hint.</p>
                      </form>
                      {buildJobsError && <div className="banner banner-error" role="alert">{buildJobsError}</div>}
                      {buildJobsLoading && buildJobs.length === 0 ? <div className="list"><div className="row row-skeleton" /></div>
                        : buildJobs.length === 0 ? <Empty title="No builds yet" text="Start a build to compile this repository and publish its output." />
                        : <div className="list">{buildJobs.map((job) => {
                          const state = describeBuildJob(job);
                          const cancellable = job.status === "pending" || job.status === "processing";
                          const frameworkLabel = BUILD_FRAMEWORKS.find((option) => option.value === job.framework)?.label ?? job.framework;
                          return <div className="row" key={job.id}>
                            <span className={"status status-" + toneClass(state.tone)}><span className={"dot dot-" + toneClass(state.tone)} />{state.label}</span>
                            <div className="row-main"><strong>{frameworkLabel} with {job.package_manager}</strong><span className="mono muted">{job.source_commit_sha.slice(0, 7)}</span></div>
                            <div className="row-meta muted">
                              {job.artifact_file_count != null && job.artifact_bytes != null && <span>{job.artifact_file_count} files, {(job.artifact_bytes / 1024 / 1024).toFixed(2)} MiB</span>}
                              {job.error_code && <span className="text-error mono">{job.error_code}</span>}
                              <span>Attempt {job.attempt_count}/{job.max_attempts}</span>
                              <span>{timeAgo(job.created_at)}</span>
                            </div>
                            {cancellable ? <button className="btn btn-ghost btn-sm" onClick={() => void cancelBuildJob(job.id)} disabled={buildCancelling !== null}>{buildCancelling === job.id ? "Cancelling…" : "Cancel"}</button> : <span />}
                          </div>;
                        })}</div>}
                      {hasActiveBuildJob && <p className="hint">Refreshing every 10 seconds while a build is running.</p>}

                      <details className="disclosure">
                        <summary>Runner recovery log ({recoveryAttempts.length})</summary>
                        <p className="hint">What the build runner planned after a crash or restart. This is a record only; DEPLO does not run these steps on its own yet.</p>
                        {recoveryError ? <div className="banner banner-error" role="alert">{recoveryError}</div>
                          : recoveryAttempts.length === 0 ? <p className="muted">No recovery attempts recorded.</p>
                          : <div className="list">{recoveryAttempts.map((attempt) => {
                            const tone = attempt.status === "completed" ? "ready" : attempt.status === "blocked" ? "error" : attempt.status === "reconciling" ? "building" : "idle";
                            return <div className="row" key={attempt.id}>
                              <span className={"status status-" + tone}><span className={"dot dot-" + tone} />{cap(attempt.status)}</span>
                              <div className="row-main"><strong>{attempt.disposition.replaceAll("_", " ")}</strong><span className="muted">Runner state {attempt.observed_state}, step {Math.min(attempt.next_action_index, attempt.actions.length)} of {attempt.actions.length}</span></div>
                              <div className="row-meta muted">{attempt.error_code && <span className="text-error mono">{attempt.error_code}</span>}<span>{timeAgo(attempt.updated_at)}</span></div>
                              <span />
                            </div>;
                          })}</div>}
                      </details>
                    </>}
                </section>
  );
}
