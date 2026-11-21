import {
  createIsolatedBuildRequest,
  readBuildRunnerConfiguration,
  type IsolatedBuildRequest,
  type IsolatedBuildResult,
} from "@/lib/deploy/build-runner-contract";

export class AsyncBuildRunnerError extends Error {
  constructor(message: string, public readonly code: "not_configured" | "unavailable" | "invalid_response" | "rejected") {
    super(message);
    this.name = "AsyncBuildRunnerError";
  }
}
export type AsyncRunnerStatus =
  | { status: "queued" | "running" }
  | { status: "succeeded"; result: Extract<IsolatedBuildResult, { status: "succeeded" }> }
  | { status: "failed"; result: Extract<IsolatedBuildResult, { status: "failed" }> };
type DispatchInput = Omit<IsolatedBuildRequest, "limits">;
type Fetcher = typeof fetch;
const RESPONSE_LIMIT_BYTES = 16 * 1024;
async function readJsonBounded(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new AsyncBuildRunnerError("The build runner returned an empty response.", "invalid_response");
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > RESPONSE_LIMIT_BYTES) { await reader.cancel(); throw new AsyncBuildRunnerError("The build runner response exceeded the allowed size.", "invalid_response"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new AsyncBuildRunnerError("The build runner returned invalid JSON.", "invalid_response"); }
}
function jsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AsyncBuildRunnerError("The build runner returned an invalid response.", "invalid_response");
  return value as Record<string, unknown>;
}
function assertJson(response: Response) {
  if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) throw new AsyncBuildRunnerError("The build runner returned an unexpected content type.", "invalid_response");
}
function parseTerminalResult(value: unknown): IsolatedBuildResult {
  const result = jsonObject(value);
  if (result.status === "succeeded") {
    if (typeof result.artifactId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(result.artifactId) ||
        !Number.isSafeInteger(result.outputFileCount) || (result.outputFileCount as number) < 0 ||
        !Number.isSafeInteger(result.outputBytes) || (result.outputBytes as number) < 0 ||
        (result.outputFileCount as number) > 5000 || (result.outputBytes as number) > 100 * 1024 * 1024) {
      throw new AsyncBuildRunnerError("The build runner returned invalid artifact metadata.", "invalid_response");
    }
    return { status: "succeeded", artifactId: result.artifactId, outputFileCount: result.outputFileCount as number, outputBytes: result.outputBytes as number };
  }
  const errors = ["dependency_install_failed", "build_failed", "timeout", "resource_limit", "runner_error"];
  if (result.status === "failed" && typeof result.errorCode === "string" && errors.includes(result.errorCode)) {
    return { status: "failed", errorCode: result.errorCode as Extract<IsolatedBuildResult, { status: "failed" }>["errorCode"] };
  }
  throw new AsyncBuildRunnerError("The build runner returned an unsupported terminal result.", "invalid_response");
}
function runnerUrl(path: string, endpoint: URL): URL {
  const url = new URL(path, endpoint);
  if (url.origin !== endpoint.origin || (url.protocol !== "https:" && url.hostname !== "localhost")) throw new AsyncBuildRunnerError("The configured build runner URL is invalid.", "not_configured");
  return url;
}
async function requestRunner(url: URL, init: RequestInit, env: Record<string, string | undefined>, fetcher: Fetcher): Promise<Response> {
  const config = readBuildRunnerConfiguration(env);
  if (!config) throw new AsyncBuildRunnerError("The isolated build runner is not configured.", "not_configured");
  try {
    const response = await fetcher(url, {
      ...init, headers: { Authorization: "Bearer " + config.token, Accept: "application/json", ...init.headers },
      cache: "no-store", credentials: "omit", redirect: "error", signal: AbortSignal.timeout(12_000),
    });
    if (response.status === 429 || response.status >= 500) throw new AsyncBuildRunnerError("The isolated build runner is temporarily unavailable.", "unavailable");
    if (!response.ok) throw new AsyncBuildRunnerError("The isolated build runner rejected the request.", "rejected");
    assertJson(response); return response;
  } catch (error) {
    if (error instanceof AsyncBuildRunnerError) throw error;
    throw new AsyncBuildRunnerError("The isolated build runner could not be reached.", "unavailable");
  }
}
/** Idempotency-Key is the durable DEPLO job UUID; the runner must deduplicate retries by this key. */
export async function submitIsolatedBuild(input: DispatchInput, env: Record<string, string | undefined> = process.env, fetcher: Fetcher = fetch): Promise<{ runnerJobId: string }> {
  const config = readBuildRunnerConfiguration(env);
  if (!config) throw new AsyncBuildRunnerError("The isolated build runner is not configured.", "not_configured");
  const request = createIsolatedBuildRequest(input);
  const response = await requestRunner(runnerUrl("/v1/builds", config.endpoint), {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": input.jobId },
    body: JSON.stringify(request),
  }, env, fetcher);
  if (response.status !== 202) throw new AsyncBuildRunnerError("The runner must acknowledge builds with HTTP 202.", "invalid_response");
  const payload = jsonObject(await readJsonBounded(response));
  if (typeof payload.runnerJobId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(payload.runnerJobId)) throw new AsyncBuildRunnerError("The runner returned an invalid job identifier.", "invalid_response");
  return { runnerJobId: payload.runnerJobId };
}
export async function getIsolatedBuildStatus(runnerJobId: string, env: Record<string, string | undefined> = process.env, fetcher: Fetcher = fetch): Promise<AsyncRunnerStatus> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(runnerJobId)) throw new AsyncBuildRunnerError("Invalid runner job identifier.", "invalid_response");
  const config = readBuildRunnerConfiguration(env);
  if (!config) throw new AsyncBuildRunnerError("The isolated build runner is not configured.", "not_configured");
  const response = await requestRunner(runnerUrl("/v1/builds/" + encodeURIComponent(runnerJobId), config.endpoint), { method: "GET" }, env, fetcher);
  const payload = jsonObject(await readJsonBounded(response));
  if (payload.status === "queued" || payload.status === "running") return { status: payload.status };
  if (payload.status === "succeeded" || payload.status === "failed") {
    const result = parseTerminalResult(payload.result);
    if (result.status !== payload.status) throw new AsyncBuildRunnerError("Runner status and result do not match.", "invalid_response");
    if (result.status === "succeeded") return { status: "succeeded", result };
    return { status: "failed", result };
  }
  throw new AsyncBuildRunnerError("The runner returned an unsupported job status.", "invalid_response");
}
