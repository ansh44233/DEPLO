const SEGMENT = /^[A-Za-z0-9_.-]{1,100}$/;

/**
 * True for an `owner/repository` name that is safe to put into an API path.
 * Rejects `.` and `..` segments: they pass the character check but are dot-segments,
 * so `https://api.github.com/repos/../x` would resolve to a different endpoint.
 */
export function isValidRepositoryFullName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = value.split("/");
  return parts.length === 2 && parts.every((part) => SEGMENT.test(part) && part !== "." && part !== "..");
}

/** The repository half of a validated `owner/repository` name. */
export function repositoryNameOf(fullName: string): string {
  if (!isValidRepositoryFullName(fullName)) throw new Error("Invalid repository name.");
  return fullName.split("/")[1];
}
