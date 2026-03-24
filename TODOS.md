# TODOS

<!-- Format guide: see $(cat .ninthwave/dir)/core/docs/todos-format.md -->

## State Reconciliation (friction log, 2026-03-24)


### Feat: Wire reconcile into /work skill phases (M-REC-2)

**Priority:** Medium
**Source:** Friction log #17
**Depends on:** H-REC-1

Update the /work SKILL.md to call `ninthwave reconcile` (or `.ninthwave/work reconcile`) at two points: (1) at the start of Phase 1 before running `list --ready`, and (2) in Phase 3 after each orchestrator exit before checking for remaining items. The skill instructions should mandate: "Never trust `list --ready` without reconciling first." Also update the orchestrator to call reconcile after each merge action so TODOS.md stays in sync during a run, not just at exit.

Acceptance: The /work SKILL.md includes reconcile calls in Phase 1 and Phase 3. The orchestrator calls reconcile after merge actions. Manual testing confirms that `list --ready` reflects actual GitHub state after reconcile runs.

Key files: `skills/work/SKILL.md`, `core/commands/orchestrate.ts`

---

## Vision (recurring, 2026-03-24)




### Feat: Explore vision, scope next iteration, and decompose into TODOs (L-VIS-3)

**Priority:** Low
**Source:** Self-improvement loop
**Depends on:** H-OL-2, H-CDL-1, M-TST-1, M-TCO-1, L-FRE-1

This is a recurring meta-item. When all other TODOs are complete, this item triggers a new cycle: (1) Review the current state of ninthwave against the product vision — what's shipped, what's missing, what friction was logged. (2) Read the friction log and identify actionable improvements. (3) Identify the next most impactful capability or refinement. (4) Decompose it into TODO items following the standard format. (5) Add a new copy of this same item (L-VIS-4, etc.) depending on the new terminal items, so the cycle continues.

Acceptance: New TODO items are written to TODOS.md. A new vision exploration item is added depending on the new terminal items. The friction log is reviewed and actionable items are addressed. TODOS.md is non-empty after this item completes.

Key files: `TODOS.md`, `CLAUDE.md`, `README.md`

---
