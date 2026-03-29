# Refactor: Decompose orchestrator.ts (H-ER-10)

**Priority:** High
**Source:** Engineering review R2 Theme B, R7-R2
**Depends on:** H-ER-8
**Domain:** refactor

Extract two subsystems from `core/orchestrator.ts` (2,674 LOC) into separate files, reducing the main file to ~1,350 LOC.

1. **Types and constants (~375 LOC) -> `core/orchestrator-types.ts`**: Extract all type definitions, interfaces, constants, and configuration defaults:
   - `OrchestratorItemState` type union
   - `OrchestratorItem` interface
   - `OrchestratorConfig` interface and `DEFAULT_CONFIG`
   - `ItemSnapshot`, `PollSnapshot` interfaces
   - `Action`, `ActionType`, `ActionResult` types
   - `OrchestratorDeps` interface
   - `WIP_STATES`, `STACKABLE_STATES` sets
   - `PRIORITY_RANK` (or `PRIORITY_NUM` import after dedup)
   - `NOT_ALIVE_THRESHOLD`, `HEARTBEAT_TIMEOUT_MS` constants
   - `calculateMemoryWipLimit()` function

2. **Action execution methods (~950 LOC) -> `core/orchestrator-actions.ts`**: Extract all `execute*` methods from the Orchestrator class into standalone functions that take `(item, deps, config)` parameters:
   - `executeLaunch`, `executeMerge`, `executeClean`
   - `executeLaunchRepair`, `executeLaunchReview`, `executeLaunchVerifier`
   - `executeCleanRepair`, `executeCleanReview`, `executeCleanVerifier`
   - `executeSendMessage`, `executePostReview`, `executeSetCommitStatus`
   - `executeSyncStackComments`, `executeRebase`

   The `executeAction()` dispatcher stays in `orchestrator.ts` and calls the extracted functions.

After extraction, `orchestrator.ts` retains: the `Orchestrator` class with `processTransitions()`, `transitionItem()`, all `handle*` methods, `evaluateMerge()`, `transition()`, `launchReadyItems()`, and the action dispatcher.

**Test plan:**
- Verify all existing tests in `test/orchestrator.test.ts` and `test/orchestrator-unit.test.ts` pass (imports may change)
- Verify `test/daemon-integration.test.ts` and `test/scenario/*.test.ts` pass
- Check that `orchestrator-types.ts` has no imports from `orchestrator.ts` (types should be self-contained)
- Check that `orchestrator-actions.ts` only imports types from `orchestrator-types.ts`, not from `orchestrator.ts`
- Run `bun test test/` to confirm no regressions

Acceptance: `orchestrator.ts` is under 1,500 LOC. Types are in `orchestrator-types.ts`. Execute methods are in `orchestrator-actions.ts`. No circular dependencies. `bun test test/` passes.

Key files: `core/orchestrator.ts`, `core/orchestrator-types.ts` (new), `core/orchestrator-actions.ts` (new)
