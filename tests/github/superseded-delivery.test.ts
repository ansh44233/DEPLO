import test from "node:test";
import assert from "node:assert/strict";
import { hasNewerDelivery, newerDeliveryQuery } from "../../lib/github/superseded-delivery";

const base = "https://db.example.supabase.co";
const push = { delivery_id: "d-1", repository_full_name: "acme/site", branch: "main", received_at: "2026-11-24T10:00:00Z", pull_request_number: null };

test("looks for a newer push to the same repository and branch, excluding itself", () => {
  const url = newerDeliveryQuery(base, push)!;
  assert.equal(url.pathname, "/rest/v1/github_webhook_deliveries");
  assert.equal(url.searchParams.get("repository_full_name"), "eq.acme/site");
  assert.equal(url.searchParams.get("branch"), "eq.main");
  assert.equal(url.searchParams.get("pull_request_number"), "is.null");
  assert.equal(url.searchParams.get("received_at"), "gt.2026-11-24T10:00:00.000Z");
  assert.equal(url.searchParams.get("status"), "in.(received,processing,deployed)");
  assert.equal(url.searchParams.get("delivery_id"), "neq.d-1");
  assert.equal(newerDeliveryQuery(base, { ...push, pull_request_number: 7 })!.searchParams.get("pull_request_number"), "eq.7", "previews compare within their own pull request");
  assert.equal(newerDeliveryQuery(base, { ...push, received_at: null }), null);
});

test("a newer delivery means skip; none, an error or an outage means publish", async () => {
  const answer = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  assert.equal(await hasNewerDelivery(base, "key", push, answer([{ delivery_id: "d-2" }])), true);
  assert.equal(await hasNewerDelivery(base, "key", push, answer([])), false);
  assert.equal(await hasNewerDelivery(base, "key", push, answer({ message: "boom" }, 500)), false);
  assert.equal(await hasNewerDelivery(base, "key", push, (async () => { throw new Error("down"); }) as typeof fetch), false);
  assert.equal(await hasNewerDelivery(base, "key", { ...push, received_at: undefined }, answer([{ delivery_id: "d-2" }])), false);
});
