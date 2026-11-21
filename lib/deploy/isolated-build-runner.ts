import {
  createIsolatedBuildRequest,
  readBuildRunnerConfiguration,
  type IsolatedBuildRequest,
  type IsolatedBuildResult,
} from "@/lib/deploy/build-runner-contract";

export class BuildRunnerError extends Error {
  constructor(message: string, public readonly code: "not_configured" | "unavailable" | "invalid_response" | "rejected") {
    super(message);
    this.name = "BuildRunnerError";
  }
}

type DispatchInput = Omit<IsolatedBuildRequest, "limits">;
type Fetcher = typeof fetch;
const RESPONSE_LIMIT_BYTES = 16 * 1024;
const RUNNER_TIMEOUT_MS = 650_000;

async function readJsonBounded(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new BuildRunnerError("The build runner returned an empty response.", "invalid_response");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > RESPONSE_LIMIT_BYTES) {
        await reader.cancel();
        throw new BuildRunnerError("The build runner response exceeded the allowed size.", "invalid_response");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new BuildRunnerError("The build runner returned invalid JSON.", "invalid_response");
  }
}

function parseResult(value: unknown): IsolatedBuildResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BuildRunnerError("The build runner returned an invalid result.", "invalid_response");
  }
  const result = value as Record<string, unknown>;
  if (result.status === "succeeded") {
    if (typeof result.artifactId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(result.artifactId) ||
        !Number.isSafeInteger(result.outputFileCount) || (result.outputFileCount as number) < 0 ||
        !Number.isSafeInteger(result.outputBytes) || (result.outputBytes as number) < 0 ||
        (result.outputFileCount as number) > 5000 || (result.outputBytes as number) > 100 * 1024 * 1024) {
      throw new BuildRunnerError("The build runner returned invalid artifact metadata.", "invalid_response");
    }
    return {
      status: "succeeded",
      artifactId: result.artifactId,
      outputFileCount: result.outputFileCount as number,
      outputBytes: result.outputBytes as number,
    };
  }
  const errors = ["dependency_install_failed", "build_failed", "timeout", "resource_limit", "runner_error"];
  if (result.status === "failed" && typeof result.errorCode === "string" && errors.includes(result.errorCode)) {
    return { status: "failed", errorCode: result.errorCode as Extract<IsolatedBuildResult, {status:"failed"}>["errorCode"] };
  }
  throw new BuildRunnerError("The build runner returned an unsupported result.", "invalid_response");
}

/**
 * Sends a job to an independently operated runner. This function never executes
 * repository code locally and never forwards DEPLO provider credentials.
 */
export async function dispatchIsolatedBuild(
  input: DispatchInput,
  env: Record<string, string | undefined> = process.env,
  fetcher: Fetcher = fetch,
): Promise<IsolatedBuildResult> {
  const config = readBuildRunnerConfiguration(env);
  if (!config) throw new BuildRunnerError("The isolated build runner is not configured.", "not_configured");
  const request = createIsolatedBuildRequest(input);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RUNNER_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetcher(config.endpoint, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + config.token,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(request),
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal: controller.signal,
      });
    } catch {
      throw new BuildRunnerError("The isolated build runner could not be reached.", "unavailable");
    }
    if (response.status === 429 || response.status >= 500) {
      throw new BuildRunnerError("The isolated build runner is temporarily unavailable.", "unavailable");
    }
    if (!response.ok) {
      throw new BuildRunnerError("The isolated build runner rejected the job.", "rejected");
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      throw new BuildRunnerError("The build runner returned an unexpected content type.", "invalid_response");
    }
    return parseResult(await readJsonBounded(response));
  } finally {
    clearTimeout(timeout);
  }
}
