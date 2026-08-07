export function nextAuditVersion(existingVersions: readonly number[]): number {
  return existingVersions.length === 0
    ? 1
    : Math.max(...existingVersions) + 1;
}

export function selectLatestSuccessfulVersion<
  T extends { versionNumber: number; outcome: string },
>(versions: readonly T[]): T | undefined {
  return versions
    .filter((version) => version.outcome === "succeeded")
    .sort((a, b) => b.versionNumber - a.versionNumber)[0];
}
