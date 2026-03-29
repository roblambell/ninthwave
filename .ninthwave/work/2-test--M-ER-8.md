# Test: Missing state transition tests (M-ER-8)

**Priority:** Medium
**Source:** Engineering review R6-F2, R7-D6
**Depends on:** H-ER-8
**Domain:** test

Add exhaustive transition tests for 6 states missing from the "Exhaustive state transitions" section in `test/orchestrator.test.ts`. The existing section (lines ~1835-2742) covers 11 of 18 states (post pr-open collapse). The missing states have some coverage in separate test files but are not in the exhaustive matrix.

Add these transition test groups to the exhaustive section:

1. **`bootstrapping`** -- transitions to test:
   - bootstrapping -> launching (bootstrap complete, workspace alive)
   - bootstrapping -> stuck (bootstrap failure, max retries exhausted)

2. **`repairing`** -- transitions to test:
   - repairing -> ci-pending (repair worker pushes fix, CI restarts with status pending)
   - repairing -> ci-passed (CI already passed when repair completes)
   - repairing -> ci-failed (repair worker's fix still fails CI)
   - repairing -> stuck (repair worker fails/dies)

3. **`verifying`** -- transitions to test:
   - verifying -> done (merge commit CI passes)
   - verifying -> verify-failed (merge commit CI fails)
   - verifying with stale CI (no merge commit CI status yet, stays in verifying)

4. **`verify-failed`** -- transitions to test:
   - verify-failed -> repairing-main (launch verifier worker)
   - verify-failed -> stuck (max verify retries exhausted)

5. **`repairing-main`** -- transitions to test:
   - repairing-main -> verifying (verifier pushes fix, transition back to verify)
   - repairing-main -> stuck (verifier fails)

6. **`merging` error path** -- transitions to test:
   - merging -> stuck (PR closed without merging -- from H-ER-4)
   - merging stays in merging (PR still open, merge in progress)

Each test should use the existing `makeWorkItem` + `mockDeps` + `processTransitions` pattern from the exhaustive section.

**Test plan:**
- Each of the 6 state groups has at least 2 transition tests (happy path + error path)
- Tests use the same patterns as existing exhaustive tests (makeWorkItem, mockDeps, emptySnapshot)
- Verify all new tests pass
- Verify existing tests are not affected
- Run `bun test test/` to confirm no regressions

Acceptance: All 6 states have transition tests in the exhaustive section. At least 15 new test cases added. All tests pass. `bun test test/` passes.

Key files: `test/orchestrator.test.ts`
