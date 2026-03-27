# Fix: Delete stale branches before launching workers on reused TODO IDs (H-ORC-4)

**Priority:** High
**Source:** Friction log: id-collision-false-completion.md (2026-03-27)
**Depends on:** None
**Domain:** orchestrator

When a TODO ID is reused (same ID, different title/work), the old `todo/*` branch may still exist with a merged PR. Workers launched on this branch detect the existing merged PR and immediately exit, falsely marking the item as "done". The orchestrator already emits a warning ("Title comparison will prevent false completion") but takes no corrective action.

In the launch action handler (`executeLaunch()`), before creating the worktree, check if the branch already exists and has merged PRs with titles that don't match the current TODO title. If so, delete the old branch (`git branch -D todo/<ID>` and `git push origin --delete todo/<ID>`) so the worker starts fresh. This ensures the worker creates a new PR matching the current TODO's work.

**Test plan:**
- Unit test: launch with existing branch + merged PR with different title -> branch deleted before worktree creation
- Unit test: launch with existing branch + merged PR with matching title -> no deletion (normal flow)
- Unit test: launch with no existing branch -> normal flow (no deletion needed)
- Unit test: branch deletion fails -> graceful fallback (log error, attempt launch anyway)

Acceptance: Workers on reused TODO IDs always start from a fresh branch. No false completions from old merged PRs. Tests pass.

Key files: `core/orchestrator.ts`, `core/git-worktree.ts`, `test/orchestrator-unit.test.ts`
