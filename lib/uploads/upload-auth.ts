import { timingSafeEqual } from "node:crypto";

export function isAuthorizedUploadRequest(
  authorization: string | null,
  configuredToken: string,
): boolean {
  if (!authorization || configuredToken.length < 32) return false;
  const prefix = "Bearer ";
  if (!authorization.startsWith(prefix)) return false;

  const supplied = Buffer.from(authorization.slice(prefix.length));
  const expected = Buffer.from(configuredToken);
  if (supplied.length !== expected.length) return false;
  return timingSafeEqual(supplied, expected);
}
