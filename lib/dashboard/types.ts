import type { Dispatch, SetStateAction } from "react";

export type RepositoryInfo = {
  fullName: string; description: string | null; url: string; defaultBranch: string;
  stars: number; language: string | null; branches: { name: string; commit: string }[];
};

export type DeploymentReadiness = {
  provider: "cloudflare-pages";
  configured: boolean;
  uploadAuthenticationConfigured: boolean;
  legacySharedProjectConfigured: boolean;
  ready: boolean;
  missing: string[];
  buildRunnerConfigured?: boolean;
  maxUploadBytes?: number | null;
};

export type CloudflareDeploymentLog = { timestamp: string | null; line: string };
export type CustomDomain = { id: string; name: string; status: string; validation: { method: "http" | "txt" | null; status: string; error: string | null; txtName: string | null; txtValue: string | null }; verification: { status: string; error: string | null }; createdAt: string | null };
export type WebhookDelivery = { delivery_id: string; repository_full_name: string; branch: string; commit_sha: string; status: "received" | "processing" | "deployed" | "ignored" | "failed"; received_at: string; processed_at: string | null; attempt_count: number; available_at: string; last_error_code: string | null; };
export type RecoveryAttempt = { id: string; job_id: string; recovery_key: string; journal_sequence: number; observed_state: string; disposition: string; actions: string[]; next_action_index: number; status: "pending" | "reconciling" | "completed" | "blocked"; claimed_at: string | null; error_code: string | null; created_at: string; updated_at: string; };

export type CloudflareDeployment = {
  id: string;
  url: string;
  environment: string;
  createdAt: string | null;
  branch: string | null;
  commitMessage: string | null;
  commitSha: string | null;
  status: "success" | "failure" | "building" | "unknown";
};

export type BuildJobFramework = "vite" | "react" | "create-react-app" | "nextjs-static";
export type BuildJobPackageManager = "npm" | "pnpm" | "yarn" | "bun";
export type BuildJob = {
  id: string; source_commit_sha: string; framework: BuildJobFramework; package_manager: BuildJobPackageManager;
  output_directory: string; status: "pending" | "processing" | "succeeded" | "failed" | "cancelled";
  attempt_count: number; max_attempts: number; available_at: string; error_code: string | null;
  created_at: string; updated_at: string; runner_status?: "queued" | "running" | "succeeded" | null;
  artifact_id?: string | null; artifact_file_count?: number | null; artifact_bytes?: number | null;
};

export type SignedInUser = { id: number; login: string; name: string | null; avatarUrl: string | null };
export type GitHubAppStatus = { configured: boolean; connected: boolean; accountLogin: string | null; accountType: "User" | "Organization" | null };
export type AccountProject = {
  id: string; name: string; slug: string; source_type: "github" | "zip" | "html";
  repository_url: string | null; branch: string | null; deployment_url: string | null;
  created_at: string; updated_at: string;
};

export type Project = {
  id?: string;
  slug?: string;
  sourceType?: AccountProject["source_type"];
  repositoryUrl?: string | null;
  name: string;
  domain: string;
  source: string;
  branch: string;
  status: "Healthy" | "Building" | "Failed" | "Connected";
  updated: string;
  accent: string;
};

export type RepoSummary = { fullName: string; name: string; owner: string; private: boolean; defaultBranch: string; description: string | null; language: string | null; updatedAt: string; url: string };
export type ProjectTab = "overview" | "deployments" | "builds" | "environment" | "domains" | "activity" | "settings";

export type DisplayDeployment = { id: string; message: string; commitSha: string | null; branch: string; time: string; status: string; url: string; canRollback: boolean; project: string };

export type Setter<T> = Dispatch<SetStateAction<T>>;
export type EnvVar = { key: string; value: string };

export type Modal = "github" | "repo" | "upload" | "html" | null;
