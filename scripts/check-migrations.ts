import { readdirSync } from "node:fs";
import { join } from "node:path";
import { validateMigrationInventory } from "../lib/db/migration-inventory";

const directory = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(directory).filter((name) => name.endsWith(".sql"));
const result = validateMigrationInventory(files);

if (!result.valid) {
  console.error("Migration inventory validation failed:");
  for (const error of result.errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Migration inventory valid: ${result.ordered.length} ordered SQL migrations.`);
}
