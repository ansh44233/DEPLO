export type MigrationInventoryResult = Readonly<{
  valid: boolean;
  ordered: readonly string[];
  errors: readonly string[];
}>;

const MIGRATION_FILE = /^(\d{4})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;

export function validateMigrationInventory(fileNames: readonly string[]): MigrationInventoryResult {
  const errors: string[] = [];
  const entries: Array<{ sequence: number; name: string }> = [];

  if (fileNames.length === 0) {
    errors.push("No SQL migration files were found.");
  }

  for (const name of fileNames) {
    const match = MIGRATION_FILE.exec(name);
    if (!match) {
      errors.push(`Invalid migration filename: ${name}`);
      continue;
    }

    entries.push({ sequence: Number(match[1]), name });
  }

  entries.sort((a, b) => a.sequence - b.sequence || a.name.localeCompare(b.name));

  const seen = new Set<number>();
  for (const entry of entries) {
    if (seen.has(entry.sequence)) {
      errors.push(`Duplicate migration sequence: ${String(entry.sequence).padStart(4, "0")}`);
    }
    seen.add(entry.sequence);
  }

  if (entries.length > 0 && entries[0].sequence !== 1) {
    errors.push("Migration sequence must start at 0001.");
  }

  for (let index = 0; index < entries.length; index += 1) {
    const expected = index + 1;
    if (entries[index].sequence !== expected) {
      errors.push(
        `Migration sequence gap: expected ${String(expected).padStart(4, "0")}, found ${String(entries[index].sequence).padStart(4, "0")}.`,
      );
    }
  }

  return Object.freeze({
    valid: errors.length === 0,
    ordered: Object.freeze(entries.map((entry) => entry.name)),
    errors: Object.freeze(errors),
  });
}
