import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** v1: a bare OAuth token. v2: JSON credentials, including a refresh token for GitHub App sign-in. */
const V1 = "v1";
const V2 = "v2";
const MAX_PLAINTEXT = 8192;

/** A signed-in user's GitHub credentials. Expiring tokens come from GitHub App sign-in. */
export type GitHubCredentials = {
  accessToken: string;
  /** Present for GitHub App user tokens; exchanged for a new access token when it expires. */
  refreshToken: string | null;
  /** Unix seconds when the access token expires; null for tokens that do not expire. */
  expiresAt: number | null;
  /** Unix seconds when the refresh token expires. */
  refreshExpiresAt: number | null;
};

function encryptionKey(secret: string): Buffer {
  if (secret.length < 32) throw new Error("GITHUB_TOKEN_ENCRYPTION_KEY must contain at least 32 characters.");
  return createHash("sha256").update(secret, "utf8").digest();
}

function seal(prefix: string, plaintext: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [prefix, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

function open(value: string | undefined, secret: string): { prefix: string; plaintext: string } | null {
  if (!value || secret.length < 32) return null;
  const parts = value.split(".");
  if (parts.length !== 4 || (parts[0] !== V1 && parts[0] !== V2)) return null;
  try {
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const ciphertext = Buffer.from(parts[3], "base64url");
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0 || ciphertext.length > MAX_PLAINTEXT) return null;
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    return { prefix: parts[0], plaintext };
  } catch {
    return null;
  }
}

function validToken(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4096;
}

function validTime(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value) && value > 0);
}

/** Encrypt a GitHub OAuth token for storage in an HttpOnly cookie (legacy single-token format). */
export function encryptGitHubToken(token: string, secret: string): string {
  if (!validToken(token)) throw new Error("Invalid GitHub OAuth token.");
  return seal(V1, token, secret);
}

/** Encrypt GitHub credentials (access token, refresh token, expiry) for the HttpOnly cookie. */
export function encryptGitHubCredentials(credentials: GitHubCredentials, secret: string): string {
  if (!validToken(credentials.accessToken) || !(credentials.refreshToken === null || validToken(credentials.refreshToken)) ||
    !validTime(credentials.expiresAt) || !validTime(credentials.refreshExpiresAt)) {
    throw new Error("Invalid GitHub credentials.");
  }
  return seal(V2, JSON.stringify({
    a: credentials.accessToken, r: credentials.refreshToken, e: credentials.expiresAt, re: credentials.refreshExpiresAt,
  }), secret);
}

/** Decrypt credentials from either cookie format; tampered or malformed values return null. */
export function decryptGitHubCredentials(value: string | undefined, secret: string): GitHubCredentials | null {
  const opened = open(value, secret);
  if (!opened) return null;
  if (opened.prefix === V1) {
    return validToken(opened.plaintext) ? { accessToken: opened.plaintext, refreshToken: null, expiresAt: null, refreshExpiresAt: null } : null;
  }
  try {
    const data = JSON.parse(opened.plaintext) as { a?: unknown; r?: unknown; e?: unknown; re?: unknown };
    const refreshToken = data.r ?? null;
    const expiresAt = data.e ?? null;
    const refreshExpiresAt = data.re ?? null;
    if (!validToken(data.a) || !(refreshToken === null || validToken(refreshToken)) || !validTime(expiresAt) || !validTime(refreshExpiresAt)) return null;
    return { accessToken: data.a, refreshToken, expiresAt, refreshExpiresAt };
  } catch {
    return null;
  }
}

/** Decrypt a token only on the server; tampered or malformed values return null. */
export function decryptGitHubToken(value: string | undefined, secret: string): string | null {
  return decryptGitHubCredentials(value, secret)?.accessToken ?? null;
}
