import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "v1";

function encryptionKey(secret: string): Buffer {
  if (secret.length < 32) throw new Error("GITHUB_TOKEN_ENCRYPTION_KEY must contain at least 32 characters.");
  return createHash("sha256").update(secret, "utf8").digest();
}

/** Encrypt a GitHub OAuth token for storage in an HttpOnly cookie. */
export function encryptGitHubToken(token: string, secret: string): string {
  if (!token || token.length > 4096) throw new Error("Invalid GitHub OAuth token.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

/** Decrypt a token only on the server; tampered or malformed values return null. */
export function decryptGitHubToken(value: string | undefined, secret: string): string | null {
  if (!value || secret.length < 32) return null;
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;
  try {
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const ciphertext = Buffer.from(parts[3], "base64url");
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0 || ciphertext.length > 4096) return null;
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), iv);
    decipher.setAuthTag(tag);
    const token = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    return token.length > 0 && token.length <= 4096 ? token : null;
  } catch {
    return null;
  }
}
