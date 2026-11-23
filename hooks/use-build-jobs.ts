import { useCallback, useEffect, useState } from "react";
import type { RepositoryInfo, BuildJobFramework, BuildJobPackageManager, BuildJob, SignedInUser, Project } from "@/lib/dashboard/types";

export function useBuildJobs({ selected, signedInUser, setNotice }: { selected: Project; signedInUser: SignedInUser | null; setNotice: (message: string) => void }) {
  const [buildJobs, setBuildJobs] = useState<BuildJob[]>([]);
  const [buildJobsLoading, setBuildJobsLoading] = useState(false);
  const [buildJobsError, setBuildJobsError] = useState("");
  const [buildFramework, setBuildFramework] = useState<BuildJobFramework>("vite");
  const [buildPackageManager, setBuildPackageManager] = useState<BuildJobPackageManager>("npm");
  const [buildCommitSha, setBuildCommitSha] = useState("");
  const [buildCommitLoading, setBuildCommitLoading] = useState(false);
  const [buildQueueing, setBuildQueueing] = useState(false);
  const [buildCancelling, setBuildCancelling] = useState<string | null>(null);

  const refreshBuildJobs = useCallback(async (projectId?: string, authenticated = false, quiet = false) => {
    if (!authenticated || !projectId) { setBuildJobs([]); setBuildJobsError(""); setBuildJobsLoading(false); return; }
    if (!quiet) setBuildJobsLoading(true);
    setBuildJobsError("");
    try {
      const response = await fetch("/api/projects/" + encodeURIComponent(projectId) + "/build-jobs", { cache: "no-store" });
      const data = await response.json() as { jobs?: BuildJob[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Build jobs are unavailable.");
      setBuildJobs(Array.isArray(data.jobs) ? data.jobs : []);
    } catch (error) {
      setBuildJobsError(error instanceof Error ? error.message : "Build jobs are unavailable.");
      if (!quiet) setBuildJobs([]);
    } finally { if (!quiet) setBuildJobsLoading(false); }
  }, []);

  const buildJobsEnabled = Boolean(signedInUser) && selected.sourceType === "github";

  useEffect(() => {
    setBuildCommitSha("");
    void refreshBuildJobs(selected.id, buildJobsEnabled);
  }, [refreshBuildJobs, selected.id, buildJobsEnabled]);

  const hasActiveBuildJob = buildJobs.some((job) => job.status === "pending" || job.status === "processing");

  useEffect(() => {
    if (!hasActiveBuildJob || !buildJobsEnabled) return;
    const timer = window.setInterval(() => { void refreshBuildJobs(selected.id, true, true); }, 10_000);
    return () => window.clearInterval(timer);
  }, [hasActiveBuildJob, buildJobsEnabled, refreshBuildJobs, selected.id]);

  async function fetchLatestBranchCommit() {
    if (!selected.repositoryUrl || !selected.branch || buildCommitLoading) return;
    setBuildCommitLoading(true);
    setBuildJobsError("");
    try {
      const response = await fetch("/api/github/repository?url=" + encodeURIComponent(selected.repositoryUrl), { cache: "no-store" });
      const data = await response.json() as Partial<RepositoryInfo> & { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not read the latest branch commit.");
      const commit = data.branches?.find((branch) => branch.name === selected.branch)?.commit;
      if (!commit || !/^[a-f0-9]{40}$/.test(commit)) throw new Error("The saved branch " + selected.branch + " was not found in the repository.");
      setBuildCommitSha(commit);
    } catch (error) {
      setBuildJobsError(error instanceof Error ? error.message : "Could not read the latest branch commit.");
    } finally { setBuildCommitLoading(false); }
  }

  async function queueBuildJob() {
    const sha = buildCommitSha.trim().toLowerCase();
    if (!selected.id || !buildJobsEnabled || buildQueueing || !/^[a-f0-9]{40}$/.test(sha)) return;
    setBuildQueueing(true);
    setBuildJobsError("");
    try {
      const response = await fetch("/api/projects/" + encodeURIComponent(selected.id) + "/build-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceCommitSha: sha, framework: buildFramework, packageManager: buildPackageManager }),
      });
      const data = await response.json() as { job?: BuildJob; error?: string };
      if (!response.ok || !data.job) throw new Error(data.error || "The build could not be queued.");
      setBuildJobs((current) => [data.job as BuildJob, ...current.filter((job) => job.id !== data.job?.id)]);
      setNotice("Build queued for commit " + sha.slice(0, 7) + ". It runs when the build worker and isolated runner pick it up.");
    } catch (error) {
      setBuildJobsError(error instanceof Error ? error.message : "The build could not be queued.");
    } finally { setBuildQueueing(false); }
  }

  async function cancelBuildJob(jobId: string) {
    if (!selected.id || buildCancelling) return;
    setBuildCancelling(jobId);
    setBuildJobsError("");
    try {
      const response = await fetch("/api/projects/" + encodeURIComponent(selected.id) + "/build-jobs/" + encodeURIComponent(jobId), { method: "DELETE" });
      const data = await response.json() as { job?: BuildJob; error?: string };
      if (!response.ok || !data.job) throw new Error(data.error || "The build job could not be cancelled.");
      setBuildJobs((current) => current.map((job) => job.id === jobId ? { ...job, ...data.job } : job));
    } catch (error) {
      setBuildJobsError(error instanceof Error ? error.message : "The build job could not be cancelled.");
    } finally { setBuildCancelling(null); }
  }

  return {
    buildJobs,
    setBuildJobs,
    buildJobsLoading,
    buildJobsError,
    buildFramework,
    setBuildFramework,
    buildPackageManager,
    setBuildPackageManager,
    buildCommitSha,
    setBuildCommitSha,
    buildCommitLoading,
    buildQueueing,
    buildCancelling,
    refreshBuildJobs,
    buildJobsEnabled,
    hasActiveBuildJob,
    fetchLatestBranchCommit,
    queueBuildJob,
    cancelBuildJob,
  };
}
