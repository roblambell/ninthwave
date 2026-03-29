# Refactor: Remove cmdAutopilotWatch (H-ER-2)

**Priority:** High
**Source:** Engineering review R4 Theme A, R7-S7
**Depends on:** None
**Domain:** cli

Remove the `cmdAutopilotWatch` function from `core/commands/pr-monitor.ts` (lines ~311-390). This is an 80 LOC legacy polling command that was replaced by the daemon's `orchestrateLoop`. The daemon provides the same PR status monitoring with richer state management.

Also remove the CLI dispatch entry for the `autopilot-watch` command from `core/help.ts` (or wherever CLI commands are registered). Remove any test code that tests `cmdAutopilotWatch` directly.

Do NOT remove `checkPrStatus`, `checkPrStatusAsync`, `cmdPrWatch`, `cmdPrActivity`, `scanExternalPRs`, `cmdWatchReady`, or `getWatchReadyState` -- those are actively used.

**Test plan:**
- Grep for `autopilotWatch` and `autopilot-watch` across the codebase to find all references
- Verify no production code imports or calls `cmdAutopilotWatch`
- Run `bun test test/` to confirm no test depends on it

Acceptance: `cmdAutopilotWatch` function and its CLI dispatch entry are removed. No references remain. `bun test test/` passes.

Key files: `core/commands/pr-monitor.ts`, `core/help.ts`
