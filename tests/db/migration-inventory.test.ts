import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { validateMigrationInventory } from "../../lib/db/migration-inventory";

test("repository migration inventory is contiguous and correctly named", () => {
  const directory = join(process.cwd(), "supabase", "migrations");
  const files = readdirSync(directory).filter((name) => name.endsWith(".sql"));
  const result = validateMigrationInventory(files);

  assert.equal(result.valid, true, result.errors.join("\n"));
  assert.equal(result.ordered.length, 12);
  assert.equal(result.ordered[0], "0001_account_projects.sql");
  assert.equal(result.ordered[11], "0012_recovery_inventory_nonce_retention.sql");
});

test("rejects an empty inventory and a sequence that does not start at 0001", () => {
  assert.equal(validateMigrationInventory([]).valid, false);
  const result = validateMigrationInventory(["0002_second.sql"]);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /start at 0001/);
});

test("rejects missing sequence numbers", () => {
  const result = validateMigrationInventory(["0001_first.sql", "0003_third.sql"]);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /sequence gap/);
});

test("rejects duplicate sequence numbers and malformed SQL filenames", () => {
  const result = validateMigrationInventory([
    "0001_first.sql",
    "0001_duplicate.sql",
    "0002-BAD.sql",
  ]);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /Duplicate migration sequence/);
  assert.match(result.errors.join(" "), /Invalid migration filename/);
});

test("returns a numerically ordered immutable inventory", () => {
  const result = validateMigrationInventory(["0002_second.sql", "0001_first.sql"]);
  assert.equal(result.valid, true);
  assert.deepEqual(result.ordered, ["0001_first.sql", "0002_second.sql"]);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.ordered), true);
  assert.equal(Object.isFrozen(result.errors), true);
});
