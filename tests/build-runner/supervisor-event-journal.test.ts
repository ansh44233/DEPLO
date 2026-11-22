import test from "node:test";
import assert from "node:assert/strict";
import {
  appendSupervisorEvent,
  createSupervisorJournal,
} from "../../services/build-runner/src/supervisor-event-journal";

test("appends ordered immutable lifecycle events with derived state", () => {
  const first = appendSupervisorEvent(createSupervisorJournal(), {
    eventId: "event_0001",
    event: "prepare",
    occurredAt: "2026-11-22T00:00:00.000Z",
  });
  const second = appendSupervisorEvent(first, {
    eventId: "event_0002",
    event: "start",
    occurredAt: "2026-11-22T00:00:01.000Z",
    evidence: { hostPreflightPassed: true },
  });
  assert.equal(second.sequence, 2);
  assert.equal(second.state, "starting");
  assert.deepEqual(second.events.map(item => [item.sequence, item.from, item.to]), [
    [1, "queued", "preparing"],
    [2, "preparing", "starting"],
  ]);
  assert.equal(Object.isFrozen(second), true);
  assert.equal(Object.isFrozen(second.events), true);
  assert.equal(Object.isFrozen(second.events[1].evidence), true);
});

test("identical event retries are idempotent and conflicting retries fail", () => {
  const journal = appendSupervisorEvent(createSupervisorJournal(), {
    eventId: "event_0001",
    event: "prepare",
    occurredAt: "2026-11-22T00:00:00.000Z",
  });
  const retry = appendSupervisorEvent(journal, {
    eventId: "event_0001",
    event: "prepare",
    occurredAt: "2026-11-22T00:00:00.000Z",
  });
  assert.equal(retry, journal);
  assert.throws(() => appendSupervisorEvent(journal, {
    eventId: "event_0001",
    event: "cancel",
    occurredAt: "2026-11-22T00:00:00.000Z",
  }), /supervisor_event_id_conflict/);
});

test("rejects invalid IDs, non-canonical timestamps and out-of-order events", () => {
  const journal = createSupervisorJournal();
  assert.throws(() => appendSupervisorEvent(journal, {
    eventId: "short", event: "prepare", occurredAt: "2026-11-22T00:00:00.000Z",
  }), /invalid_supervisor_event_id/);
  assert.throws(() => appendSupervisorEvent(journal, {
    eventId: "event_0001", event: "prepare", occurredAt: "not-a-date",
  }), /invalid_supervisor_event_timestamp/);
  const first = appendSupervisorEvent(journal, {
    eventId: "event_0001", event: "prepare", occurredAt: "2026-11-22T00:00:02.000Z",
  });
  assert.throws(() => appendSupervisorEvent(first, {
    eventId: "event_0002", event: "start", occurredAt: "2026-11-22T00:00:01.000Z",
    evidence: { hostPreflightPassed: true },
  }), /supervisor_event_timestamp_not_increasing/);
});

test("rejects illegal transitions and does not mutate the prior journal", () => {
  const journal = createSupervisorJournal();
  assert.throws(() => appendSupervisorEvent(journal, {
    eventId: "event_0001", event: "started", occurredAt: "2026-11-22T00:00:00.000Z",
  }), /invalid_supervisor_transition/);
  assert.equal(journal.sequence, 0);
  assert.equal(journal.state, "queued");
  assert.equal(journal.events.length, 0);
});
