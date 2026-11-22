# Supervisor lifecycle contract (data-only)

This contract defines the required state progression for a future isolated build
supervisor. It is deliberately pure TypeScript: it does not launch Firecracker,
create TAP devices, configure cgroups, mount disks, run project code, or prove
that any security control is active.

## Lifecycle

- `queued -> preparing`: reserve the job for setup.
- `preparing -> starting`: allowed only after host preflight passes.
- `starting -> running`: allowed only when the supervisor reports VM isolation,
  resource-limit enforcement, and network isolation verified.
- `preparing|starting|running -> stopping`: begin teardown.
- `stopping -> succeeded`: allowed only after VM stop, artifact validation,
  and workspace/resource cleanup are all confirmed.
- `preparing|starting|running|stopping -> failed`: allowed only after VM stop
  and cleanup are confirmed.
- `queued -> cancelled`: cancellation before any VM setup.
- `stopping -> cancelled`: allowed only after VM stop and cleanup.

Terminal states cannot transition again. Invalid transitions fail closed.

## Runtime input validation

The transition function validates state and event values at runtime and rejects
unknown evidence keys, non-boolean evidence values, arrays, null, and non-plain
objects. This prevents accidental bypasses through untyped callers. It does not
authenticate the caller or establish that evidence is truthful.

## Trust boundary

Evidence values are assertions supplied by a future trusted supervisor. The
state machine validates their presence but cannot independently verify them.
Never expose this reducer as a public endpoint or accept evidence from a
repository, build script, browser, or user-controlled request. The actual
supervisor must independently enforce and attest each control, persist state
changes transactionally, handle crashes/retries, and ensure teardown on every
exit path.

The runner build endpoint remains disabled. This contract is not a sandbox and
must not be used to enable builds.
