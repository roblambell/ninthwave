# Refactor: Refactor launch.ts (M-ER-5)

**Priority:** Medium
**Source:** Engineering review R3-F8, R3 Theme B, R7-R8, R7-R10
**Depends on:** M-ER-4
**Domain:** refactor

Two structural improvements to `core/commands/launch.ts` (1,272 LOC):

1. **Extract branch management from launchSingleItem** (~150 LOC, 0 net change): The 238-line `launchSingleItem()` function has ~150 lines of branch existence/collision/PR detection/retry logic (lines ~462-612) with 9 different code paths. Extract this into a dedicated helper function:

```typescript
function ensureWorktreeAndBranch(
  item: WorkItem,
  targetRepo: string,
  worktreePath: string,
  branchName: string,
  baseBranch?: string,
  forceWorkerLaunch?: boolean,
  deps?: { branchExists, listOpenPrs, ... }
): { action: "launch" | "skip-with-pr"; existingPrNumber?: number; reuseBranch?: boolean }
```

This isolates the branching logic from prompt construction and session launch. `launchSingleItem` calls `ensureWorktreeAndBranch` first, then proceeds with the launch steps only if `action === "launch"`.

2. **Extract CLI commands to run-items.ts** (~335 LOC moved): Move `cmdRunItems()` and `cmdStart()` from `launch.ts` to a new `core/commands/run-items.ts`. These are CLI entry points, not launch logic -- they parse args, call `launchSingleItem` / `launchReviewWorker` / etc., and handle console output. After extraction, `launch.ts` drops to ~600 LOC containing only the launch functions and utilities.

Update all imports: `core/help.ts` (CLI dispatch), any test files that import from `launch.ts`.

**Test plan:**
- Verify all existing `launch.test.ts` tests pass (they test `launchSingleItem` which stays in `launch.ts`)
- Verify `ensureWorktreeAndBranch` handles all 9 branch scenarios from the original code
- Verify `cmdRunItems` and `cmdStart` work from their new location (import paths updated)
- Check no circular dependencies between `launch.ts` and `run-items.ts`
- Run `bun test test/` to confirm no regressions

Acceptance: `launchSingleItem` is simplified with branch logic in a focused helper. `cmdRunItems`/`cmdStart` are in `run-items.ts`. `launch.ts` is under 700 LOC. `bun test test/` passes.

Key files: `core/commands/launch.ts:427`, `core/commands/launch.ts:951`, `core/commands/run-items.ts` (new)
