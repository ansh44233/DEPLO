import { createHash } from "node:crypto";
import { EncryptJWT, jwtDecrypt } from "jose";

const COOKIE_NAME = "deplo_github_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

function getEncryptionKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET must be configured with at least 32 characters.");
  }
  return createHash("sha256").update(secret).digest();
}

export async function encryptGitHubSession(accessToken: string, login: string) {
  return new EncryptJWT({ accessToken, login })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .encrypt(getEncryptionKey());
}

export async function decryptGitHubSession(value: string) {
  const { payload } = await jwtDecrypt(value, getEncryptionKey());
  if (typeof payload.accessToken !== "string" || typeof payload.login !== "string") {
    throw new Error("Invalid GitHub session payload.");
  }
  return { accessToken: payload.accessToken, login: payload.login };
}

export const githubSessionCookieName = COOKIE_NAME;
export const githubSessionMaxAge = SESSION_TTL_SECONDS;
