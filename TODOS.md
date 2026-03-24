# TODOS

<!-- Format guide: see $(cat .ninthwave/dir)/core/docs/todos-format.md -->

## Orchestrator Lifecycle (friction log, 2026-03-24)

### Fix: Orchestrator should mark items done in TODOS.md and commit (H-OL-1)

**Priority:** High
**Source:** Friction log #13
**Depends on:** None

After the orchestrator merges a PR and cleans up the worktree, it should call `mark-done` for that item and commit+push the TODOS.md change. Currently the orchestrator's lifecycle ends at worktree cleanup, leaving TODOS.md out of sync with reality. The mark-done + commit should happen in the `done` transition handler inside `executeAction` or as a post-clean step.

Acceptance: After an orchestrator run where items reach `done`, TODOS.md on main reflects each item as done (removed or marked). The commit is pushed automatically. No dirty TODOS.md left in the working tree. Test verifies `mark-done` is called on transition to `done`.

Key files: `core/commands/orchestrate.ts`, `test/orchestrate.test.ts`

---

### Fix: Orchestrator should clean all worktrees before exiting (H-OL-2)

**Priority:** High
**Source:** Friction log #14
**Depends on:** None

When the orchestrator exits (all items terminal), stale worktrees for `done` items are sometimes left behind. The orchestrator should verify all worktrees for managed items are cleaned before emitting `orchestrate_complete`. Add a final sweep: `git worktree list`, filter for `todo/*` branches matching managed item IDs, and remove any stragglers.

Acceptance: After `orchestrate_complete`, no worktrees exist for any item the orchestrator managed. Test verifies cleanup sweep runs before exit.

Key files: `core/commands/orchestrate.ts`, `test/orchestrate.test.ts`

---

### Feat: Orchestrator complete event lists per-item final state (M-OL-3)

**Priority:** Medium
**Source:** Friction log #15
**Depends on:** None

The `orchestrate_complete` log event currently only reports aggregate counts (`done: 5, stuck: 0`). It should list each item ID with its final state and PR URL so the operator (or the /work skill) can reconcile without manual archaeology.

Acceptance: `orchestrate_complete` JSON includes an `items` array with `{id, state, prUrl}` for each managed item. The /work skill can parse this to provide a clear summary.

Key files: `core/commands/orchestrate.ts`, `test/orchestrate.test.ts`

---

## Vision (recurring, 2026-03-24)


### Feat: Explore vision, scope next iteration, and decompose into TODOs (L-VIS-2)

**Priority:** Low
**Source:** Self-improvement loop
**Depends on:** M-FIX-4, M-CI-1, L-DX-1, M-SUP-2

This is a recurring meta-item. When all other TODOs are complete, this item triggers a new cycle: (1) Review the current state of ninthwave against the product vision — what's shipped, what's missing, what friction was logged. (2) Read the friction log and identify actionable improvements. (3) Identify the next most impactful capability or refinement. (4) Decompose it into TODO items following the standard format. (5) Add a new copy of this same item (L-VIS-3, etc.) depending on the new terminal items, so the cycle continues.

Acceptance: New TODO items are written to TODOS.md. A new vision exploration item is added depending on the new terminal items. The friction log is reviewed and actionable items are addressed. TODOS.md is non-empty after this item completes.

Key files: `TODOS.md`, `CLAUDE.md`, `README.md`

---
