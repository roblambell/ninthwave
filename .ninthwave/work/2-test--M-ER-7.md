# Test: Crash recovery integration test (M-ER-7)

**Priority:** Medium
**Source:** Engineering review R6-F3, R7-D5
**Depends on:** H-ER-3
**Domain:** test

Add a crash recovery round-trip integration test to `test/daemon-integration.test.ts`. The existing "state persistence" test (scenario 8) tests `serializeOrchestratorState` and `writeStateFile`/`readStateFile` individually, but does not test the full round-trip through a simulated daemon restart.

Write a test that:
1. Creates an Orchestrator with 5 items in various WIP states (`launching`, `implementing`, `ci-pending`, `reviewing`, `merging`)
2. Sets fields that are now persisted after H-ER-3: `workspaceRef`, `partition`, `resolvedRepoRoot`, plus existing fields like `prNumber`, `ciFailCount`, `retryCount`
3. Serializes via `serializeOrchestratorState()` and writes via `writeStateFile()`
4. Creates a fresh Orchestrator (simulating daemon restart)
5. Reads via `readStateFile()` and hydrates items via `hydrateState()` (or `setState`)
6. Verifies ALL non-transient fields survived the round-trip for each item
7. Verifies transient fields (`notAliveCount`, `lastAliveAt`, `lastScreenOutput`) are NOT present (intentionally omitted)

This test directly catches the OrchestratorItem/DaemonStateItem divergence identified in R1-F1 -- if a new field is added to OrchestratorItem but forgotten in serialization, this test will fail.

**Test plan:**
- Test covers items in 5 different WIP states
- Verify all serialized fields survive round-trip (workspaceRef, partition, resolvedRepoRoot, prNumber, etc.)
- Verify transient fields are absent after deserialization
- Verify the test catches a simulated regression (temporarily omit a field from serialization, confirm test fails)

Acceptance: Crash recovery round-trip test exists and passes. The test verifies at least 10 fields survive serialization for items in various states. `bun test test/` passes.

Key files: `test/daemon-integration.test.ts`, `core/daemon.ts`
