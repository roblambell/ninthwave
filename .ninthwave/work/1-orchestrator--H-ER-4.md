# Fix: Orchestrator transition edge case fixes (H-ER-4)

**Priority:** High
**Source:** Engineering review R2-F2, R2-F11, R2-F6, R4-F7, R2-F15
**Depends on:** None
**Domain:** orchestrator

Five small targeted fixes to state transition edge cases in `core/orchestrator.ts`:

1. **Reset lastCommitTime in stuckOrRetry** (~3 LOC): In `stuckOrRetry()` (lines ~941-953), add `item.lastCommitTime = undefined` alongside the existing `lastAliveAt` and `notAliveCount` resets. Without this, a retried worker inherits the stale commit timestamp from the previous attempt and may timeout immediately because `handleImplementing` measures activity from the old commit time.

2. **Handle closed PRs in handleMerging** (~5 LOC): In `handleMerging()` (lines ~1288-1303), add handling for `snap?.prState === "closed"`. Transition to `stuck` with `item.failureReason = "merge-aborted: PR was closed without merging"`. Currently, a manually closed PR leaves the item in `merging` state indefinitely.

3. **Reorder executeMerge transition** (~5 LOC): In `executeMerge()` (lines ~1730-1800), move `this.transition(item, "merged")` to immediately after `deps.prMerge()` succeeds, before `deps.getMergeCommitSha()`. If `getMergeCommitSha` throws, the item currently stays in `merging` state even though the PR was already merged. The state machine self-heals on the next poll, but this eliminates the gap cycle.

4. **Save dep commit SHA before merge for restack** (~10 LOC): In `executeMerge()`, before calling `deps.prMerge()`, resolve the dependency branch's commit SHA (e.g., via `deps.resolveRef?.(depBranch)`). After merge, use the SHA instead of the branch name when calling `rebaseOnto()` for dependent restacking. This prevents the rebase from failing when the dependency branch is deleted by the merge (GitHub auto-deletes merged branches).

5. **Add launching state timeout** (~10 LOC): In the launching state handler (lines ~724-738), add a timeout check. If the item has been in `launching` state for longer than 5 minutes (configurable via a constant), call `stuckOrRetry` with reason "launch-timeout". Currently, if a worker session is created but never registers as alive or dead, the item stays in `launching` indefinitely because `workerAlive` is `undefined` (not `false`), so the `NOT_ALIVE_THRESHOLD` debounce doesn't apply.

**Test plan:**
- Add test: item in `implementing` state after retry should NOT inherit stale `lastCommitTime`
- Add test: `merging` state with `prState === "closed"` transitions to `stuck` with correct reason
- Add test: `executeMerge` transitions to `merged` even if `getMergeCommitSha` throws
- Add test: `launching` state with no workerAlive signal for > 5 minutes triggers stuckOrRetry
- Verify existing orchestrator.test.ts and scenario tests pass

Acceptance: All five edge cases are handled. Workers retried via `stuckOrRetry` start with fresh timeout baselines. Manually closed PRs surface as `stuck`. Merge transition is resilient to post-merge failures. Stacked restacking uses SHAs not branch names. Launching has a timeout. `bun test test/` passes.

Key files: `core/orchestrator.ts:941`, `core/orchestrator.ts:1288`, `core/orchestrator.ts:1730`, `core/orchestrator.ts:724`
