# Fix: Rebase before merge retry on conflict (H-ORC-1)

**Priority:** High
**Source:** Friction log: orchestrator-merge-retry-no-rebase.md (2026-03-27)
**Depends on:** None
**Domain:** orchestrator

When a merge fails because the branch is CONFLICTING (other PRs merged to main while CI ran), the orchestrator blindly retries the same merge up to 3 times -- all guaranteed to fail. Instead, detect the conflict and rebase before retrying.

In `executeMerge()`, when `prMerge()` fails, call `checkPrMergeable()` to check the PR's mergeable status. If CONFLICTING, trigger `daemonRebase()` and transition the item back to `ci-pending` (so CI re-runs on the rebased branch). Do not increment `mergeFailCount` for conflict-caused failures -- only count genuine merge failures. Reset `rebaseRequested` so the rebase path works correctly.

**Test plan:**
- Unit test: merge fails + PR is CONFLICTING -> daemonRebase called, item transitions to ci-pending, mergeFailCount not incremented
- Unit test: merge fails + PR is NOT conflicting -> normal retry behavior (mergeFailCount incremented, transitions to ci-passed)
- Unit test: daemonRebase fails on a conflicting PR -> fall back to sending worker a rebase message, transition to ci-pending
- Verify existing merge tests still pass

Acceptance: When a merge fails due to conflicts, the orchestrator rebases and re-enters CI-pending instead of retrying the same failing merge. Non-conflict merge failures still retry up to maxMergeRetries. Tests pass.

Key files: `core/orchestrator.ts:1085-1107`, `core/gh.ts`, `test/orchestrator-unit.test.ts`
