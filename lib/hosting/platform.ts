// Host-specific limits. Vercel Functions reject request bodies above 4.5 MB
// before application code runs, and their filesystem is ephemeral.
export const VERCEL_MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export function isVercelHost(env: Record<string, string | undefined> = process.env): boolean {
  return env.VERCEL === "1";
}

/** Largest upload the dashboard should send to this host, or null for the app's own limits. */
export function hostUploadLimitBytes(env: Record<string, string | undefined> = process.env): number | null {
  return isVercelHost(env) ? VERCEL_MAX_UPLOAD_BYTES : null;
}

/**
 * The legacy shared-token upload endpoints keep files on local disk between
 * requests (upload, then extract, then deploy). That needs persistent storage,
 * which serverless hosts do not provide.
 */
export function legacyDiskUploadsAvailable(env: Record<string, string | undefined> = process.env): boolean {
  return !isVercelHost(env);
}

export const LEGACY_UPLOADS_UNAVAILABLE_MESSAGE =
  "Legacy shared-token uploads need a persistent disk and are disabled on this host. Use the signed-in dashboard upload instead.";
