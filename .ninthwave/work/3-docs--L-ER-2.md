# Docs: Analytics dedup and ARCHITECTURE.md update (L-ER-2)

**Priority:** Low
**Source:** Engineering review R2-F1, R5 Theme A, R7-R11, R7-B18
**Depends on:** H-ER-7
**Domain:** docs

Two improvements -- one code cleanup and one documentation update:

1. **Deduplicate analytics commit functions** (~30 LOC savings in `core/analytics.ts`): `commitAnalyticsFiles()` and `commitFrictionFiles()` (lines ~385-448) are nearly identical -- both stage files in a subdirectory of `.ninthwave/` and commit with a message. Merge them into a single function:

```typescript
function commitPathFiles(
  projectRoot: string,
  relPath: string,
  commitMessage: string,
  runner?: ShellRunner,
): boolean
```

Update callers to use `commitPathFiles(root, "analytics", "chore: update analytics")` and `commitPathFiles(root, "friction", "chore: update friction log")`.

2. **Update ARCHITECTURE.md** (~30 LOC): Update the state machine documentation to reflect the current 18 states (after pr-open collapse in H-ER-7). Specifically:
   - List all 18 states in the state table
   - Correct the `WIP_STATES` listing to match the actual set (including `reviewing` after H-ER-8)
   - Correct the `STACKABLE_STATES` listing to match `{ ci-passed, review-pending, merging }`
   - Remove any references to `pr-open` as a distinct state
   - Note that `reviewing` is now part of the unified WIP pool

**Test plan:**
- Verify `commitPathFiles` works for both analytics and friction paths
- Verify existing analytics.test.ts tests pass with the refactored function
- Manual review of ARCHITECTURE.md for accuracy against the code
- Run `bun test test/` to confirm no regressions

Acceptance: `commitAnalyticsFiles` and `commitFrictionFiles` are replaced by `commitPathFiles`. ARCHITECTURE.md documents all 18 states with correct WIP and stackable state sets. `bun test test/` passes.

Key files: `core/analytics.ts:385`, `ARCHITECTURE.md`
