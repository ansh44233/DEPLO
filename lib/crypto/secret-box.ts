import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "sb1";

/** Derives a purpose-specific key so one server secret can protect different data types independently. */
function deriveKey(secret: string, purpose: string): Buffer {
  if (secret.length < 32) throw new Error("The encryption secret must contain at least 32 characters.");
  return createHash("sha256").update("deplo:" + purpose + ":" + secret, "utf8").digest();
}

export function sealSecret(plaintext: string, secret: string, purpose: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret, purpose), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [PREFIX, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function openSecret(sealed: string, secret: string, purpose: string): string | null {
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX) return null;
  try {
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret, purpose), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
