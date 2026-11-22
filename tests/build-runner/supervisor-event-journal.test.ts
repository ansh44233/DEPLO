import test from "node:test";
import assert from "node:assert/strict";
import {
  appendSupervisorEvent,
  createSupervisorJournal,
  validateSupervisorJournal,
} from "../../services/build-runner/src/supervisor-event-journal";

function validJournal() {
  const first = appendSupervisorEvent(createSupervisorJournal(), {
    eventId: "event_0001",
    event: "prepare",
    occurredAt: "2026-11-22T00:00:00.000Z",
  });
  return appendSupervisorEvent(first, {
    eventId: "event_0002",
    event: "start",
    occurredAt: "2026-11-22T00:00:01.000Z",
    evidence: { hostPreflightPassed: true },
  });
}

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
  assert.doesNotThrow(() => validateSupervisorJournal(second));
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

test("rejects tampered sequence, state and transition chains", () => {
  const journal = validJournal();
  const [first, second] = journal.events;

  assert.throws(() => validateSupervisorJournal({ ...journal, sequence: 9 }), /invalid_supervisor_journal_snapshot/);
  assert.throws(() => validateSupervisorJournal({ ...journal, state: "running" }), /invalid_supervisor_journal_snapshot/);
  assert.throws(() => validateSupervisorJournal({
    ...journal,
    events: [{ ...first, to: "running" }, second],
  }), /invalid_supervisor_journal_snapshot/);
  assert.throws(() => validateSupervisorJournal({
    ...journal,
    events: [{ ...first, from: "preparing" }, second],
  }), /invalid_supervisor_journal_snapshot/);
});

test("rejects duplicate event IDs and non-increasing timestamps in snapshots", () => {
  const journal = validJournal();
  const [first, second] = journal.events;

  assert.throws(() => validateSupervisorJournal({
    ...journal,
    events: [first, { ...second, eventId: first.eventId }],
  }), /invalid_supervisor_journal_snapshot/);
  assert.throws(() => validateSupervisorJournal({
    ...journal,
    events: [first, { ...second, occurredAt: first.occurredAt }],
  }), /invalid_supervisor_journal_snapshot/);
});

test("rejects unknown evidence keys, non-boolean evidence and unknown event fields", () => {
  const journal = validJournal();
  const [first, second] = journal.events;

  assert.throws(() => validateSupervisorJournal({
    ...journal,
    events: [first, { ...second, evidence: { hostPreflightPassed: true, trusted: true } }],
  }), /invalid_supervisor_journal_snapshot/);
  assert.throws(() => validateSupervisorJournal({
    ...journal,
    events: [first, { ...second, evidence: { hostPreflightPassed: "yes" } }],
  }), /invalid_supervisor_journal_snapshot/);
  assert.throws(() => validateSupervisorJournal({
    ...journal,
    events: [first, { ...second, unexpected: "field" }],
  }), /invalid_supervisor_journal_snapshot/);
});

test("append refuses an inconsistent caller-supplied snapshot", () => {
  const journal = validJournal();
  const corrupted = { ...journal, state: "queued" as const };
  assert.throws(() => appendSupervisorEvent(corrupted, {
    eventId: "event_0003",
    event: "started",
    occurredAt: "2026-11-22T00:00:02.000Z",
    evidence: {
      vmIsolationVerified: true,
      resourceLimitsVerified: true,
      networkIsolationVerified: true,
    },
  }), /invalid_supervisor_journal_snapshot/);
});

test("identical retries remain idempotent when evidence key order differs", () => {
  const starting = validJournal();
  const evidence = {
    vmIsolationVerified: true,
    resourceLimitsVerified: true,
    networkIsolationVerified: true,
  };
  const appended = appendSupervisorEvent(starting, {
    eventId: "event_0003",
    event: "started",
    occurredAt: "2026-11-22T00:00:02.000Z",
    evidence,
  });
  const retry = appendSupervisorEvent(appended, {
    eventId: "event_0003",
    event: "started",
    occurredAt: "2026-11-22T00:00:02.000Z",
    evidence: {
      networkIsolationVerified: true,
      vmIsolationVerified: true,
      resourceLimitsVerified: true,
    },
  });
  assert.equal(retry, appended);
});

test("rejects null evidence instead of silently treating it as empty", () => {
  assert.throws(() => appendSupervisorEvent(createSupervisorJournal(), {
    eventId: "event_0001",
    event: "prepare",
    occurredAt: "2026-11-22T00:00:00.000Z",
    evidence: null as unknown as undefined,
  }), /invalid_supervisor_journal_snapshot/);
});
