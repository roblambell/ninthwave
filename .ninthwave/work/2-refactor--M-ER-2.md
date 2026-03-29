# Refactor: Merge work-item-utils.ts into work-item-files.ts (M-ER-2)

**Priority:** Medium
**Source:** Engineering review R1 Theme B, R7-R4
**Depends on:** None
**Domain:** refactor

Merge `core/work-item-utils.ts` (291 LOC) into `core/work-item-files.ts` (346 LOC). The current three-file arrangement (`parser.ts` + `work-item-files.ts` + `work-item-utils.ts`) adds cognitive overhead -- developers wonder "where does parsing logic go?" The split was introduced to break a bidirectional dependency, but the dependency can be resolved within a single file.

Steps:
1. Move all exports from `work-item-utils.ts` into `work-item-files.ts`: `splitIds`, `normalizeDomain`, `extractTestPlan`, `extractFilePaths`, `expandWildcardDeps`, `extractBody`, `prTitleMatchesWorkItem`, `normalizeTitleForComparison`, `METADATA_PREFIXES`
2. Update `core/parser.ts` to import from `work-item-files.ts` instead of re-exporting from `work-item-utils.ts`
3. Update all other files that import from `work-item-utils.ts` to import from `work-item-files.ts`
4. Delete `core/work-item-utils.ts`
5. Keep `core/parser.ts` as the thin adapter that adds origin/main filtering

Estimated savings: ~40 LOC of eliminated imports, re-exports, and the bidirectional dependency comment.

**Test plan:**
- Grep for all imports of `work-item-utils` across the codebase, update each to `work-item-files`
- Verify `parser.test.ts`, `work-item-files.test.ts`, and `merge-detection.test.ts` pass
- Verify no remaining references to `work-item-utils` in production or test code
- Run `bun test test/` to confirm no regressions

Acceptance: `work-item-utils.ts` is deleted. All its exports are available from `work-item-files.ts`. `parser.ts` still works as the thin adapter. `bun test test/` passes.

Key files: `core/work-item-utils.ts`, `core/work-item-files.ts`, `core/parser.ts`
