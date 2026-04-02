# Test: Cover review and secondary-worker system flows (H-TEST-4)

**Priority:** High
**Source:** Spec `.opencode/plans/1775087486017-cosmic-garden.md`
**Depends on:** H-TEST-3
**Domain:** secondary-worker-tests
**Lineage:** 06943af8-0c46-43a0-a64c-8122fe8e82ef

Extend the CLI/system suite to cover the orchestrator paths that launch workers after the initial implementer pass. Focus on reviewer verdict handling, CI-failure-to-rebaser behavior, and any shipped fix-forward or forward-fixer flow that is part of the current production orchestrator. Use the same fake worker harness so these flows are exercised through the real launch and state machinery, not bespoke stubs.

**Test plan:**
- Add system coverage for reviewer success and failure paths, including deterministic verdict-file creation and consumption
- Add system coverage for CI failure leading to rebaser launch and verify the expected follow-up state transitions and runtime artifacts
- If fix-forward or forward-fixer is active in production, cover one representative happy path and one failure path; otherwise assert the currently supported boundary explicitly in tests

Acceptance: Review, rebase, and any shipped fix-forward secondary-worker flows are covered end to end through the real orchestrator path, with deterministic verdicts, launches, and state transitions verified in tests.

Key files: `test/system/watch-secondary-workers.test.ts`, `test/system/helpers/cli-harness.ts`, `core/commands/orchestrate.ts`, `core/commands/launch.ts`, `core/daemon.ts`
