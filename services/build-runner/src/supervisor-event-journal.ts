import {
  transitionSupervisorState,
  type SupervisorEvidence,
  type SupervisorEvent,
  type SupervisorState,
} from "./supervisor-lifecycle";

export type SupervisorJournalEvent = Readonly<{
  sequence: number;
  eventId: string;
  event: SupervisorEvent;
  occurredAt: string;
  from: SupervisorState;
  to: SupervisorState;
  evidence: SupervisorEvidence;
}>;

export type SupervisorJournal = Readonly<{
  sequence: number;
  state: SupervisorState;
  events: readonly SupervisorJournalEvent[];
}>;

export type AppendSupervisorEventInput = Readonly<{
  eventId: string;
  event: SupervisorEvent;
  occurredAt: string;
  evidence?: SupervisorEvidence;
}>;

const EVENT_ID = /^[a-zA-Z0-9_-]{8,128}$/;
const JOURNAL_KEYS = ["sequence", "state", "events"];
const EVENT_KEYS = ["sequence", "eventId", "event", "occurredAt", "from", "to", "evidence"];
const EVIDENCE_KEYS = [
  "hostPreflightPassed",
  "vmIsolationVerified",
  "resourceLimitsVerified",
  "networkIsolationVerified",
  "vmStopped",
  "artifactValidated",
  "cleanupComplete",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireExactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index])) {
    throw new Error("invalid_supervisor_journal_snapshot");
  }
}

function validateTimestamp(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(Date.parse(value)).toISOString() !== value
  ) {
    throw new Error("invalid_supervisor_journal_snapshot");
  }
}

function validateEvidence(value: unknown): asserts value is SupervisorEvidence {
  if (!isRecord(value)) throw new Error("invalid_supervisor_journal_snapshot");
  if (Object.keys(value).some(key => !EVIDENCE_KEYS.includes(key as typeof EVIDENCE_KEYS[number]))) {
    throw new Error("invalid_supervisor_journal_snapshot");
  }
  if (Object.values(value).some(item => typeof item !== "boolean")) {
    throw new Error("invalid_supervisor_journal_snapshot");
  }
}

/**
 * Validate an untrusted persisted/in-memory snapshot by replaying its complete
 * event chain. This verifies internal consistency, not whether supplied
 * evidence is truthful or whether host controls actually ran.
 */
export function validateSupervisorJournal(value: unknown): asserts value is SupervisorJournal {
  try {
    if (!isRecord(value)) throw new Error();
    requireExactKeys(value, JOURNAL_KEYS);
    if (!Number.isSafeInteger(value.sequence) || (value.sequence as number) < 0) throw new Error();
    if (!Array.isArray(value.events) || value.sequence !== value.events.length) throw new Error();

    let state: SupervisorState = "queued";
    let previousTimestamp = Number.NEGATIVE_INFINITY;
    const eventIds = new Set<string>();

    for (let index = 0; index < value.events.length; index += 1) {
      if (!(index in value.events)) throw new Error();
      const entry: unknown = value.events[index];
      if (!isRecord(entry)) throw new Error();
      requireExactKeys(entry, EVENT_KEYS);

      if (entry.sequence !== index + 1) throw new Error();
      if (typeof entry.eventId !== "string" || !EVENT_ID.test(entry.eventId)) throw new Error();
      if (eventIds.has(entry.eventId)) throw new Error();
      eventIds.add(entry.eventId);

      validateTimestamp(entry.occurredAt);
      const timestamp = Date.parse(entry.occurredAt);
      if (timestamp <= previousTimestamp) throw new Error();
      previousTimestamp = timestamp;

      if (entry.from !== state) throw new Error();
      validateEvidence(entry.evidence);
      const nextState = transitionSupervisorState(
        state,
        entry.event as SupervisorEvent,
        entry.evidence,
      );
      if (entry.to !== nextState) throw new Error();
      state = nextState;
    }

    if (value.state !== state) throw new Error();
  } catch {
    throw new Error("invalid_supervisor_journal_snapshot");
  }
}

export function createSupervisorJournal(): SupervisorJournal {
  return Object.freeze({ sequence: 0, state: "queued", events: Object.freeze([]) });
}

/**
 * Pure append-only journal operation. Persistence, locking and crash recovery
 * belong to the trusted supervisor; this function provides no storage guarantee.
 */
export function appendSupervisorEvent(
  journal: SupervisorJournal,
  input: AppendSupervisorEventInput,
): SupervisorJournal {
  validateSupervisorJournal(journal);

  if (!isRecord(input)) throw new Error("invalid_supervisor_event");
  if (typeof input.eventId !== "string" || !EVENT_ID.test(input.eventId)) {
    throw new Error("invalid_supervisor_event_id");
  }
  validateTimestamp(input.occurredAt);

  const evidence: SupervisorEvidence = input.evidence ?? {};
  validateEvidence(evidence);

  const existing = journal.events.find(item => item.eventId === input.eventId);
  if (existing) {
    const same = existing.event === input.event &&
      existing.occurredAt === input.occurredAt &&
      JSON.stringify(existing.evidence) === JSON.stringify(evidence);
    if (same) return journal;
    throw new Error("supervisor_event_id_conflict");
  }

  const timestamp = Date.parse(input.occurredAt);
  const previous = journal.events[journal.events.length - 1];
  if (previous && timestamp <= Date.parse(previous.occurredAt)) {
    throw new Error("supervisor_event_timestamp_not_increasing");
  }

  const nextState = transitionSupervisorState(journal.state, input.event, evidence);
  const frozenEvidence = Object.freeze({ ...evidence });
  const entry: SupervisorJournalEvent = Object.freeze({
    sequence: journal.sequence + 1,
    eventId: input.eventId,
    event: input.event,
    occurredAt: input.occurredAt,
    from: journal.state,
    to: nextState,
    evidence: frozenEvidence,
  });

  return Object.freeze({
    sequence: entry.sequence,
    state: nextState,
    events: Object.freeze([...journal.events, entry]),
  });
}
