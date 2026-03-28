# Refactor: Merge strategy simplification to auto/reviewed/manual (H-TUI-3)

**Priority:** High
**Source:** TUI status improvements plan 2026-03-28
**Depends on:** H-TUI-1
**Domain:** cli-ux

Replace the 4 merge strategies (asap/approved/ask/reviewed) with 3 clearer options that form a progression. Clean cut -- no backwards compatibility aliases.

New strategies:
- `auto` (replaces asap): merge when CI passes, respect CHANGES_REQUESTED, no AI review
- `reviewed` (replaces reviewed + reviewEnabled): run AI review agent, merge when AI review + CI pass
- `manual` (replaces ask/approved): AI review runs but never auto-merge, PR stays open for human to merge

The `reviewEnabled` config field is removed -- it is now derived from the strategy (`reviewed` and `manual` imply review enabled). Also add `bypassProtection: boolean` to OrchestratorConfig and a `setMergeStrategy()` setter following the `setEffectiveWipLimit()` pattern. Add `--dangerously-bypass` CLI flag to `cmdWatch()`.

**Test plan:**
- Update all `mergeStrategy: "asap"` references to `"auto"` across test files (orchestrator.test.ts, orchestrate.test.ts, analytics.test.ts, daemon-integration.test.ts, telemetry.test.ts, merge-detection.test.ts)
- Rewrite "ask" strategy tests as "manual" strategy tests (orchestrator.test.ts, orchestrator-unit.test.ts)
- Rewrite old "approved" strategy tests -- adjust to match new strategy names
- Verify evaluateMerge() handles all 3 new strategies correctly: auto merges on CI pass, reviewed waits for AI review then merges, manual always goes to review-pending
- Test setMergeStrategy() setter changes the strategy and subsequent processTransitions uses it

Acceptance: `MergeStrategy` type is `"auto" | "reviewed" | "manual"`. `evaluateMerge()` handles all 3 cases. `reviewEnabled` is derived from strategy, not a separate config field. `DEFAULT_CONFIG.mergeStrategy` is `"auto"`. Interactive prompt and SKILL.md show 3 options. `--dangerously-bypass` flag parsed in CLI. `bun test test/` passes.

Key files: `core/orchestrator.ts:40,106-129,311-325,1114-1198`, `core/interactive.ts:46-62,175-213`, `core/commands/orchestrate.ts:1763,1998`, `skills/work/SKILL.md:115-122`
