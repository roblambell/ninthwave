# Refactor: Simplify launch flow and remove orchestrator sendMessage dep (H-RSH-3)

**Priority:** High
**Source:** Plan: Remove Send-Keys & Add Headless Adapter (eng-reviewed 2026-04-01)
**Depends on:** H-RSH-1
**Domain:** mux-cleanup

Simplify launchAiSession in core/commands/launch.ts: remove the sendWithReadyWait call (~line 128), the waitForReady fallback (~line 136), the legacy mux.sendMessage fallback (~lines 130-146), and the initialPrompt variable (always "" for registered tools). Replace the unknown tool else-branch with a throw: "Unknown AI tool: ... Supported: ...". Remove sendMessage from OrchestratorDeps in core/orchestrator-types.ts and its wiring in core/commands/orchestrate.ts (~line 2432). Update test/scenario/helpers.ts to remove sendMessage from mock.

**Test plan:**
- Remove "custom/unknown tool falls back to raw command launch" test from test/launch.test.ts (~line 1286)
- Add new test: launchAiSession throws for unregistered tool ID
- Remove any tests asserting sendMessage or sendWithReadyWait behavior in launch context
- Verify known tool launch tests (claude, copilot, opencode) still pass unchanged
- Verify scenario test helpers compile without sendMessage mock

Acceptance: launchAiSession has no sendMessage, waitForReady, or sendWithReadyWait usage. Unknown tools throw an error. sendMessage is gone from OrchestratorDeps. All tests pass.

Key files: `core/commands/launch.ts`, `core/orchestrator-types.ts`, `core/commands/orchestrate.ts`, `test/launch.test.ts`, `test/scenario/helpers.ts`
