# Firecracker VM contract (data-only foundation)

The runner has a typed, validated description of the VM resources a future
supervisor must enforce. `createFirecrackerVmPlan()` accepts only a durable
job UUID, the existing bounded build limits, a process cap, and trusted
operator host configuration.

The plan includes CPU quota in millicores **as well as** the VM's vCPU count,
memory, disk, wall-clock, process, output-file and output-byte limits. Keeping
the CPU quota explicit prevents a future supervisor from treating a rounded-up
vCPU count as the actual CPU allowance. Network policy is fixed to deny;
callers cannot request an allow policy.

Host paths must be absolute, canonical, non-root, and distinct. Traversal
segments, duplicate separators, and trailing separators are rejected. The
returned plan and host configuration are frozen.

## Important limitations

This is **not** a Firecracker launcher or a security boundary. It does not
validate that host paths exist, create TAP devices, configure cgroups, mount a
filesystem, invoke Firecracker/jailer, or execute project code. It does not
claim resource enforcement or network isolation. The build endpoint must remain
fail-closed until a separately reviewed supervisor implements and tests those
controls, cancellation, artifact export, and VM teardown.
