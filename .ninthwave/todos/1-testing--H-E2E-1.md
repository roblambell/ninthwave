# Test: End-to-end test suite for merge detection pipeline (H-E2E-1)

**Priority:** High
**Source:** Friction — merge detection has caused 5+ separate friction items across 4 grind cycles
**Depends on:** None
**Domain:** testing

## Problem

The merge detection pipeline (PR opened → CI status → merge → cleanup) has been the single largest source of recurring friction in ninthwave's dogfooding history:

- Friction #20: `handleImplementing` didn't check `prState === "merged"` (fixed)
- Friction #22: CONFLICTING PRs stuck in merge-retry loop (fixed)
- Friction #23: CI-pending PRs with merge conflicts hang forever (fixed)
- Processed: title collision check too aggressive, dropping valid merge detections (fixed)
- 2026-03-27: daemon still missed merged PRs despite all prior fixes

Each fix addressed one specific case but didn't prevent regressions in adjacent paths. The merge detection code path spans 4 files (`watch.ts`, `orchestrate.ts`, `orchestrator.ts`, `daemon.ts`) and has no end-to-end test coverage.

## Fix

Add a dedicated test file `test/merge-detection.test.ts` with end-to-end coverage for the merge detection pipeline:

### Test cases

1. **Happy path: PR auto-merges between polls**
   - Worker creates PR → PR auto-merges via `gh pr merge --squash --auto` → `buildSnapshot` returns `prState: "merged"` → `handleImplementing` transitions to "merged" → clean action emitted

2. **PR merges while in ci-pending state**
   - Item in `ci-pending` → PR merges externally → `handlePrLifecycle` detects merged state → transitions correctly

3. **PR merges while in ci-passed state**
   - Item in `ci-passed` → PR merges → `handleCiPassed` detects → transitions to merged

4. **Title collision: reused TODO ID with stale merged PR**
   - Old PR for `todo/H-FOO-1` is merged → new TODO `H-FOO-1` is created → `buildSnapshot` correctly ignores the stale merged PR (title mismatch) → returns `no-pr`

5. **Title collision: tracked PR number matches**
   - Orchestrator already tracks PR #42 for item → `buildSnapshot` sees merged PR #42 → trusts it regardless of title → returns `prState: "merged"`

6. **Merge conflict detection: CONFLICTING in ci-pending**
   - Item in `ci-pending` → snapshot shows `isMergeable: false` → rebase action emitted

7. **Merge retry limit: 3 failures → stuck**
   - `executeMerge` fails 3 times → item transitions to stuck (not infinite loop)

8. **Branch deleted after squash merge**
   - PR squash-merged → branch auto-deleted → `prList("open")` returns empty → `prList("merged")` returns the merged PR → snapshot has `prState: "merged"`

### Implementation approach

- Use the existing `Orchestrator` class with mock deps (no real `gh` calls)
- Mock `checkPrStatus` to return different status strings per test
- Mock `isWorkerAlive` and `getWorktreeLastCommitTime` as needed
- Test the full path: `buildSnapshot` → `orchestrator.poll()` → verify transitions and actions
- Follow the project's dependency injection pattern (no `vi.mock`)

## Test plan

- All 8 test cases above pass
- Run `bun test test/merge-detection.test.ts` — all pass
- Run `bun test test/` — full suite passes (no mock leakage)

Acceptance: 8+ test cases covering the merge detection pipeline end-to-end. All tests pass. No `vi.mock` usage (dependency injection only). Full test suite remains green.

Key files: `test/merge-detection.test.ts` (new), `core/orchestrator.ts` (read for test design), `core/commands/orchestrate.ts:173-292` (buildSnapshot), `core/commands/watch.ts:157-230` (checkPrStatus)
