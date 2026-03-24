# TODOS

<!-- Format guide: see $(cat .ninthwave/dir)/core/docs/todos-format.md -->

## Orchestrator reliability (dogfood friction, 2026-03-24)

### Fix: Detect CI failures and notify workers to rebase (H-ORC-1)

**Priority:** High
**Source:** Dogfood friction #5, #6
**Depends on:** None

The orchestrator's `checkPrStatus` (watch.ts) correctly parses failing CI and the state machine has a `ci-pending → ci-failed` transition, but items observed in production stayed in `ci-pending` for 5+ minutes with failing CI. Investigate why the transition doesn't fire reliably — likely a race between snapshot polling and check status propagation. Also: when CI fails due to merge conflicts with main (friction #6), the orchestrator should auto-send a rebase message to the worker rather than requiring manual intervention.

**Test plan:**
- Add unit test: `checkPrStatus` returns `"failing"` when GitHub checks report failure
- Add integration test: state machine transitions `ci-pending → ci-failed` on snapshot with `ciStatus: "fail"`
- Test rebase notification: when ci-failed is caused by merge conflict, worker receives rebase message
- Edge case: CI that's still pending (no conclusion yet) should remain in `ci-pending`

Acceptance: Orchestrator transitions items to `ci-failed` within one poll cycle of CI reporting failure. When CI failure is caused by merge conflicts with main, orchestrator sends a rebase message to the worker. Items no longer get stuck in `ci-pending` with failing CI.

Key files: `core/commands/watch.ts:47-100`, `core/orchestrator.ts:343-376`, `core/commands/orchestrate.ts:134-158`

---

## Vision (recurring, 2026-03-24)










### Feat: Explore vision, scope next iteration, and decompose into TODOs (L-VIS-4)

**Priority:** Low
**Source:** Self-improvement loop
**Depends on:** ORC-*, MUX-*, DF-*, WLD-*, INI-*, STU-*, WHK-*, TPL-*, ANL-*

This is a recurring meta-item. When all other TODOs are complete, this item triggers a new cycle: (1) Review the current state of ninthwave against the product vision — what's shipped, what's missing, what friction was logged. (2) Read the friction log and identify actionable improvements. (3) Identify the next most impactful capability or refinement. (4) Decompose it into TODO items following the standard format. (5) Add a new copy of this same item (L-VIS-5, etc.) depending on the new terminal items, so the cycle continues.

Acceptance: New TODO items are written to TODOS.md. A new vision exploration item is added depending on the new terminal items. The friction log is reviewed and actionable items are addressed. TODOS.md is non-empty after this item completes.

Key files: `TODOS.md`, `CLAUDE.md`, `README.md`, `vision.md`

---
