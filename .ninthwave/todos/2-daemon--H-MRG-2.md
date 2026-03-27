# Test: Integration test for merge detection lifecycle (H-MRG-2)

**Priority:** High
**Source:** Friction log (recurring merge detection failures)
**Depends on:** H-MRG-1
**Domain:** daemon

The state machine unit tests (M-TST-6) test individual transitions but don't test the full `buildSnapshot → processTransitions → handleImplementing/handlePrLifecycle` integration path for merged PRs. The merge detection bug (#20, 2026-03-26, 2026-03-27) recurred because there was no integration test covering the fast auto-merge scenario.

Add an integration test that exercises the complete merge detection lifecycle:
1. Item starts in `implementing` state with no PR number tracked
2. `checkPrStatus` returns `merged` status (simulating fast auto-merge)
3. `buildSnapshot` constructs the snapshot
4. `processTransitions` produces the correct `clean` action
5. Item transitions to `merged` state

Test three scenarios:
- **Happy path:** PR title matches TODO title → detected
- **Rephrased title:** PR title differs from TODO title → still detected (branch name is identity)
- **Restart recovery:** After `reconstructState`, a merged PR from a previous cycle with a different title is correctly rejected

Acceptance: Integration test covers the full buildSnapshot-to-action pipeline for merged PRs. Test exercises the fast auto-merge case where `orchItem.prNumber` was never set. Test file passes `bun test test/`.

**Test plan:** Create `test/merge-detection.test.ts` with the three scenarios above. Use dependency injection (mock `checkPrStatus` and `isWorkerAlive`) rather than `vi.mock`. Verify both the snapshot output and the resulting actions from `processTransitions`.

Key files: `test/merge-detection.test.ts`, `core/commands/orchestrate.ts`, `core/orchestrator.ts`
