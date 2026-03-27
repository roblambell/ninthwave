# Fix: Roll back stacked dependents when base goes stuck (H-ORC-2)

**Priority:** High
**Source:** Friction log: stacked-item-launched-on-stuck-base.md (2026-03-27)
**Depends on:** None
**Domain:** orchestrator

When a base item goes stuck, stacked dependents that were promoted to ready/launching/bootstrapping are left running on a stale branch. The current handler only sends a pause message to dependents that already have a workspaceRef, but dependents in ready or launching state (no worker yet) proceed to launch anyway.

In the stuck transition handler (around line 562), expand the logic: for stacked dependents in pre-WIP states (ready, bootstrapping, launching) that have not yet started implementing, transition them back to `queued` and clear their `baseBranch`. For dependents already in WIP states (implementing, pr-open, ci-pending, etc.), keep the existing pause message behavior. This prevents wasted worker sessions on branches that cannot merge.

**Test plan:**
- Unit test: stacked dependent in `ready` state reverts to `queued` when base goes stuck, baseBranch cleared
- Unit test: stacked dependent in `launching` state reverts to `queued` when base goes stuck
- Unit test: stacked dependent in `implementing` state gets pause message (existing behavior preserved)
- Unit test: non-stacked dependents (no baseBranch) are not affected
- Verify existing stacking and stuck-handling tests still pass

Acceptance: When a base item transitions to stuck, stacked dependents in ready/launching/bootstrapping revert to queued with baseBranch cleared. Dependents already implementing receive a pause message. No worker sessions are launched for items whose base is stuck. Tests pass.

Key files: `core/orchestrator.ts:562-573`, `test/orchestrator-unit.test.ts`
