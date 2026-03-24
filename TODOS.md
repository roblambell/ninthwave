# TODOS

<!-- Format guide: see $(cat .ninthwave/dir)/core/docs/todos-format.md -->

## Autonomous Pipeline (L-VIS-2 iteration, 2026-03-24)



### Feat: Add Phase 3 continuous delivery loop to /work skill (H-CDL-1)

**Priority:** High
**Source:** Friction log #12, L-VIS-2 vision review
**Depends on:** H-OL-1, M-OL-3

The /work skill currently stops after the orchestrator exits (Phase 2). It should have a Phase 3 that continues the delivery loop: after orchestrator completes, check `list --ready` for remaining items unblocked by the completed batch, and if more exist, loop back to Phase 2 with a confirmation prompt. In dogfooding mode (working on the ninthwave repo), Phase 3 should also review the friction log for new actionable entries and offer to decompose them into TODOs before continuing. This closes the gap between "one batch done" and "all work done."

**Test plan:**
- Manual verification: run /work, confirm Phase 3 prompt appears after orchestrator exits
- Verify `list --ready` is called after orchestrate completes
- Verify dogfooding detection (check for ninthwave-specific marker files)
- Edge case: no remaining items — skill should report "all done" and exit cleanly

Acceptance: After the orchestrator exits, the /work skill checks for remaining ready items and offers to continue. In dogfooding mode, the friction log is checked for new actionable entries. The skill loops until no ready items remain or the user chooses to stop. SKILL.md contains a documented Phase 3.

Key files: `skills/work/SKILL.md`

---

## Test Confidence (L-VIS-2 iteration, 2026-03-24)



### Test: Exhaustive orchestrator state machine test coverage (M-TST-1)

**Priority:** Medium
**Source:** L-VIS-2 vision review — VISION.md Section A
**Depends on:** None

The orchestrator state machine has 13 states and multiple transition paths. Current test coverage exists but does not systematically cover all valid transitions, invalid transitions, and edge cases. Add comprehensive tests for: every valid state transition, rejection of invalid transitions, dependency-gated transitions (queued → ready when deps clear), WIP-limited launching, concurrent transitions in a single tick, and crash recovery state reconstruction. The OOM crash (friction #11) was partly caused by a missing transition — exhaustive coverage prevents this class of bug.

**Test plan:**
- Map all 13 states × valid transitions in a test matrix
- Test each valid transition with minimal setup
- Test invalid transitions (e.g., `queued → merging`) are rejected or ignored
- Test dependency chains: item unblocks when all deps reach `done`
- Test WIP limit: items stay `ready` when WIP is at capacity
- Test crash recovery: reconstruct state from disk snapshots

Acceptance: Every valid state transition in the orchestrator is covered by at least one test. Invalid transitions are tested to confirm they are rejected. Dependency-gated and WIP-limited transitions have dedicated test cases. Test file runs cleanly with `bun test test/orchestrator.test.ts`. No infinite loops or OOM in any test path.

Key files: `test/orchestrator.test.ts`, `core/orchestrator.ts`

---

### Feat: Add test plan field to /decompose skill output (M-TCO-1)

**Priority:** Medium
**Source:** L-VIS-2 vision review — VISION.md Section A (test confidence)
**Depends on:** None

The /decompose skill generates work items but does not include a `**Test plan:**` field. The format guide (`todos-format.md`) already defines the field and the parser already supports it, but the decompose skill's output template doesn't generate it. Update the decompose SKILL.md to instruct the AI to generate a test plan for each work item during decomposition. The test plan should specify: what tests to write or verify, key code paths to cover, and edge cases specific to the item.

**Test plan:**
- Run /decompose on a sample spec and verify each output item has a `**Test plan:**` section
- Verify the parser extracts the test plan field correctly (existing parser test)
- Edge case: item with no testable code (e.g., docs-only) — test plan should say "Manual review"

Acceptance: The /decompose SKILL.md template includes `**Test plan:**` in every generated work item. Generated test plans are specific to each item (not generic boilerplate). The parser correctly extracts the field from generated output.

Key files: `skills/decompose/SKILL.md`

---

## Developer Experience (L-VIS-2 iteration, 2026-03-24)



### Feat: First-run experience validation and polish (L-FRE-1)

**Priority:** Low
**Source:** L-VIS-2 vision review — VISION.md Section A
**Depends on:** None

The target is `brew install` → `ninthwave setup` → first `/work` run in under 10 minutes. Currently, the setup command doesn't validate prerequisites (cmux, gh, AI tool) or provide helpful error messages when they're missing. Add prerequisite checking to `ninthwave setup` that detects missing dependencies and prints actionable install instructions. Also verify the README quick-start instructions are accurate and complete by walking through them on a clean environment.

**Test plan:**
- Unit test: `setup` detects missing `cmux` and prints install instructions
- Unit test: `setup` detects missing `gh` and prints install instructions
- Manual test: follow README quick-start from scratch, note any gaps
- Edge case: `gh` installed but not authenticated — should warn

Acceptance: `ninthwave setup` checks for required prerequisites (cmux, gh) and prints clear error messages with install commands when missing. The README quick-start path is validated as accurate. Setup completes successfully when all prerequisites are met.

Key files: `core/commands/setup.ts`, `test/setup.test.ts`, `README.md`

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
