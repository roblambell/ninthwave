# Test: Add CLI happy-path watch lifecycle system coverage (H-TEST-3)

**Priority:** High
**Source:** Spec `.opencode/plans/1775087486017-cosmic-garden.md`
**Depends on:** H-TEST-2
**Domain:** watch-system-tests
**Lineage:** 5a7fd9c7-7ffa-419c-837a-a490b61de4c5

Add the first full end-to-end system tests for the real CLI, orchestrator, and headless backend using the fake worker harness. Cover watch startup, worker launch, queued-to-implementing-to-success transitions, and the resulting log, state, and workspace artifacts. This item should establish the canonical happy-path system coverage that later failure and recovery items build on.

**Test plan:**
- Add `test/system/watch-cli.test.ts` coverage for real `bun run core/cli.ts` watch startup with deterministic fake workers and `NINTHWAVE_MUX=headless`
- Verify startup modes including selected items and future-only startup, plus the successful worker lifecycle from launch through completion
- Assert daemon state, headless logs, pid/workspace lifecycle, and any expected status output or transport messages produced by the run

Acceptance: The repo has stable CLI-level system tests that exercise the real watch path on the headless backend from startup through successful completion and verify the resulting runtime artifacts.

Key files: `test/system/watch-cli.test.ts`, `test/system/helpers/cli-harness.ts`, `core/cli.ts`, `core/commands/orchestrate.ts`, `core/headless.ts`
