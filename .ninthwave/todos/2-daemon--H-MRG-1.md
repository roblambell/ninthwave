# Fix: Daemon misses merged PRs that auto-merge between polls (H-MRG-1)

**Priority:** High
**Source:** Friction log (2026-03-27, 2026-03-26)
**Domain:** daemon

The orchestrator daemon still misses merged PRs when auto-merge completes between poll cycles. This is the #1 recurring friction item across four dogfooding loops (#20, #22, processed/2026-03-26, and 2026-03-27 friction entries).

**Root cause:** In `buildSnapshot()`, when a PR auto-merges before the daemon ever sees it as "open", `orchItem.prNumber` is never set. The `alreadyTracked` bypass (added in the 2026-03-26 fix) requires `orchItem.prNumber === mergedPrNum`, which is false for never-tracked PRs. The code falls through to the `prTitleMatchesTodo` check, which rejects PRs where the worker rephrased the title (common — workers often use different conventional commit prefixes or rephrase for clarity).

**Fix:** In `buildSnapshot()`'s live polling path (around line 220 of `core/commands/orchestrate.ts`), remove the title collision check for merged PRs. The branch name `todo/{ID}` is the definitive identity during live polling — if `checkPrStatus` finds a merged PR for that branch, it's ours. The title check is only needed in `reconstructState()` (line ~595) to handle cross-cycle ID reuse after daemon restart.

Specifically:
1. In `buildSnapshot`'s `case "merged"` block, always set `snap.prState = "merged"` (trust the branch name).
2. Keep the title check in `reconstructState`'s merge handling (that path handles cross-cycle ambiguity).
3. Also apply the `alreadyTracked` bypass to `reconstructState` for items where the daemon previously assigned a PR number (defensive, for restarts mid-run).

Acceptance: Auto-merged PRs are detected within 1-2 poll cycles regardless of title phrasing. The `buildSnapshot` merge path no longer uses `prTitleMatchesTodo`. The `reconstructState` path retains title checking for cross-cycle safety. Existing merge-detection tests pass.

**Test plan:** Add unit tests to `test/orchestrator.test.ts` that verify: (1) `buildSnapshot` detects a merged PR even when `orchItem.prNumber` is unset and the PR title differs from the TODO title; (2) `reconstructState` still rejects title-mismatched merged PRs from previous cycles; (3) `reconstructState` accepts title-mismatched merged PRs when `orchItem.prNumber` matches.

Key files: `core/commands/orchestrate.ts`, `core/todo-utils.ts`, `test/orchestrator.test.ts`
