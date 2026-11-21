# Workspace isolation foundation

This module provides **filesystem lifecycle primitives only**. It does not create a container, VM, namespace, cgroup, seccomp profile, or network boundary, and it must not be treated as a security sandbox.

## Workspace layout

Each build receives a unique directory below a configured absolute, canonical workspace root:

- `source/`: reserved for a validated source tree.
- `work/`: reserved for package-manager and build working files.
- `output/`: reserved for the exported artifact.

The root and each directory are created with owner-only permissions (`0700`). The manager refuses a workspace root that is a symlink or resolves through a symlink. Cleanup is idempotent and removes only a directory created by this manager with the expected `job-` prefix beneath the canonical root.

The workspace root must be on a dedicated filesystem or quota-controlled volume in production. It must not contain runner secrets, source archive storage, application credentials, or host paths that could be exposed to a build process.

## Resource policy contract

The exported default policy records conservative ceilings for a future sandbox: 10-minute wall-clock limit, 2 GiB memory, 2 CPU cores, 4 GiB disk, 128 processes, 5,000 output files, 100 MiB output, 2 MiB logs, and network denied.

These values are policy metadata only until an execution backend enforces them with operating-system controls. A timeout in application code alone is not a resource limit. Do not launch repository scripts from this service.

## Required before enabling builds

A future execution backend must provide disposable microVMs or comparably strong isolation; enforce CPU, memory, disk, process and wall-clock limits; deny network egress by default; avoid privileged containers and host Docker sockets; isolate source and output mounts; bound logs; support cancellation; validate exported artifacts; and destroy the execution environment after every outcome. Build intake must remain fail-closed until those controls and adversarial tests exist.
