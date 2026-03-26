# Feat: Add worker session telemetry for evidence-based failure diagnosis (M-TEL-1)

**Priority:** Medium
**Source:** Self-improvement loop
**Depends on:**
**Domain:** telemetry

## Context

Friction entry `worker-telemetry` (2026-03-25): "When H-PRX-4 worker died twice, the only evidence was screen scraping output. No exit code, no stderr, no resource usage metrics, no timing data. The root cause investigation had to rely on inference rather than evidence."

Currently the orchestrator knows worker state transitions (implementing, ci-pending, merged, stuck) but has no telemetry about the worker process itself. When a worker fails, there's no evidence trail for diagnosis.

## Requirements

1. Capture per-worker telemetry in the orchestrator state:
   - `startedAt` / `endedAt` timestamps (wall-clock duration)
   - `exitCode` from the worker process (when available from multiplexer)
   - `stderrTail` — last 20 lines of stderr (captured on failure)
   - `prNumber` and `prUrl` (already partially tracked, ensure consistent)
2. Surface telemetry in `ninthwave status` output — show duration for active workers, exit code and stderr for failed workers
3. Include telemetry in analytics JSON — per-item timing and outcome data
4. Capture telemetry by reading multiplexer screen content on state transitions (reuse `readScreen` infrastructure from H-HLT-1)
5. Do NOT add external dependencies or shell out to `ps` — use only existing multiplexer and git-based signals

Acceptance: Failed workers show exit code and stderr tail in `ninthwave status` output. Active workers show elapsed duration. Analytics JSON includes per-item `startedAt`, `endedAt`, and `exitCode` fields. Tests verify telemetry capture on worker completion and failure paths.

**Test plan:** Write unit tests for telemetry capture on state transitions (implementing → merged, implementing → stuck). Write a test verifying `ninthwave status` formats telemetry data correctly. Verify analytics JSON schema includes the new fields. Edge case: worker that never starts (no screen content) should show null telemetry, not crash.

Key files: `core/orchestrator.ts`, `core/commands/status.ts`, `core/commands/analytics.ts`, `core/types.ts`
