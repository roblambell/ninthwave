# Fix: Pre-flight check — auto-commit TODO files before worker launch (H-PFL-1)

**Priority:** High
**Source:** Friction — workers launched before TODO files committed to main (2026-03-27)
**Depends on:** None
**Domain:** daemon

## Problem

When launching workers via `nw start` or `nw orchestrate`, each worker gets a git worktree branched from the committed state of main. If TODO files in `.ninthwave/todos/` have been written but not committed/pushed, workers branch from main without those specs and either fail or work without guidance.

This happened during a dogfooding session (friction 2026-03-27): specs were written to `.ninthwave/todos/` and workers launched from conversation before committing. Workers branched from committed main, so their worktrees didn't contain the TODO specs.

## Fix

Add a pre-flight check to `core/preflight.ts` that detects uncommitted TODO files:

### 1. New check: `checkUncommittedTodos(projectRoot, runner)`

```typescript
export function checkUncommittedTodos(
  projectRoot: string,
  runner: ShellRunner,
): CheckResult {
  // Check for untracked or modified files in .ninthwave/todos/
  const status = runner("git", ["-C", projectRoot, "status", "--porcelain", ".ninthwave/todos/"]);
  if (status.exitCode !== 0) {
    return { status: "warn", message: "Could not check TODO file status" };
  }
  const changes = status.stdout.trim();
  if (!changes) {
    return { status: "pass", message: "All TODO files committed" };
  }
  const count = changes.split("\n").filter(Boolean).length;
  return {
    status: "fail",
    message: `${count} uncommitted TODO file(s) in .ninthwave/todos/`,
    detail: "Run: git add .ninthwave/todos/ && git commit -m 'chore: add TODO files' && git push",
  };
}
```

### 2. Wire into pre-flight

Add `checkUncommittedTodos` to the `preflight()` runner in `core/preflight.ts`. Pass `projectRoot` through to the preflight function.

### 3. Auto-commit option in orchestrate

In `core/commands/orchestrate.ts`, before launching workers, if uncommitted TODO files are detected:
- In interactive mode: prompt "Uncommitted TODO files detected. Commit and push? [Y/n]"
- In daemon/non-interactive mode: auto-commit and push with message `chore: commit TODO files before orchestration`

### 4. Add to `nw doctor`

Also surface this check in `nw doctor` output for visibility.

## Test plan

- Unit test: `checkUncommittedTodos` returns "pass" when no changes in `.ninthwave/todos/`
- Unit test: `checkUncommittedTodos` returns "fail" with count when untracked files exist
- Unit test: `checkUncommittedTodos` returns "fail" when modified files exist
- Unit test: `checkUncommittedTodos` returns "warn" when git status fails
- Integration: `preflight()` includes the TODO check in its results

Acceptance: `nw orchestrate` and `nw start` detect uncommitted TODO files before creating worktrees. In daemon mode, uncommitted TODOs are auto-committed. In interactive mode, the user is prompted. `nw doctor` surfaces the check. No workers launch with missing TODO specs.

Key files: `core/preflight.ts` (add check), `core/commands/orchestrate.ts` (wire pre-flight + auto-commit), `core/commands/start.ts` (wire pre-flight), `core/commands/doctor.ts` (add to doctor output)
