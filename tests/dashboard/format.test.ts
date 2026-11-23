import test from "node:test";
import assert from "node:assert/strict";
import { cap, describeBuildJob, fmtElapsed, hostOf, parseDotenv, slugify, stableSiteUrl, timeAgo, toneClass } from "../../lib/dashboard/format";
import type { BuildJob } from "../../lib/dashboard/types";

const NOW = Date.UTC(2026, 10, 23, 12, 0, 0);

test("timeAgo reads naturally from seconds up to weeks", (t) => {
  t.mock.method(Date, "now", () => NOW);
  const ago = (seconds: number) => timeAgo(NOW - seconds * 1000);
  assert.equal(ago(5), "just now");
  assert.equal(ago(44), "just now");
  assert.equal(ago(120), "2m ago");
  assert.equal(ago(59 * 60), "59m ago");
  assert.equal(ago(3 * 3600), "3h ago");
  assert.equal(ago(23 * 3600), "23h ago");
  assert.equal(ago(5 * 86400), "5d ago");
  assert.equal(ago(29 * 86400), "29d ago");
});

test("timeAgo falls back to a date after a month and a dash for bad input", (t) => {
  t.mock.method(Date, "now", () => NOW);
  assert.match(timeAgo(NOW - 90 * 86400 * 1000), /\d{4}/);
  assert.equal(timeAgo("not a date"), "—");
  assert.equal(timeAgo(Number.NaN), "—");
});

test("stableSiteUrl turns an old per-deployment URL into the stable project URL", () => {
  assert.equal(stableSiteUrl("https://abcd1234.deplo-x-site.pages.dev"), "https://deplo-x-site.pages.dev");
  assert.equal(stableSiteUrl("https://abcd1234.deplo-x-site.pages.dev/"), "https://deplo-x-site.pages.dev");
  assert.equal(stableSiteUrl("https://deplo-x-site.pages.dev"), "https://deplo-x-site.pages.dev");
  assert.equal(stableSiteUrl("https://example.com"), "https://example.com");
  assert.equal(stableSiteUrl("https://abcd1234.example.com"), "https://abcd1234.example.com");
  assert.equal(stableSiteUrl(null), null);
});

test("hostOf returns the host, or the input when it is not a URL", () => {
  assert.equal(hostOf("https://site.pages.dev/path?x=1"), "site.pages.dev");
  assert.equal(hostOf("not a url"), "not a url");
});

test("cap upper-cases the first letter only", () => {
  assert.equal(cap("blocked"), "Blocked");
  assert.equal(cap(""), "");
});

test("toneClass maps build tones to CSS status names", () => {
  assert.equal(toneClass("healthy"), "ready");
  assert.equal(toneClass("failed"), "error");
  assert.equal(toneClass("building"), "building");
  assert.equal(toneClass("queued"), "idle");
});

const job = (over: Partial<BuildJob>): BuildJob => ({
  id: "j", source_commit_sha: "a".repeat(40), framework: "vite", package_manager: "npm", output_directory: "dist",
  status: "pending", attempt_count: 0, max_attempts: 3, available_at: "", error_code: null, created_at: "", updated_at: "", ...over,
});

test("describeBuildJob reports the most specific state first", () => {
  assert.deepEqual(describeBuildJob(job({ status: "succeeded" })), { label: "Deployed", tone: "healthy" });
  assert.deepEqual(describeBuildJob(job({ status: "failed" })), { label: "Failed", tone: "failed" });
  assert.deepEqual(describeBuildJob(job({ status: "cancelled" })), { label: "Cancelled", tone: "failed" });
  assert.deepEqual(describeBuildJob(job({ status: "processing", artifact_id: "a" })), { label: "Publishing", tone: "building" });
  assert.deepEqual(describeBuildJob(job({ status: "processing", runner_status: "running" })), { label: "Building", tone: "building" });
  assert.deepEqual(describeBuildJob(job({ status: "processing", runner_status: "queued" })), { label: "Queued on runner", tone: "queued" });
  assert.deepEqual(describeBuildJob(job({ status: "processing" })), { label: "Submitting", tone: "building" });
  assert.deepEqual(describeBuildJob(job({ status: "pending", attempt_count: 2 })), { label: "Retry queued", tone: "queued" });
  assert.deepEqual(describeBuildJob(job({ status: "pending" })), { label: "Queued", tone: "queued" });
});

test("fmtElapsed formats minutes and zero-padded seconds", () => {
  assert.equal(fmtElapsed(0), "0:00");
  assert.equal(fmtElapsed(7), "0:07");
  assert.equal(fmtElapsed(65), "1:05");
  assert.equal(fmtElapsed(754), "12:34");
});

test("slugify makes safe, bounded project slugs", () => {
  assert.equal(slugify("My Cool Site!"), "my-cool-site");
  assert.equal(slugify("  --Hello__World--  "), "hello-world");
  assert.equal(slugify("a".repeat(80)).length, 58);
  assert.equal(slugify("***"), "");
});

test("parseDotenv reads KEY=value lines and ignores everything else", () => {
  const parsed = parseDotenv([
    "# a comment",
    "VITE_API_URL=https://api.example.com",
    'QUOTED="two words"',
    "SINGLE='x'",
    "export EXPORTED=1",
    "TRAILING=value # note",
    "  SPACED  =  padded  ",
    "bad line",
    "1BAD=nope",
    "",
  ].join("\r\n"));
  assert.deepEqual(parsed, [
    { key: "VITE_API_URL", value: "https://api.example.com" },
    { key: "QUOTED", value: "two words" },
    { key: "SINGLE", value: "x" },
    { key: "EXPORTED", value: "1" },
    { key: "TRAILING", value: "value" },
    { key: "SPACED", value: "padded" },
  ]);
  assert.deepEqual(parseDotenv(""), []);
  assert.deepEqual(parseDotenv("# only a comment"), []);
});
