# Friction: Orchestrator retries merge without re-rebasing on conflict

**Observed:** 2026-03-27
**Project:** strait (ninthwave-sh/strait)
**Severity:** High
**Component:** orchestrator merge flow

## What happened

M-V2-4 (PR #23) passed CI and moved to `merging` state. By the time the orchestrator tried to merge, other PRs had already merged to main, making the branch CONFLICTING. The orchestrator retried the merge 3 times (all failed with the same conflict) and then marked the item stuck.

The orchestrator had already rebased M-V2-4 at 17:58 before CI ran, but between CI passing (~18:02) and the merge attempt, H-V2-1, H-CP-4, M-CP-5, and other PRs merged to main, creating new conflicts.

## Expected behavior

When a merge fails due to conflicts (mergeable: CONFLICTING), the orchestrator should:
1. Re-rebase the branch onto latest main
2. Wait for CI to re-run on the rebased branch
3. Then retry the merge

Instead it retried the same merge 3 times without rebasing, guaranteeing all retries would fail.

## Log evidence

```
18:02:38 action_execute merge M-V2-4 prNumber:23
18:02:38 action_result merge M-V2-4 success:false "Merge failed for PR #23 (attempt 1/3)"
18:02:53 action_execute merge M-V2-4 prNumber:23
18:02:53 action_result merge M-V2-4 success:false "Merge failed for PR #23 (attempt 2/3)"
18:03:07 action_execute merge M-V2-4 prNumber:23
18:03:07 action_result merge M-V2-4 success:false "Merge failed 3 times for PR #23, marking stuck"
```

## Suggested fix

In the merge action handler, check the GitHub mergeable status before retrying. If `mergeable: CONFLICTING`, rebase first, then re-enter CI-pending instead of retrying the same merge.
