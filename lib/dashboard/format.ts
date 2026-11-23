import type { BuildJob } from "./types";

export function describeBuildJob(job: BuildJob): { label: string; tone: "healthy" | "failed" | "building" | "queued" } {
  if (job.status === "succeeded") return { label: "Deployed", tone: "healthy" };
  if (job.status === "failed") return { label: "Failed", tone: "failed" };
  if (job.status === "cancelled") return { label: "Cancelled", tone: "failed" };
  if (job.artifact_id) return { label: "Publishing", tone: "building" };
  if (job.runner_status === "running") return { label: "Building", tone: "building" };
  if (job.runner_status === "queued") return { label: "Queued on runner", tone: "queued" };
  if (job.status === "processing") return { label: "Submitting", tone: "building" };
  return { label: job.attempt_count > 0 ? "Retry queued" : "Queued", tone: "queued" };
}

export function timeAgo(value: string | number | Date): string {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "—";
  const seconds = Math.round((Date.now() - time) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes + "m ago";
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours + "h ago";
  const days = Math.round(hours / 24);
  if (days < 30) return days + "d ago";
  return new Date(time).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Older records saved a per-deployment URL (https://<hash>.<project>.pages.dev); show the stable project URL. */
export function stableSiteUrl(url: string | null): string | null {
  if (!url) return url;
  const match = /^https:\/\/[0-9a-f]{8}\.([a-z0-9-]+\.pages\.dev)\/?$/.exec(url);
  return match ? "https://" + match[1] : url;
}

export function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

export function cap(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

export function toneClass(tone: "healthy" | "failed" | "building" | "queued"): "ready" | "error" | "building" | "idle" {
  return tone === "healthy" ? "ready" : tone === "failed" ? "error" : tone === "building" ? "building" : "idle";
}

/** 0:07, 1:05, 12:30 style timer. */
export function fmtElapsed(seconds: number): string {
  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
}

/** Lower-case, hyphen-separated, at most 58 characters (the limit for Cloudflare Pages project names). */
export function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 58);
}

/** Parses the KEY=value lines of a pasted .env file; comments, blank and malformed lines are skipped. */
export function parseDotenv(text: string): { key: string; value: string }[] {
  const parsed: { key: string; value: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim().startsWith("#")) continue;
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(raw);
    if (!match) continue;
    let value = match[2].trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1); else value = value.replace(/\s+#.*$/, "");
    parsed.push({ key: match[1], value });
  }
  return parsed;
}
