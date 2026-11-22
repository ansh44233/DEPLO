import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration0011 = readFileSync(join(process.cwd(), "supabase/migrations/0011_recovery_inventory_nonces.sql"), "utf8");
const migration0012 = readFileSync(join(process.cwd(), "supabase/migrations/0012_recovery_inventory_nonce_retention.sql"), "utf8");

function functionBody(source: string, functionName: string): string {
  const start = source.indexOf("create or replace function public." + functionName);
  assert.notEqual(start, -1, "missing function " + functionName);
  const end = source.indexOf("$$;", source.indexOf("as $$", start));
  assert.notEqual(end, -1, "unterminated function " + functionName);
  return source.slice(start, end + 3);
}

test("nonce ledger is job-bound, expires, and is inaccessible to browser roles", () => {
  assert.match(migration0011, /nonce uuid primary key/i);
  assert.match(migration0011, /job_id uuid not null references public\.build_jobs\(id\) on delete cascade/i);
  assert.match(migration0011, /expires_at timestamptz not null/i);
  assert.match(migration0011, /consumed_at timestamptz/i);
  assert.match(migration0011, /enable row level security/i);
  assert.match(migration0011, /revoke all on public\.build_recovery_inventory_nonces from public, anon, authenticated/i);
  assert.match(migration0011, /grant all on public\.build_recovery_inventory_nonces to service_role/i);
});

test("nonce issuance enforces a short future expiry and does not overwrite collisions", () => {
  const body = functionBody(migration0011, "issue_deplo_recovery_inventory_nonce");
  assert.match(body, /p_expires_at <= now\(\)/i);
  assert.match(body, /p_expires_at > now\(\) \+ interval '2 minutes'/i);
  assert.match(body, /on conflict \(nonce\) do nothing/i);
  assert.match(migration0011, /grant execute on function public\.issue_deplo_recovery_inventory_nonce\(uuid, uuid, timestamptz\) to service_role/i);
});

test("nonce consumption is a single conditional update scoped to nonce, job, expiry and unused state", () => {
  const body = functionBody(migration0011, "consume_deplo_recovery_inventory_nonce");
  assert.match(body, /update public\.build_recovery_inventory_nonces/i);
  assert.match(body, /where nonce = p_nonce/i);
  assert.match(body, /and job_id = p_job_id/i);
  assert.match(body, /and consumed_at is null/i);
  assert.match(body, /and expires_at > now\(\)/i);
  assert.match(body, /return found/i);
  assert.match(migration0011, /grant execute on function public\.consume_deplo_recovery_inventory_nonce\(uuid, uuid\) to service_role/i);
});

test("retention cleanup is bounded, retains seven days, and skips locked rows", () => {
  const body = functionBody(migration0012, "prune_deplo_recovery_inventory_nonces");
  assert.match(body, /p_batch_size < 1 or p_batch_size > 1000/i);
  assert.match(body, /coalesce\(consumed_at, expires_at\) < now\(\) - interval '7 days'/i);
  assert.match(body, /order by created_at asc/i);
  assert.match(body, /limit p_batch_size/i);
  assert.match(body, /for update skip locked/i);
  assert.match(body, /get diagnostics deleted_count = row_count/i);
  assert.match(migration0012, /revoke all on function public\.prune_deplo_recovery_inventory_nonces\(integer\) from public, anon, authenticated/i);
  assert.match(migration0012, /grant execute on function public\.prune_deplo_recovery_inventory_nonces\(integer\) to service_role/i);
});
