# Refactor: Remove screen-based ongoing health monitoring (H-SR-2)

**Priority:** High
**Source:** Scope reduction -- screen health polling causes false positives and adds complexity
**Depends on:** None
**Domain:** scope-reduction

Remove the ongoing poll-based screen health monitoring from the orchestrator. This includes computeScreenHealth(), handleScreenHealthNudge(), and related stall detection infrastructure. Keep delivery verification (sendWithReadyWait, waitForInputPrompt, verifySendProcessing) which is used during initial message delivery to workers. Keep commit freshness timeouts (30min launch, 60min activity) as the primary health signal.

The screen health system classifies workers into stalled-empty/stalled-permission/stalled-error/stalled-unchanged states every ~10 seconds and sends nudge messages. This produces false positives (e.g., "Composing" state detected as idle, permission keywords in code files) and the nudges are advisory-only. Commit freshness timeouts are more reliable as a backstop.

**Test plan:**
- Run `bun test test/` -- all tests pass after removal
- Grep for "computeScreenHealth", "ScreenHealthStatus", "handleScreenHealthNudge", "stallDetectedAt", "isPermissionPrompt", "PERMISSION_INDICATORS" -- no orphaned references
- Verify that worker-health.ts still exports delivery verification functions: sendWithReadyWait, waitForInputPrompt, verifySendProcessing, getWorkerHealthStatus, checkWorkerHealth, isInputPromptVisible, isWorkerProcessing, isWorkerInError
- Verify commit freshness timeouts still work: launchTimeoutMs and activityTimeoutMs in orchestrator config

Acceptance: Screen-based ongoing monitoring removed. Delivery verification intact. Commit freshness timeouts intact. Tests pass. No dead imports.

Key files:
- `core/worker-health.ts` -- remove: ScreenHealthStatus type (lines 21-27), PERMISSION_INDICATORS array (lines 92-97), isPermissionPrompt function (lines 140-149), simpleHash function (lines 155-162), computeScreenHealth function (lines 185-235). Keep: WorkerHealthStatus, PROMPT_INDICATORS, PROCESSING_INDICATORS, ERROR_INDICATORS, all delivery verification functions
- `core/orchestrator.ts` -- remove: ScreenHealthStatus import (line 8) and re-export (line 128), screenHealth from ItemSnapshot (line 149), stallDetectedAt/lastScreenHash/unchangedCount/permissionCount from OrchestratorItem (lines ~77-83), entire handleScreenHealthNudge method (lines 671-713), the call to handleScreenHealthNudge in implementing state handler. Keep: commit freshness timeouts (lines 642-657), send-message action type (used by rebase notifications)
- `core/commands/orchestrate.ts` -- remove: computeScreenHealth from import (line 29), computeScreenHealth call in buildSnapshot (line 281), screenHealth from health-sample JSONL logging (line 292). Keep: getWorkerHealthStatus call (line 280), readScreen for cost parsing (lines 950-955)
- `test/worker-health.test.ts` -- remove: computeScreenHealth test block (lines 621-800+), isPermissionPrompt tests if any. Keep: all delivery verification tests
- `test/orchestrator.test.ts` -- remove: "screen health stall detection" describe block (lines 5752-5835+)
- `test/orchestrator-unit.test.ts` -- remove: "screen health nudge" describe block (lines 782-821), screenHealth from snapshot helpers
