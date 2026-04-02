# Test: Add runtime control and recovery system coverage (H-TEST-5)

**Priority:** High
**Source:** Spec `.opencode/plans/1775087486017-cosmic-garden.md`
**Depends on:** H-TEST-3
**Domain:** watch-recovery-tests
**Lineage:** 6cabdd2f-3bf3-4db4-a591-a700e5d5f3fc

Add the CLI/system coverage for the watch paths that are easiest to regress: mid-run control changes, shutdown, hangs, retries, disconnects, and restart from persisted state. Keep these tests on the real CLI and headless backend so they validate the actual orchestration loop, state persistence, and recovery behavior rather than only unit-level control handlers.

**Test plan:**
- Add system tests for WIP limit, merge strategy, review mode, and timeout-extension changes taking effect during a live run
- Cover shutdown, interrupted-run recovery, and restart from persisted daemon state, asserting the expected state files and output markers
- Cover hung or missing-heartbeat workers plus retry behavior, verifying the orchestrator reacts deterministically and does not duplicate work after recovery

Acceptance: The system suite proves the real watch path handles runtime controls, shutdown, hangs, retries, and restart/recovery without corrupting state or losing the operator-visible recovery behavior.

Key files: `test/system/watch-runtime-controls.test.ts`, `test/system/watch-recovery.test.ts`, `test/system/helpers/cli-harness.ts`, `core/commands/orchestrate.ts`, `core/reconstruct.ts`
