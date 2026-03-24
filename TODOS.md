# TODOS

<!-- Format guide: see $(cat .ninthwave/dir)/core/docs/todos-format.md -->

## State Reconciliation (friction log, 2026-03-24)

### Feat: Add `ninthwave reconcile` command for state reconciliation (H-REC-1)

**Priority:** High
**Source:** Friction log #17
**Depends on:** None

Add a `reconcile` CLI command that synchronizes TODOS.md with GitHub PR state and cleans up stale worktrees. The command should: (1) `git pull --rebase` to get latest main, (2) query `gh pr list --state merged` for `todo/*` branches and extract item IDs, (3) call `mark-done` for any merged item still open in TODOS.md, (4) remove worktrees for done items via `git worktree list` filtering, (5) `git add TODOS.md && git commit && git push` if changes were made. This is the single biggest source of friction in the /work loop — the skill repeatedly launched orchestrator runs for already-completed work because it trusted stale TODOS.md.

Acceptance: `ninthwave reconcile` pulls main, marks merged items done, cleans stale worktrees, and commits+pushes TODOS.md. Running it when everything is in sync is a no-op (no empty commits). Unit test verifies each step with injected dependencies. The command handles merge conflicts in TODOS.md during rebase gracefully (stash/pop or report).

Key files: `core/commands/reconcile.ts`, `core/cli.ts`, `test/reconcile.test.ts`

---

### Feat: Wire reconcile into /work skill phases (M-REC-2)

**Priority:** Medium
**Source:** Friction log #17
**Depends on:** H-REC-1

Update the /work SKILL.md to call `ninthwave reconcile` (or `.ninthwave/work reconcile`) at two points: (1) at the start of Phase 1 before running `list --ready`, and (2) in Phase 3 after each orchestrator exit before checking for remaining items. The skill instructions should mandate: "Never trust `list --ready` without reconciling first." Also update the orchestrator to call reconcile after each merge action so TODOS.md stays in sync during a run, not just at exit.

Acceptance: The /work SKILL.md includes reconcile calls in Phase 1 and Phase 3. The orchestrator calls reconcile after merge actions. Manual testing confirms that `list --ready` reflects actual GitHub state after reconcile runs.

Key files: `skills/work/SKILL.md`, `core/commands/orchestrate.ts`

---

## Multiplexer Abstraction (vision L-VIS-3, 2026-03-24)

### Refactor: Extract multiplexer interface from cmux module (H-MUX-1)

**Priority:** High
**Source:** L-VIS-3 vision review
**Depends on:** None

Create a `Multiplexer` interface in `core/mux.ts` with 4 operations: `launchWorkspace(cwd, command) → string | null`, `sendMessage(ref, message) → boolean`, `listWorkspaces() → string`, `closeWorkspace(ref) → boolean`. Wrap the existing `core/cmux.ts` functions as a `CmuxAdapter` implementing this interface. Export a `getMux()` factory that returns the active adapter. Update `core/commands/start.ts`, `core/commands/orchestrate.ts`, and `core/commands/clean.ts` to accept a `Multiplexer` via dependency injection instead of importing `* as cmux` directly. All existing tests should pass without modification.

**Test plan:**
- Unit test: `CmuxAdapter` delegates each method to the corresponding cmux function
- Verify existing tests pass unchanged (no behavioral changes)
- Edge case: `getMux()` returns CmuxAdapter by default

Acceptance: A `Multiplexer` interface exists with the 4 operations. A `CmuxAdapter` implements it. All call sites use the interface, not the concrete cmux module. Existing tests pass. No behavioral changes.

Key files: `core/mux.ts`, `core/cmux.ts`, `core/commands/start.ts`, `core/commands/orchestrate.ts`, `core/commands/clean.ts`

---

### Feat: Add tmux multiplexer adapter (H-MUX-2)

**Priority:** High
**Source:** L-VIS-3 vision review
**Depends on:** H-MUX-1

Implement `TmuxAdapter` in `core/mux.ts` (or `core/mux/tmux.ts`) that implements the `Multiplexer` interface using tmux CLI commands: `tmux new-session -d -s <name> -c <cwd> '<command>'` for launch, `tmux send-keys -t <name>` for send, `tmux list-sessions` for list, `tmux kill-session -t <name>` for close. Use `nw-<item-id>` session name prefix to avoid collisions with user sessions. Escape special characters in commands. Handle tmux-not-running errors gracefully (return null/false). Unit test with injected shell runner.

**Test plan:**
- Unit test: `launchWorkspace` calls `tmux new-session` with correct args
- Unit test: `sendMessage` calls `tmux send-keys` with escaped text
- Unit test: `listWorkspaces` parses tmux session list output
- Unit test: `closeWorkspace` calls `tmux kill-session`
- Unit test: graceful failure when tmux is not installed

Acceptance: `TmuxAdapter` implements `Multiplexer`. Unit tests verify each operation maps to the correct tmux CLI invocation. Error cases (tmux not running, session not found) return null/false gracefully. Session naming uses `nw-` prefix to avoid collisions with user sessions.

Key files: `core/mux.ts`, `test/mux.test.ts`

---

### Feat: Auto-detect multiplexer and add --mux flag (M-MUX-3)

**Priority:** Medium
**Source:** L-VIS-3 vision review
**Depends on:** H-MUX-2

Add multiplexer auto-detection to `getMux()`: (1) check `NINTHWAVE_MUX` env var for explicit override, (2) check if inside a cmux session (cmux-specific env vars), (3) check if inside a tmux session (`TMUX` env var), (4) check if cmux binary is available, (5) fall back to tmux. Add `--mux cmux|tmux` flag to `orchestrate` and `start` commands that sets `NINTHWAVE_MUX` before resolving the adapter. Thread the selected `Multiplexer` instance through the dependency chain via the existing `OrchestratorDeps` / `ExecutionContext` patterns.

**Test plan:**
- Unit test: auto-detection picks cmux when cmux env var is present
- Unit test: auto-detection picks tmux when TMUX env var is present
- Unit test: `NINTHWAVE_MUX=tmux` override works
- Unit test: `--mux` CLI flag is parsed and threaded through

Acceptance: Auto-detection picks the correct multiplexer based on environment. `--mux` flag overrides detection in `start` and `orchestrate`. `NINTHWAVE_MUX` env var works. Clear error message if no multiplexer is available.

Key files: `core/mux.ts`, `core/commands/start.ts`, `core/commands/orchestrate.ts`, `test/mux.test.ts`

---

### Docs: Update README and setup for tmux support (M-MUX-4)

**Priority:** Medium
**Source:** L-VIS-3 vision review
**Depends on:** M-MUX-3

Update README.md prerequisites table to list cmux or tmux as alternatives (cmux recommended for visual sidebar, tmux for headless/existing setups). Update the "How It Works" section to mention multiplexer flexibility. Update `ninthwave setup` to detect which multiplexer is available and include it in the post-setup summary. Add a brief "Using with tmux" section in the README explaining the difference.

**Test plan:**
- Review: README prerequisites section lists both multiplexers
- Review: Setup output mentions detected multiplexer
- Unit test: setup detects tmux availability when cmux is not available

Acceptance: README prerequisites show cmux and tmux as alternatives. Setup detects and reports available multiplexer. A user with only tmux installed sees clear guidance on how to proceed.

Key files: `README.md`, `core/commands/setup.ts`, `test/setup.test.ts`

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

### Feat: Explore vision, scope next iteration, and decompose into TODOs (L-VIS-4)

**Priority:** Low
**Source:** Self-improvement loop
**Depends on:** H-MUX-1, H-MUX-2, M-MUX-3, M-MUX-4, H-REC-1, M-REC-2

This is a recurring meta-item. When all other TODOs are complete, this item triggers a new cycle: (1) Review the current state of ninthwave against the product vision — what's shipped, what's missing, what friction was logged. (2) Read the friction log and identify actionable improvements. (3) Identify the next most impactful capability or refinement. (4) Decompose it into TODO items following the standard format. (5) Add a new copy of this same item (L-VIS-5, etc.) depending on the new terminal items, so the cycle continues.

Acceptance: New TODO items are written to TODOS.md. A new vision exploration item is added depending on the new terminal items. The friction log is reviewed and actionable items are addressed. TODOS.md is non-empty after this item completes.

Key files: `TODOS.md`, `CLAUDE.md`, `README.md`

---
