# Refactor: Cache listWorkspaces per snapshot build (H-TP-2)

**Priority:** High
**Source:** TUI responsiveness investigation 2026-03-29
**Depends on:** None
**Domain:** tui-polish

`isWorkerAlive()` calls `mux.listWorkspaces()` (which runs synchronous `cmux list-workspaces` via `Bun.spawnSync`) for every active item in `buildSnapshotAsync`. With 5 active workers, that is 5 identical subprocess calls per poll cycle, each blocking the event loop.

Add `isWorkerAliveWithCache(item: OrchestratorItem, workspaceListing: string): boolean` that accepts a pre-fetched workspace listing string instead of calling `mux.listWorkspaces()` each time. Keep the original `isWorkerAlive(item, mux)` as a thin wrapper that calls `isWorkerAliveWithCache(item, mux.listWorkspaces())` for backward compatibility with callers outside snapshot builds.

In both `buildSnapshot` and `buildSnapshotAsync`, call `mux.listWorkspaces()` once at the top of the function and store the result. Replace all 4 per-item `isWorkerAlive(item, mux)` call sites in each function (reviewing, repairing, repairing-main, launching/implementing/ci-failed) with `isWorkerAliveWithCache(item, cachedWorkspaces)`.

**Test plan:**
- Add unit tests for `isWorkerAliveWithCache` covering: matching workspace ref, matching item ID, no match, empty listing
- Verify existing `isWorkerAlive` tests in `test/orchestrate.test.ts` still pass (original function is preserved as wrapper)
- Verify existing `buildSnapshotAsync` tests in `test/async-snapshot.test.ts` still pass (fakeMux returns "" from listWorkspaces)

Acceptance: `mux.listWorkspaces()` is called exactly once per snapshot build instead of N times. `isWorkerAlive` still works for callers outside snapshot builds. All existing tests pass.

Key files: `core/commands/orchestrate.ts:866`, `core/commands/orchestrate.ts:629`, `core/commands/orchestrate.ts:642`, `core/commands/orchestrate.ts:650`, `core/commands/orchestrate.ts:658`
