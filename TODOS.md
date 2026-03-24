# TODOS

<!-- Format guide: see $(cat .ninthwave/dir)/core/docs/todos-format.md -->

## Reliability & DX (friction log iteration 2, 2026-03-24)

### Fix: Clean command should scope workspace closing to specified IDs (H-FIX-1)

**Priority:** High
**Source:** Friction log #9

The `clean` command's `cleanSingleWorktree` calls `cmux close-workspace` for ALL todo workspaces, not just the one being cleaned. This kills active worker sessions when you only want to clean a merged item. The orchestrator's `executeClean` calls `deps.closeWorkspace(item.workspaceRef)` correctly (scoped to one workspace), but if `cleanSingleWorktree` is also closing all workspaces, it's destructive. Audit `core/commands/clean.ts` to ensure only the targeted workspace is closed. The workspace ref or item ID should be used to scope the close.

Acceptance: Running `ninthwave clean H-1` when H-2 and H-3 have active workers only closes H-1's workspace. Other workers continue uninterrupted. Unit test verifies scoped closing.

Key files: `core/commands/clean.ts`, `test/clean.test.ts`

---

### Fix: Setup command should use relative symlinks (H-FIX-2)

**Priority:** High
**Source:** Friction log #1

The `setup` command creates skill symlinks using absolute paths. When the repo is moved or renamed, all symlinks break. Change `setupProject` in `core/commands/setup.ts` to compute relative paths from the symlink location to the target, using `path.relative()`. This makes setup resilient to repo moves and renames.

Acceptance: `ninthwave setup` creates relative symlinks for skills and agents. Symlinks survive `mv` of the project directory. Existing test coverage updated.

Key files: `core/commands/setup.ts`, `test/setup.test.ts`

---

### Feat: Memory-aware WIP defaults in orchestrate command (M-FIX-3)

**Priority:** Medium
**Source:** Friction log #11

Each parallel worker consumes ~2-3GB RAM (Claude Code + language server + git worktree). Running 8 workers on a 16GB machine caused an OOM crash. The `orchestrate` command should set a sensible default WIP limit based on available system memory. Use `os.totalmem()` to detect RAM and compute: `Math.max(2, Math.floor(totalGB / 3))` as the default. Log the computed default. Allow `--wip-limit` to override.

Acceptance: On a 16GB machine, default WIP is 5. On 8GB, default WIP is 2. The `--wip-limit` flag still overrides. Structured log shows the computed vs. overridden value. Unit test mocks `os.totalmem()` and verifies computation.

Key files: `core/commands/orchestrate.ts`, `test/orchestrate.test.ts`

---

### Docs: Update README CLI reference to include orchestrate command (M-DOC-1)

**Priority:** Medium
**Source:** Self-review

The README's CLI reference table lists all commands but is missing the new `orchestrate` command. Add it to the table. Also update the `/work` skill description in the Skills table to mention it delegates to `orchestrate`. Update the "What happens" column for the /work Monitor phase.

Acceptance: README CLI table includes `orchestrate --items ID1,ID2 [options]` with description. Skills table /work description is updated. No other README changes.

Key files: `README.md`

---

### Feat: Shim auto-resolves bundle path without .ninthwave/dir (M-FIX-4)

**Priority:** Medium
**Source:** Friction log #2
**Depends on:** H-FIX-2

The `.ninthwave/work` shim depends on `.ninthwave/dir` to find the ninthwave bundle. This file contains absolute paths and isn't committed to git. After a fresh clone, the shim fails silently. Change the shim to resolve the bundle path by: (1) checking if `ninthwave` is in PATH (brew install), (2) walking up the directory tree to find a ninthwave checkout (dev mode). Remove the dependency on `.ninthwave/dir`. Update `setup.ts` to generate the improved shim.

Acceptance: After `git clone` + `ninthwave setup`, the shim works without `.ninthwave/dir`. The `ninthwave` binary in PATH takes priority. Dev-mode fallback walks up to find `core/cli.ts`. Unit test verifies shim generation.

Key files: `core/commands/setup.ts`, `test/setup.test.ts`

---

### Feat: Add GitHub Actions CI workflow (M-CI-1)

**Priority:** Medium
**Source:** Self-review

The repo has no CI. PRs merge without automated test verification. Add a `.github/workflows/ci.yml` that runs `bunx vitest run` on push to main and on pull requests. Use the `oven-sh/setup-bun` action. Add a required status check named "CI Gate" to match the existing branch protection rule.

Acceptance: `bunx vitest run` runs on every PR. The workflow name is "CI" with a job named "CI Gate". Tests pass on the current codebase (excluding known pre-existing failures in setup.test.ts which use Bun APIs unavailable in the CI Node environment — skip those).

Key files: `.github/workflows/ci.yml`

---

### Feat: Workers log friction when dogfooding ninthwave (L-DX-1)

**Priority:** Low
**Source:** Friction log #7
**Depends on:** H-FIX-1

When the project being worked on IS the ninthwave repo (dogfooding), workers encounter friction but have no mechanism to report it. Add a step to `agents/todo-worker.md` that detects dogfooding mode (check if `skills/work/SKILL.md` exists in the project root) and, when active, appends friction observations to a friction log file at the end of the worker's run. The friction entry should include the TODO ID, a brief description, and the severity.

Acceptance: Worker agent prompt includes a dogfooding friction logging step. Detection is based on `skills/work/SKILL.md` existing in the project root. Friction is appended to `.ninthwave/friction.log`. The step is skipped for non-ninthwave projects.

Key files: `agents/todo-worker.md`

---

## Vision (recurring, 2026-03-24)

### Feat: Explore vision, scope next iteration, and decompose into TODOs (L-VIS-2)

**Priority:** Low
**Source:** Self-improvement loop
**Depends on:** M-FIX-4, M-CI-1, L-DX-1

This is a recurring meta-item. When all other TODOs are complete, this item triggers a new cycle: (1) Review the current state of ninthwave against the product vision — what's shipped, what's missing, what friction was logged. (2) Read the friction log and identify actionable improvements. (3) Identify the next most impactful capability or refinement. (4) Decompose it into TODO items following the standard format. (5) Add a new copy of this same item (L-VIS-3, etc.) depending on the new terminal items, so the cycle continues.

Acceptance: New TODO items are written to TODOS.md. A new vision exploration item is added depending on the new terminal items. The friction log is reviewed and actionable items are addressed. TODOS.md is non-empty after this item completes.

Key files: `TODOS.md`, `CLAUDE.md`, `README.md`

---
