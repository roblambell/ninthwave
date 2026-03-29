# Feat: Unified WIP pool with review priority (H-ER-8)

**Priority:** High
**Source:** Engineering review R2-F3, R7-D12
**Depends on:** H-ER-7
**Domain:** orchestrator

Merge the separate review WIP limit into the unified WIP pool. Currently, `reviewing` is excluded from `WIP_STATES` and tracked separately via `reviewWipLimit` (default 2) and `reviewWipCount`/`reviewWipSlots` getters. This means the system can run `wipLimit + reviewWipLimit` concurrent sessions (e.g., 4 + 2 = 6), potentially causing OOM on memory-constrained machines since `calculateMemoryWipLimit` only adjusts `wipLimit`.

Changes to `core/orchestrator.ts`:

1. **Add `reviewing` to `WIP_STATES`** (lines ~437-441). This makes review workers count toward the unified WIP limit.

2. **Remove `reviewWipLimit` from `OrchestratorConfig`** and its default value. Remove the `reviewWipCount` and `reviewWipSlots` getters (lines ~600-609).

3. **Update `evaluateMerge()`** (lines ~1460-1580): Remove the `reviewWipSlots` check. Instead, check the unified `wipSlots`. When no WIP slots are available, stay in `ci-passed` (same as current behavior when review slots are full).

4. **Add review priority to `launchReadyItems()`** (lines ~2636-2670): When filling WIP slots, prioritize launching review workers for items already in the CI pipeline over launching new work items. Concretely: process the review launch queue (from `evaluateMerge`) before processing the `ready` queue (new items). This ensures that items already flowing through the pipeline (which need review to advance to merge) take priority over starting new work.

5. **Update `calculateMemoryWipLimit()`** (lines ~419-473): Since reviews now share the WIP pool, no changes needed here -- the existing memory calculation already applies to all WIP items.

6. **Remove any `--review-wip-limit` CLI flag** from arg parsing if it exists.

**Test plan:**
- Add test: `reviewing` state is now counted in `wipCount`
- Add test: when WIP is full with implementation workers, review cannot launch (respects unified limit)
- Add test: when one WIP slot is available and both a ready item and a review are pending, the review launches first
- Add test: `calculateMemoryWipLimit` result applies to all concurrent sessions including reviews
- Verify existing review workflow tests pass with updated WIP accounting
- Run `bun test test/` to confirm no regressions

Acceptance: `reviewing` is in `WIP_STATES`. `reviewWipLimit` and related config/getters are removed. Reviews for in-pipeline items are prioritized over new launches. Total concurrent sessions never exceed `wipLimit`. `bun test test/` passes.

Key files: `core/orchestrator.ts:437`, `core/orchestrator.ts:595`, `core/orchestrator.ts:1460`, `core/orchestrator.ts:2636`
