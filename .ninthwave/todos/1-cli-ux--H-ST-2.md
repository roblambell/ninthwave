# Fix: Drop "TODO" from PR title templates (H-ST-2)

**Priority:** High
**Source:** Plan: Status Command Condensing (2026-03-27)
**Depends on:** None
**Domain:** cli-ux

PR titles are inconsistent -- some include `(TODO H-SR-3)`, some just `(H-SR-3)`, vision PRs have no ID at all. The word "TODO" in titles adds noise and looks odd in a PR list. Update the worker prompt templates to include the ID but drop the "TODO" prefix. Standard format becomes `feat: <description> (H-SR-3)`. No-op format becomes `chore: close H-SR-3 -- no code change needed`.

**Test plan:**
- Manual review of template changes in `agents/todo-worker.md`
- Verify no other files reference the old `(TODO YOUR_TODO_ID)` pattern

Acceptance: Line 223 standard template uses `(YOUR_TODO_ID)` not `(TODO YOUR_TODO_ID)`. Line 88 no-op template uses `close YOUR_TODO_ID` not `close TODO YOUR_TODO_ID`. Line 90 body uses `Closes YOUR_TODO_ID`. No occurrences of `(TODO ` remain in PR title templates.

Key files: `agents/todo-worker.md:88`, `agents/todo-worker.md:223`
