/**
 * HTTP security policy for every DEPLO response, applied by middleware.ts.
 * Kept free of Next.js imports so it can be unit tested directly.
 */

type Env = Record<string, string | undefined>;

/** API paths that authenticate with their own secrets or signatures, not the session cookie. */
const NON_COOKIE_API_PATHS = ["/api/webhooks", "/api/internal", "/api/uploads"];
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function originOf(value: string | undefined | null): string | null {
  if (!value) return null;
  try { return new URL(value).origin; } catch { return null; }
}

/**
 * Cross-site request forgery check for cookie-authenticated API calls.
 * Session cookies are SameSite=Lax already; this also refuses state-changing
 * requests that a browser marks as coming from another site.
 */
export function crossSiteRejection(request: {
  method: string;
  pathname: string;
  requestOrigin: string;
  origin: string | null;
  secFetchSite: string | null;
}, env: Env = process.env): string | null {
  if (!UNSAFE_METHODS.has(request.method.toUpperCase())) return null;
  if (!request.pathname.startsWith("/api/")) return null;
  if (NON_COOKIE_API_PATHS.some((path) => request.pathname === path || request.pathname.startsWith(path + "/"))) return null;

  const allowed = new Set([request.requestOrigin, originOf(env.DEPLO_BASE_URL)].filter((value): value is string => Boolean(value)));
  if (request.origin !== null) {
    // Browsers send "null" for opaque origins (sandboxed frames, some redirects).
    return allowed.has(request.origin) ? null : "Request origin could not be verified.";
  }
  // No Origin header: allowed for non-browser clients, but not when the browser says the request is cross-site.
  if (request.secFetchSite === "cross-site") return "Request origin could not be verified.";
  return null;
}

/** Security headers for every response. */
export function securityHeaders(options: { https: boolean; development?: boolean; nonce?: string }, env: Env = process.env): Record<string, string> {
  const supabase = originOf(env.SUPABASE_URL?.trim());
  const csp = [
    "default-src 'self'",
    // Pages carry a per-request nonce that Next.js puts on its own scripts, so no inline
    // script without it runs. Development also needs eval for fast refresh.
    (options.nonce
      ? "script-src 'self' 'nonce-" + options.nonce + "' 'strict-dynamic'"
      : "script-src 'self'") + (options.development ? " 'unsafe-eval'" : ""),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    // Large uploads go straight from the browser to a Supabase Storage signed URL.
    "connect-src 'self'" + (supabase ? " " + supabase : "") + (options.development ? " ws: wss:" : ""),
    // Live previews of deployed sites (pages.dev and custom domains).
    "frame-src https:",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://github.com",
    ...(options.https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
  return {
    "Content-Security-Policy": csp,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "X-DNS-Prefetch-Control": "off",
    ...(options.https ? { "Strict-Transport-Security": "max-age=63072000; includeSubDomains" } : {}),
  };
}
