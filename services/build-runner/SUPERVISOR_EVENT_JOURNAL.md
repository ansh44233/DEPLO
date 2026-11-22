# Supervisor event journal (data-only)

The event journal provides a deterministic, immutable append operation around
the lifecycle state machine. Each event has a stable caller-supplied ID, a
strictly increasing canonical UTC timestamp, a sequence number, and derived
from/to states.

## Guarantees in this module

- Sequence numbers are assigned from the current snapshot.
- Repeating the same event ID and identical event payload is idempotent.
- Reusing an event ID with different event data is rejected.
- Timestamps must be canonical ISO UTC strings and strictly increase.
- State transitions are validated by the lifecycle contract.
- Returned snapshots, event arrays, entries and evidence objects are frozen.

## Important limitations

This is a pure in-memory data contract. It is not durable storage, a lock,
a transactional database, or a distributed event log. Concurrent writers must
be serialized by a future trusted supervisor and persisted with a database
transaction or compare-and-swap operation. A process restart loses this
in-memory snapshot unless the caller persists and validates it.

Never accept lifecycle events or evidence from repository code, build scripts,
browsers, or public user requests. The runner remains disabled until an actual
sandbox backend enforces VM isolation, resource limits, network denial and
reliable teardown. This journal does not provide or prove any of those controls.
