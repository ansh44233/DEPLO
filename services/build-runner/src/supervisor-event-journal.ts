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
  if (!EVENT_ID.test(input.eventId)) throw new Error("invalid_supervisor_event_id");
  const timestamp = Date.parse(input.occurredAt);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== input.occurredAt) {
    throw new Error("invalid_supervisor_event_timestamp");
  }

  const existing = journal.events.find(item => item.eventId === input.eventId);
  if (existing) {
    const same = existing.event === input.event &&
      existing.occurredAt === input.occurredAt &&
      JSON.stringify(existing.evidence) === JSON.stringify(input.evidence ?? {});
    if (same) return journal;
    throw new Error("supervisor_event_id_conflict");
  }

  const previous = journal.events[journal.events.length - 1];
  if (previous && timestamp <= Date.parse(previous.occurredAt)) {
    throw new Error("supervisor_event_timestamp_not_increasing");
  }

  const nextState = transitionSupervisorState(journal.state, input.event, input.evidence ?? {});
  const evidence = Object.freeze({ ...(input.evidence ?? {}) });
  const entry: SupervisorJournalEvent = Object.freeze({
    sequence: journal.sequence + 1,
    eventId: input.eventId,
    event: input.event,
    occurredAt: input.occurredAt,
    from: journal.state,
    to: nextState,
    evidence,
  });

  return Object.freeze({
    sequence: entry.sequence,
    state: nextState,
    events: Object.freeze([...journal.events, entry]),
  });
}
