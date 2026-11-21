export function isValidGitHubBranch(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(value) &&
    !value.includes("..") &&
    !value.endsWith("/") &&
    !value.includes("//");
}

export function isValidDeploymentSlug(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,57}$/.test(value);
}
