# Refactor: Strip dead exports and MODEL_PRICING from types.ts (H-ER-1)

**Priority:** High
**Source:** Engineering review R1-F3, R1-F4, R1-F5, R1-F8
**Depends on:** None
**Domain:** types

Remove four unused exports from `core/types.ts`:

1. `WorkerCostData` interface (lines ~103-110) -- defined but never imported outside its definition file. Actual cost tracking uses `WorkerProgress` and `HeartbeatCostFields` in `daemon.ts`.
2. `CODE_EXTENSIONS_FOR_LINE` constant (lines ~176-177) -- exported but never imported anywhere. Remnant from an earlier version of `extractFilePaths()`.
3. `PRStatus` interface (lines ~52-58) -- defined but never imported. The orchestrator uses `ItemSnapshot` for PR state.
4. `MODEL_PRICING` table (lines ~124-132) and `estimateCost()` function (lines ~138-156) -- only used by `analytics.test.ts`. Pricing will go stale as model versions change. Analytics can display raw token counts without dollar estimates.

Update `test/analytics.test.ts` to remove any assertions that depend on `estimateCost` or `MODEL_PRICING`. If tests import these, remove those imports and adjust test cases to verify token counts rather than dollar amounts.

**Test plan:**
- Verify `bun test test/` passes after removals
- Grep entire codebase for `WorkerCostData`, `CODE_EXTENSIONS_FOR_LINE`, `PRStatus`, `MODEL_PRICING`, `estimateCost` to confirm zero remaining references
- Check that `analytics.test.ts` still passes with updated assertions

Acceptance: All four exports are removed from `core/types.ts`. No references remain in any production or test file. `bun test test/` passes.

Key files: `core/types.ts`, `test/analytics.test.ts`
