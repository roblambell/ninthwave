# Refactor: Orchestrator code quality fixes (M-ER-6)

**Priority:** Medium
**Source:** Engineering review R1-F7, R2 Theme B, R1-F6, R1-F2, R1-F13
**Depends on:** H-ER-10, M-ER-2
**Domain:** orchestrator

Five code quality improvements across the orchestrator and type system, applied to the post-decomposition file structure:

1. **Deduplicate PRIORITY_RANK/PRIORITY_NUM** (~8 LOC in `core/orchestrator-types.ts`): Remove `PRIORITY_RANK` from `orchestrator-types.ts` (lines ~14-19). Import `PRIORITY_NUM` from `core/types.ts` and use it in `prioritizeMergeActions()` (in `orchestrator.ts` or `orchestrator-actions.ts`). Both maps are identical: `{ critical: 0, high: 1, medium: 2, low: 3 }`.

2. **Deduplicate clean methods** (~30 LOC in `core/orchestrator-actions.ts`): Merge `executeCleanRepair`, `executeCleanReview`, and `executeCleanVerifier` into a single `cleanWorkerWorkspace(prefix, itemId, workspaceRef, mux, worktreeDir, projectRoot)` function. Each currently follows the same pattern: close workspace, then `cleanSingleWorktree`. The only difference is the workspace prefix.

3. **Priority cast type guard** (~15 LOC in `core/work-item-files.ts`): In `parseWorkItemFile()`, replace the unsafe `priority = p as Priority` cast (line ~85) with a type guard function:
```typescript
function isPriority(s: string): s is Priority {
  return s in PRIORITY_NUM;
}
```
Use the guard after validation instead of casting before validation.

4. **ProjectConfig typed fields** (~30 LOC in `core/types.ts` + `core/config.ts`): Replace the `[key: string]: string` index signature in `ProjectConfig` with explicit typed fields:
```typescript
export interface ProjectConfig {
  locExtensions: string;
  reviewExternal?: string;
  githubToken?: string;
  scheduleEnabled?: string;
}
```
This aligns with the `KNOWN_CONFIG_KEYS` set in `config.ts:9-14`. Update `loadConfig()` to use typed field assignment.

5. **Add Bootstrap to METADATA_PREFIXES** (~1 LOC in `core/work-item-files.ts`): Add `"**Bootstrap:**"` to the `METADATA_PREFIXES` array in `extractBody()`. Without this, `Bootstrap: true` lines leak into the extracted body text when round-tripping through `writeWorkItemFile` -> `extractBody`.

**Test plan:**
- Verify `prioritizeMergeActions` produces same ordering with `PRIORITY_NUM` as with `PRIORITY_RANK`
- Verify clean methods still close workspaces and remove worktrees correctly
- Test `isPriority` type guard with valid priorities and invalid strings
- Test `loadConfig` with typed fields, verify unknown keys still produce warnings
- Test `extractBody` strips `**Bootstrap:**` lines from body text
- Run `bun test test/` to confirm no regressions

Acceptance: `PRIORITY_RANK` is removed, `PRIORITY_NUM` is used everywhere. Clean methods are deduplicated. Priority parsing uses a type guard. `ProjectConfig` has typed fields. Bootstrap metadata is stripped from body text. `bun test test/` passes.

Key files: `core/orchestrator-types.ts`, `core/orchestrator-actions.ts`, `core/work-item-files.ts:85`, `core/types.ts:41`, `core/config.ts`
