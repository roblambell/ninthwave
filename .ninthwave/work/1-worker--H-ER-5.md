# Fix: Launch resource leak cleanup (H-ER-5)

**Priority:** High
**Source:** Engineering review R3-F1, R7-B5
**Depends on:** None
**Domain:** worker

Wrap steps 3-8 of `launchSingleItem()` in `core/commands/launch.ts` (lines ~427-665) in a try/catch that cleans up partially-created resources on failure.

Currently, `launchSingleItem` performs a sequence: create worktree, write cross-repo index, seed agent files, allocate partition, write system prompt, launch AI session. If `launchAiSession` fails (returns null at line ~663), or if any intermediate step throws, the worktree, partition file, and cross-repo index entry are leaked. The function returns null and the caller has no reference to clean up.

Add cleanup logic that runs when any step after worktree creation fails:
- Release the allocated partition via `releasePartition(partitionDir, item.id)`
- Remove the cross-repo index entry if one was written
- Remove the worktree via `removeWorktree(targetRepo, worktreePath, true)` (best-effort, wrapped in try/catch)

The cleanup should be in a `catch` block or a `finally` block with a success flag. Each cleanup step should be individually wrapped in try/catch since cleanup itself may fail.

**Test plan:**
- Add test: when `launchAiSession` returns null, verify partition is released and worktree cleanup is attempted
- Add test: when prompt file write throws, verify partition and worktree are cleaned up
- Verify existing launch.test.ts tests pass

Acceptance: If any step after worktree creation fails in `launchSingleItem`, all previously-created resources (worktree, partition, cross-repo index) are cleaned up. `bun test test/` passes.

Key files: `core/commands/launch.ts:427`
