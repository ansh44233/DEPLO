# Workspace isolation foundation

This module provides private filesystem lifecycle primitives and a process-local concurrency admission cap only. It does not create a container, VM, namespace, cgroup, seccomp profile, disk quota, or network boundary, and it must not be treated as a security sandbox.

## Workspace layout, admission control, and leases

Each build receives a unique directory below a configured absolute, canonical workspace root: `source/`, `work/`, and `output/`. The root and children use owner-only permissions (`0700`). Symlink roots are rejected. Cleanup is constrained to generated `job-` directories below the canonical root.

The manager defaults to at most four active workspaces per Node.js process; callers may configure 1–128. This is not a distributed quota: multiple runner processes each have their own counter. Production admission control must also use a shared queue/lease or scheduler limit.

Each managed workspace contains a private `.deplo-workspace-lease.json` marker. The workspace exposes an explicit `heartbeat()` operation that atomically refreshes the marker. Long-running build orchestration must heartbeat regularly (for example, every minute) and treat heartbeat failure as a workspace-lifecycle failure. The janitor preserves a workspace while its last valid heartbeat is within the configured retention window; expired leases become eligible for cleanup. Invalid or symlinked lease markers fail closed and are skipped. Heartbeats, manager cleanup, and janitor cleanup coordinate through an atomic per-workspace operation-lock directory, preventing the janitor from deleting a workspace while a heartbeat or managed cleanup is in progress, including across processes sharing the same filesystem. If a process crashes while holding the lock, the stale lock is deliberately not auto-reclaimed; the janitor skips that workspace for operator inspection. Legacy workspaces without a lease continue to use directory modification time.

The lease is a liveness hint, not a substitute for a durable job registry. The operation lock coordinates filesystem operations on a shared local filesystem; it is not a distributed lock for multiple hosts or network filesystems with weaker atomic-mkdir semantics. Keep the retention window comfortably above the enforced maximum build duration. A process crash leaves a lease that eventually expires. The current runner still does not execute builds.

## Resource policy contract

Defaults describe a future sandbox: 10-minute wall-clock limit, 2 GiB memory, 2 CPU cores, 4 GiB disk, 128 processes, 5,000 output files, 100 MiB output, 2 MiB logs, and network denied. These values are policy metadata until an execution backend enforces them with operating-system controls. Application timeouts alone are not resource limits.

## Required before enabling builds

Use disposable microVMs or comparably strong isolation; enforce CPU, memory, disk, process and wall-clock limits; deny network egress by default; avoid privileged containers and host Docker sockets; isolate source and output mounts; bound logs; support cancellation; validate exported artifacts; and destroy the execution environment after every outcome. Keep build intake fail-closed until those controls and adversarial tests exist.
