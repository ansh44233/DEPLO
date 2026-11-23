import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isAllowedGitHubUser } from "./access-policy";

export type DeploUser = {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
};

/** `sid` identifies one sign-in so it can be revoked at sign-out (see lib/db/supabase-session-revocations.ts). */
type SessionPayload = DeploUser & { exp: number; iat?: number; sid?: string };

export const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

function sign(value: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(value).digest();
}

export function createSessionToken(
  user: DeploUser,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  if (secret.length < 32) throw new Error("DEPLO_SESSION_SECRET must contain at least 32 characters.");
  const payload: SessionPayload = { ...user, iat: nowSeconds, exp: nowSeconds + SESSION_TTL_SECONDS, sid: randomBytes(16).toString("base64url") };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return encoded + "." + sign(encoded, secret).toString("base64url");
}

export function verifySessionToken(
  token: string | undefined,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): DeploUser | null {
  const claims = verifySessionClaims(token, secret, nowSeconds);
  return claims ? claims.user : null;
}

/** Verifies a session token and also returns its sign-in ID and expiry. */
export function verifySessionClaims(
  token: string | undefined,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  env: Record<string, string | undefined> = process.env,
): { user: DeploUser; sid: string | null; exp: number } | null {
  if (!token || secret.length < 32) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  let supplied: Buffer;
  try {
    supplied = Buffer.from(parts[1], "base64url");
  } catch {
    return null;
  }
  const expected = sign(parts[0], secret);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Partial<SessionPayload>;
    if (
      !Number.isSafeInteger(payload.id) || (payload.id ?? 0) <= 0 ||
      typeof payload.login !== "string" || !/^[a-zA-Z0-9-]{1,39}$/.test(payload.login) ||
      typeof payload.exp !== "number" || !Number.isSafeInteger(payload.exp) || payload.exp <= nowSeconds ||
      !(payload.name === null || typeof payload.name === "string") ||
      !(payload.avatarUrl === null || typeof payload.avatarUrl === "string") ||
      !(payload.sid === undefined || (typeof payload.sid === "string" && SESSION_ID_PATTERN.test(payload.sid)))
    ) return null;
    // Removing someone from the allowlist ends their existing sessions too.
    if (!isAllowedGitHubUser({ id: payload.id as number, login: payload.login }, env)) return null;

    return {
      user: {
        id: payload.id as number,
        login: payload.login,
        name: payload.name ?? null,
        avatarUrl: payload.avatarUrl ?? null,
      },
      // Sessions issued before sign-in IDs existed have none; they still expire on schedule.
      sid: payload.sid ?? null,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}

/**
 * Reads the sign-in ID from a session cookie WITHOUT checking its signature.
 * Only for the revocation lookup in middleware; routes still verify the token.
 */
export function unverifiedSessionId(token: string | undefined): string | null {
  const encoded = token?.split(".")[0];
  if (!encoded || encoded.length > 4096) return null;
  try {
    const sid = (JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as { sid?: unknown }).sid;
    return typeof sid === "string" && SESSION_ID_PATTERN.test(sid) ? sid : null;
  } catch {
    return null;
  }
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
