# Firecracker host preflight

The authenticated runner diagnostics now inventory the Firecracker **jailer**
binary separately from the Firecracker VMM. Configure the executable path with
`DEPLO_FIRECRACKER_JAILER_BIN`; the diagnostics endpoint reports only the
boolean `jailerBinaryAvailable` field and the stable blocker code
`firecracker_jailer_unavailable`. It never returns configured paths or
environment values.

The jailer is a required part of the intended production launch boundary. A
Firecracker VMM binary by itself is not sufficient evidence that a deployment
is ready to run untrusted builds.

## What this check means

- The configured jailer path resolves to a regular file.
- The file has at least one executable permission bit.
- The check is read-only and does not invoke the binary.

## What this check does not mean

It does not verify the jailer's version, provenance, signature, ownership,
runtime compatibility, seccomp policy, chroot, cgroup configuration, or
Firecracker launch behavior. It does not create a VM, enforce resource limits,
or deny network egress. A future trusted supervisor must verify and enforce
those controls before transitioning a job to running.

The build endpoint remains fail-closed with `sandbox_not_configured`. Do not
enable it based on host preflight results alone.
