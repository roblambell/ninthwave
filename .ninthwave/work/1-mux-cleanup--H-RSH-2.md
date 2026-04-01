# Refactor: Gut worker-health.ts to parseWorkerTelemetry only (H-RSH-2)

**Priority:** High
**Source:** Plan: Remove Send-Keys & Add Headless Adapter (eng-reviewed 2026-04-01)
**Depends on:** H-RSH-1
**Domain:** mux-cleanup

Remove all health monitoring functions from core/worker-health.ts: sendWithReadyWait, waitForInputPrompt, verifySendProcessing, checkWorkerHealth, isInputPromptVisible, isWorkerProcessing, isWorkerInError, getWorkerHealthStatus. Keep only parseWorkerTelemetry (used by orchestrate.ts:1159 for exit code extraction from screen content). If parseWorkerTelemetry is the only remaining export, consider inlining it into orchestrate.ts and deleting worker-health.ts entirely.

**Test plan:**
- Remove sendWithReadyWait tests from test/worker-health.test.ts (~lines 458-584, 7 tests)
- Remove checkWorkerHealth test (~line 313)
- Remove isInputPromptVisible tests (~lines 52-105, 11 tests)
- Remove isWorkerProcessing tests (~lines 106-168, 13 tests)
- Remove isWorkerInError tests (~lines 169-259, 17 tests)
- Verify parseWorkerTelemetry tests remain and pass
- If worker-health.ts is deleted, move parseWorkerTelemetry tests to wherever the function lands

Acceptance: No health monitoring functions remain. parseWorkerTelemetry still works and is tested. No callers reference removed functions. All tests pass.

Key files: `core/worker-health.ts`, `test/worker-health.test.ts`
