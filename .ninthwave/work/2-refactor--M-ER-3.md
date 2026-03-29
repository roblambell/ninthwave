# Refactor: Simplify pr-monitor.ts (M-ER-3)

**Priority:** Medium
**Source:** Engineering review R4-F10, R7-R6, R7-R7
**Depends on:** H-ER-6
**Domain:** refactor

Two simplifications to `core/commands/pr-monitor.ts`:

1. **Extract shared CI status logic** (~60 LOC savings): `checkPrStatus()` (lines ~157-229) and `checkPrStatusAsync()` (lines ~237-305) are nearly identical -- 72 and 68 LOC respectively with identical logic differing only in sync vs async gh calls. Extract the shared CI status processing into a `processChecks()` function:

```typescript
function processChecks(
  checks: { state: string; name: string; completedAt?: string }[],
): { ciStatus: string; eventTime: string | undefined }
```

Both sync and async functions call their respective `prList`/`prView`/`prChecks` variants, then pass results to the shared `processChecks`. This eliminates duplicated logic and ensures bug fixes apply to both paths.

2. **Merge cmdWatchReady and getWatchReadyState** (~37 LOC savings): `cmdWatchReady()` (lines ~102-139) and `getWatchReadyState()` (lines ~393-424) have identical logic -- one prints to console, the other returns a string. Merge into a single function with an optional `print: boolean` parameter (default `true`):

```typescript
export function cmdWatchReady(
  worktreeDir: string,
  repoRoot: string,
  print?: boolean,
): string
```

When `print` is true (CLI usage), write to console. Always return the result string. Callers that used `getWatchReadyState` now call `cmdWatchReady(dir, root, false)`.

**Test plan:**
- Add test for `processChecks`: verify CI status determination with various check combinations (all pass, some fail, all pending, mixed, skipped-only)
- Verify `checkPrStatus` and `checkPrStatusAsync` produce identical results for the same input
- Verify `cmdWatchReady` returns the same string that `getWatchReadyState` used to return
- Verify existing watch.test.ts tests pass
- Run `bun test test/` to confirm no regressions

Acceptance: `processChecks` is a single shared function used by both sync and async paths. `getWatchReadyState` is removed, its callers use `cmdWatchReady` with `print: false`. Net ~97 LOC reduction. `bun test test/` passes.

Key files: `core/commands/pr-monitor.ts:157`, `core/commands/pr-monitor.ts:237`, `core/commands/pr-monitor.ts:102`, `core/commands/pr-monitor.ts:393`
