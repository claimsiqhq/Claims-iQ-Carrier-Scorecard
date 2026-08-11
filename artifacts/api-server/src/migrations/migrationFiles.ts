export const MIGRATION_FILE_PATTERN = /^(?:\d{4}|\d{14})_.+\.sql$/;

export function isMigrationFilename(name: string): boolean {
  return MIGRATION_FILE_PATTERN.test(name);
}

export function removeOuterTransaction(contents: string): string {
  const normalized = contents.replace(/^\uFEFF/, "");
  const leadingTransaction = normalized.match(
    /^((?:(?:\s+)|(?:--[^\r\n]*(?:\r?\n|$))|(?:\/\*[\s\S]*?\*\/))*)BEGIN;\s*/i,
  );
  if (!leadingTransaction) return normalized;

  const body = normalized.slice(leadingTransaction[0].length);
  if (!/\s*COMMIT;\s*$/i.test(body)) return normalized;

  return `${leadingTransaction[1] ?? ""}${body.replace(/\s*COMMIT;\s*$/i, "")}`;
}
