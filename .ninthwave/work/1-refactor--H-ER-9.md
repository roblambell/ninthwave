# Refactor: Decompose orchestrate.ts (H-ER-9)

**Priority:** High
**Source:** Engineering review R5-F8, R7-R1
**Depends on:** H-ER-6, H-TP-3
**Domain:** refactor

Extract six subsystems from `core/commands/orchestrate.ts` (3,890 LOC) into separate files, reducing it to ~2,200 LOC. Each extraction has clear boundaries and no circular dependencies with the core loop.

1. **Snapshot building (~400 LOC) -> `core/snapshot.ts`**: Extract `buildSnapshot()`, `buildSnapshotAsync()`, `isWorkerAlive()`, `isWorkerAliveWithCache()`, and their helper functions. Export them for use by the main loop. The snapshot functions take injected dependencies (mux, gh functions) -- preserve this pattern.

2. **State reconstruction (~300 LOC) -> `core/reconstruct.ts`**: Extract `reconstructState()` and its helper functions. This reads state from disk (PR status, daemon state file, verdict files) and reconstructs `OrchestratorItem[]`.

3. **Arg parsing (~250 LOC) -> `core/commands/watch-args.ts`**: Extract `parseWatchArgs()` and related arg parsing logic. This is a pure function that takes argv and returns a typed config object.

4. **TUI keyboard handling (~200 LOC) -> `core/tui-keyboard.ts`**: Extract `setupKeyboardShortcuts()` and the keyboard event handler. This sets up stdin listeners and dispatches to TUI state mutations.

5. **External review processing (~100 LOC) -> `core/external-review.ts`**: Extract `processExternalReviews()` and its helper functions. This scans for non-ninthwave PRs and manages the review queue.

6. **forkDaemon (~30 LOC) -> move to `core/daemon.ts`**: Move `forkDaemon()` to `daemon.ts` alongside the PID file management, since they are cohesive concerns.

After extraction, `orchestrate.ts` retains: `orchestrateLoop()` (core poll-transition-execute loop), `cmdOrchestrate()` (entry point), action dispatcher, dependency wiring, and `onPollComplete` callbacks.

**Test plan:**
- Verify all existing tests in `test/orchestrate.test.ts` pass without modification (imports may change but behavior is identical)
- Verify `test/async-snapshot.test.ts` and `test/contract/build-snapshot.test.ts` pass
- Verify `test/daemon.test.ts` passes (forkDaemon moved to daemon.ts)
- Check that circular imports don't exist (extracted modules should not import from orchestrate.ts)
- Run `bun test test/` to confirm no regressions

Acceptance: `orchestrate.ts` is under 2,500 LOC. Six subsystems are in their own files. All imports are updated. No circular dependencies. `bun test test/` passes.

Key files: `core/commands/orchestrate.ts`, `core/snapshot.ts` (new), `core/reconstruct.ts` (new), `core/commands/watch-args.ts` (new), `core/tui-keyboard.ts` (new), `core/external-review.ts` (new), `core/daemon.ts`
