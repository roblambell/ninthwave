# Refactor: Migrate vi.mock test files to dependency injection (L-ER-4)

**Priority:** Low
**Source:** Engineering review R6-F1, R7-D8
**Depends on:** M-ER-5, M-ER-3
**Domain:** test

Migrate 4 test files from `vi.mock` to dependency injection, eliminating cross-file mock leakage risk. The CLAUDE.md convention says: "Prefer dependency injection over vi.mock. Only use vi.mock when the mocked module is not imported by any other test file."

**Production code changes** (add DI interfaces):

1. **`core/commands/clean.ts`** (~20 LOC): Add a `CleanDeps` interface with functions currently imported from `git.ts` and `gh.ts`: `isBranchMerged`, `removeWorktree`, `deleteBranch`, `deleteRemoteBranch`. Add an optional `deps` parameter to `cmdClean` and `cleanSingleWorktree` with sensible defaults.

2. **`core/commands/launch.ts`** (~30 LOC): Add a `LaunchGitDeps` interface with functions from `git.ts`: `branchExists`, `createWorktree`, `attachWorktree`, `worktreeExists`, `deleteBranch`. Add an optional `deps` parameter to `launchSingleItem` with sensible defaults.

3. **`core/commands/pr-monitor.ts`** (~20 LOC): Add a `PrMonitorDeps` interface with functions from `gh.ts`: `prList`, `prView`, `prChecks` (and async variants). Add an optional `deps` parameter to `checkPrStatus` and `checkPrStatusAsync` with sensible defaults.

**Test code changes** (replace vi.mock with DI):

4. **`test/clean.test.ts`** (~15 LOC): Remove `vi.mock("../core/git.ts")` and `vi.mock("../core/gh.ts")`. Pass mock deps via the new `CleanDeps` parameter instead.

5. **`test/launch.test.ts`** (~15 LOC): Remove `vi.mock("../core/git.ts")`. Pass mock deps via `LaunchGitDeps` parameter.

6. **`test/ci.test.ts`** (~10 LOC): Remove `vi.mock("../core/gh.ts")`. Pass mock deps via `PrMonitorDeps` or inline the gh function mock.

7. **`test/watch.test.ts`** (~15 LOC): Remove `vi.mock("../core/gh.ts")`. Pass mock deps via `PrMonitorDeps`.

After migration, remove the `// lint-ignore: no-leaked-mock` suppressions added in L-ER-3.

**Test plan:**
- Verify `git.test.ts` no longer has mock leakage from other files (the leak documentation comment at lines 5-11 becomes unnecessary)
- Verify `gh.test.ts` no longer has mock leakage
- Run tests in different file orders to verify no order-dependent failures
- Verify all 4 migrated test files pass with DI mocks
- Run `bun test test/` to confirm no regressions

Acceptance: All 4 test files use DI instead of `vi.mock`. Production interfaces are added with default implementations. No `vi.mock` calls for `git.ts` or `gh.ts` remain. `bun test test/` passes regardless of file execution order.

Key files: `core/commands/clean.ts`, `core/commands/launch.ts`, `core/commands/pr-monitor.ts`, `test/clean.test.ts`, `test/launch.test.ts`, `test/ci.test.ts`, `test/watch.test.ts`
