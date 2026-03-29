# Refactor: Collapse pr-open into ci-pending (H-ER-7)

**Priority:** High
**Source:** Engineering review R2 Theme B, R7-D1
**Depends on:** H-ER-4
**Domain:** orchestrator

Remove the `pr-open` state from the state machine, reducing from 19 to 18 states. `pr-open` is a transient state that exists for at most one poll cycle -- when a PR is detected in `handleImplementing()`, the code transitions to `pr-open` then immediately calls `handlePrLifecycle()`, which resolves the CI status and transitions to `ci-pending`/`ci-passed`/`ci-failed` in the same call.

Changes needed in `core/orchestrator.ts`:
1. Remove `"pr-open"` from the `OrchestratorItemState` type union (lines ~23-42)
2. Remove `"pr-open"` from `WIP_STATES` if present (lines ~437-441)
3. In `handleImplementing()` (where PR is detected, lines ~847-857), transition directly to `ci-pending` instead of `pr-open`
4. Remove any `case "pr-open"` handler in `transitionItem()` -- the `handlePrLifecycle` call path should handle `ci-pending` directly
5. Update any references to `"pr-open"` in comment relay states or status display

Changes needed in `core/status-render.ts`:
1. Remove `"pr-open"` from status display mappings and color configurations

Changes needed in tests:
1. Update any test assertions that check for `"pr-open"` state -- these should check for `"ci-pending"` instead
2. Update golden files if they contain `pr-open` state text

**Test plan:**
- Verify no code path produces `"pr-open"` state after changes
- Grep for `pr-open` across the codebase to find all references
- Update affected test assertions from `"pr-open"` to `"ci-pending"`
- Verify existing orchestrator.test.ts exhaustive transition tests pass
- Verify golden file tests pass (update .expected files if needed)
- Run `bun test test/` to confirm no regressions

Acceptance: `pr-open` is removed from the state union. PR detection transitions directly to `ci-pending`. All tests pass. No references to `pr-open` remain in production code.

Key files: `core/orchestrator.ts:23`, `core/orchestrator.ts:437`, `core/orchestrator.ts:847`, `core/status-render.ts`
