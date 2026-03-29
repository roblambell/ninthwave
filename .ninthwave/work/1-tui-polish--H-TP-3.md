# Refactor: Async snapshot operations (H-TP-3)

**Priority:** High
**Source:** TUI responsiveness investigation 2026-03-29
**Depends on:** H-TP-2
**Domain:** tui-polish

Three operations inside `buildSnapshotAsync` still use synchronous subprocess calls (`Bun.spawnSync`) that block the event loop during poll cycles. Create async variants and wire them in.

1. **getWorktreeLastCommitTimeAsync** in `core/commands/orchestrate.ts`: Use `runAsync("git", ["log", ...])` instead of sync `run()`. Update `buildSnapshotAsync`'s `getLastCommitTime` parameter default to use the async variant. The parameter type becomes `(projectRoot: string, branchName: string) => string | null | Promise<string | null>` and the call site (line 833) must be awaited.

2. **fetchTrustedPrCommentsAsync** in `core/gh.ts`: Use `ghInRepoAsync` for both API calls (issue comments + review comments) instead of sync `apiGet`/`ghInRepo`. Update `buildSnapshotAsync`'s `fetchComments` parameter type to allow `Promise` return. Await the call at line 851. Update the injection site at line 3674 to pass the async variant.

3. **checkCommitCIAsync** in `core/gh.ts`: Use `ghInRepoAsync` instead of sync `ghInRepo`. Copy the same parsing logic (filter ignored checks, determine pass/fail/pending). Update `buildSnapshotAsync`'s `checkCommitCI` parameter type to allow `Promise` return. Await the call at line 735. Update the injection site at line 3674 to pass the async variant.

Keep the original sync functions unchanged for use by sync `buildSnapshot` and other callers.

**Test plan:**
- Verify existing `test/async-snapshot.test.ts` tests pass (they inject stubs for these parameters)
- Add unit test for `getWorktreeLastCommitTimeAsync` verifying it returns the same results as the sync version
- Verify `fetchTrustedPrCommentsAsync` and `checkCommitCIAsync` signatures match their sync counterparts (return type wrapped in Promise)

Acceptance: `buildSnapshotAsync` makes zero synchronous subprocess calls -- all `Bun.spawnSync` calls are replaced with async `Bun.spawn` equivalents. TUI keyboard input remains responsive during poll cycles. All existing tests pass.

Key files: `core/commands/orchestrate.ts:699`, `core/commands/orchestrate.ts:833`, `core/gh.ts:442`, `core/gh.ts:312`, `core/commands/orchestrate.ts:3674`
