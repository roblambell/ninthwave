# Fix merged-state hold logic so verification cannot complete early (H-PMV-2)

**Priority:** High
**Source:** Decomposed from premature `verifying` -> `done` investigation plan 2026-04-01
**Depends on:** H-PMV-1
**Domain:** post-merge-verification

Use the merged-item metadata foundation to fix the actual premature-completion bug. Change `core/orchestrator.ts` so `merged` becomes a retrying hold state when post-merge verification is still required: if `fixForward` is enabled and `mergeCommitSha` is still unavailable, stay in `merged` and retry on later polls instead of falling through to `done`.

Update the post-merge action path to verify against the repository's real default branch rather than hardcoded `main`, including forward-fixer worktree creation and post-merge refresh behavior in `core/orchestrator-actions.ts`, `core/commands/launch.ts`, and any orchestrate wiring needed to thread the resolved branch through. Replace existing regression tests that encode `missing mergeCommitSha -> done` and add coverage for delayed squash-merge SHA discovery, non-`main` default branches, and the full `merged -> forward-fix-pending -> done` path after post-merge checks actually pass.

**Test plan:**
- Replace current tests that expect merged items without `mergeCommitSha` to complete immediately
- Add orchestrator coverage proving a squash-merged PR stays in `merged` until later polling discovers `mergeCommitSha`, then enters `forward-fix-pending` and only reaches `done` after merge-commit verification passes
- Add launch/action coverage proving post-merge refresh and fix-forward paths use the repo default branch when it is not `main`
- Run `bun test test/verify-main.test.ts test/orchestrate.test.ts test/launch.test.ts test/merge-detection.test.ts --smol --bail`
- Run `bun test test/ --smol --bail`

Acceptance: A merged item no longer reaches `done` while post-merge verification is still pending. With `fixForward` enabled, delayed squash-merge metadata keeps the item in `merged` until the merge commit is known, post-merge verification runs against the actual default branch, and the item reaches `done` only after the post-merge path has genuinely completed.

Key files: `core/orchestrator.ts`, `core/orchestrator-actions.ts`, `core/commands/orchestrate.ts`, `core/commands/launch.ts`, `test/verify-main.test.ts`, `test/orchestrate.test.ts`, `test/launch.test.ts`, `test/merge-detection.test.ts`
