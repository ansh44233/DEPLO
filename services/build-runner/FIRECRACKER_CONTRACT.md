# Firecracker VM contract (data-only foundation)

The runner now has a typed, validated description of the VM resources a future
supervisor must enforce. `createFirecrackerVmPlan()` accepts only a durable job
UUID, the existing bounded build limits, a process cap, and trusted operator
host configuration.

The plan includes CPU, memory, disk, wall-clock, process, output-file and output
byte limits. Network policy is fixed to deny; callers cannot request an allow
policy. Host paths must be absolute and distinct, and the TAP interface name is
validated. The returned plan and host configuration are frozen.

## Important limitations

This is **not** a Firecracker launcher or a security boundary. It does not
validate that host paths exist, create TAP devices, configure cgroups, mount a
filesystem, invoke Firecracker/jailer, or execute project code. It does not
claim resource enforcement or network isolation. The build endpoint must remain
fail-closed until a separately reviewed supervisor implements and tests those
controls, cancellation, artifact export, and VM teardown.
