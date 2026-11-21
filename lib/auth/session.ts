import { createHmac, timingSafeEqual } from "node:crypto";

export type DeploUser = {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
};

type SessionPayload = DeploUser & { exp: number };

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
  const payload: SessionPayload = { ...user, exp: nowSeconds + SESSION_TTL_SECONDS };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return encoded + "." + sign(encoded, secret).toString("base64url");
}

export function verifySessionToken(
  token: string | undefined,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): DeploUser | null {
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
      !(payload.avatarUrl === null || typeof payload.avatarUrl === "string")
    ) return null;

    return {
      id: payload.id as number,
      login: payload.login,
      name: payload.name ?? null,
      avatarUrl: payload.avatarUrl ?? null,
    };
  } catch {
    return null;
  }
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
