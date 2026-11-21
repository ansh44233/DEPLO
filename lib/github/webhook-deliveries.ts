export function sanitizeWebhookErrorCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return /^[a-z0-9_]{1,64}$/i.test(value) ? value : "deployment_failed";
}
