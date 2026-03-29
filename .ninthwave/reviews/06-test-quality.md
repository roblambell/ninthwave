# Review 6: Test Quality & Coverage Audit

## Summary

The test suite comprises **55,344 LOC** across 82 test files in `test/`, plus 3,540 LOC in `test/scenario/`, 1,970 LOC in `test/contract/` and `test/smoke/`, 608 LOC in `test/fakes/`, and 377 LOC in `test/golden/`. Total test infrastructure: **~61,839 LOC**. This is roughly 2.3x the 27,210 LOC of production code -- a healthy ratio for an orchestration system where state machine correctness is critical.

The test suite has several structural strengths: (1) the core state machine (`orchestrator.test.ts`, 6,626 LOC) has exhaustive transition coverage for 11 of 19 states with deep scenario tests, (2) dependency injection is used pervasively (the `OrchestratorDeps` interface enables full lifecycle testing without vi.mock), (3) the lint-tests scanner auto-enforces dangerous patterns, and (4) scenario tests provide end-to-end coverage for complex multi-step flows.

The most significant gaps are: (1) **8 states missing from the exhaustive transition section** (`bootstrapping`, `repairing`, `reviewing` (partially covered elsewhere), `verifying`, `verify-failed`, `repairing-main`, `done`, `stuck` -- the last two are covered as terminal states but not as source states for recovery), (2) **5 production modules with no dedicated test file** (`send-message.ts`, `work-item-utils.ts`, `schedule-state.ts`, `pr-monitor.ts`, `repos.ts`), (3) **5 test files using vi.mock** that risk cross-file leak (the CLAUDE.md convention explicitly warns against this), and (4) **no crash recovery integration tests** for the daemon state persistence round-trip.

Cross-reference: Review 2 identified 19 states but ARCHITECTURE.md only documents 16. This review confirms the test gap: the 3 undocumented states (`repairing`, `verify-failed`, `repairing-main`) are tested in `verify-main.test.ts` and `contract/build-snapshot.test.ts` but not in the exhaustive transition matrix. Review 5 identified crew mode (1,346 LOC) and scheduling (1,251 LOC) as STRIP candidates; their test files total **~3,223 LOC** of removable test code.

## Findings

### 1. vi.mock inventory: 5 files with cross-leak risk -- SEVERITY: high
**Tag:** SIMPLIFY

The CLAUDE.md convention states: "Prefer dependency injection over `vi.mock`. Only use `vi.mock` when the mocked module is not imported by any other test file." Five test files violate this:

| File | Mocked Module(s) | LOC | Cross-Leak Risk |
|------|------------------|-----|-----------------|
| `clean.test.ts` | `../core/git.ts`, `../core/gh.ts` | 633 | **High** -- `git.ts` is imported by 10+ test files; `gh.ts` by 5+. `git.test.ts` already documents this leak (line 5-11). |
| `launch.test.ts` | `../core/git.ts` | 1,816 | **High** -- same `git.ts` mock as `clean.test.ts`. NOTE: comment at line 28-30 acknowledges leakage to `git.test.ts`. |
| `ci.test.ts` | `../core/gh.ts` | 144 | **Medium** -- `gh.ts` mock shared with `clean.test.ts` and `watch.test.ts`. |
| `watch.test.ts` | `../core/gh.ts` | 907 | **Medium** -- same `gh.ts` mock as `ci.test.ts`. |
| `mux.test.ts` | `../core/cmux.ts` | 215 | **Low** -- `cmux.ts` is only directly imported by `cmux.test.ts` and `mux.test.ts`. |

**How the leak manifests:** Bun's test runner does not isolate `vi.mock` between files. When `clean.test.ts` mocks `../core/git.ts`, that mock persists for any file loaded in the same test process. If `git.test.ts` imports `../core/git.ts` (which it does), it may receive the mock instead of the real module. The `git.test.ts` file works around this by using `run()` from `shell.ts` to call git directly (line 5-11 comment), but this is a fragile workaround.

**Ordering sensitivity:** The `bun test` execution order determines which mock wins. Changing file names (alphabetical ordering) or adding new test files can cause existing tests to break by altering mock load order.

**Migration assessment per file:**

| File | Migration Path | Effort | Priority |
|------|---------------|--------|----------|
| `clean.test.ts` | `cmdClean` already accepts a `Multiplexer` parameter. `git.ts` functions (`isBranchMerged`, `removeWorktree`, `deleteBranch`, `deleteRemoteBranch`) are called inside `cleanSingleWorktree` and `cmdClean`. These need a `GitDeps` injection parameter, similar to how `OrchestratorDeps` works. | ~40 LOC (add `GitDeps` interface + parameter threading) | High |
| `launch.test.ts` | `launchSingleItem` calls `git.ts` functions deeply in its implementation. Full DI would require threading a `GitDeps` through `launchSingleItem` → `createWorktree`/`branchExists`/etc. Alternatively, extract the branch management into a function with injectable deps (as recommended in Review 3 Finding 8). | ~60 LOC | High |
| `ci.test.ts` | `cmdCiFailures` calls `gh.prChecks()` directly. Needs a `GhDeps` parameter with `prChecks` function. | ~15 LOC | Medium |
| `watch.test.ts` | `checkPrStatus` and friends call multiple `gh.ts` functions. The `pr-monitor.ts` module would need a `PrMonitorDeps` interface. | ~40 LOC | Medium |
| `mux.test.ts` | `CmuxAdapter` delegates to `cmux.ts`. The mock is necessary because the test verifies delegation behavior. The alternative is to test `cmux.ts` functions directly (which `cmux.test.ts` does). | ~0 LOC (consider removing `mux.test.ts` CmuxAdapter tests if `cmux.test.ts` covers the same behavior) | Low |

**Total migration effort:** ~155 LOC of interface additions and parameter threading.

### 2. State machine test completeness: 11 of 19 states in exhaustive section -- SEVERITY: high
**Tag:** SIMPLIFY

The "Exhaustive state transitions" section in `orchestrator.test.ts` (lines 1835-2742) covers these source states:

| State | In Exhaustive Section? | Tested Elsewhere? | Notes |
|-------|----------------------|-------------------|-------|
| `queued` | Yes | -- | Covers: stays queued with unmet deps, promotes to ready |
| `ready` | Yes | -- | Covers: launches when WIP available, stays ready when WIP full |
| `launching` | Yes | -- | Covers: alive -> implementing, dead -> stuck/retry |
| `implementing` | Yes | -- | Covers: PR detected -> pr-open, activity timeout -> stuck |
| `pr-open` | Yes | -- | Covers: CI pass/fail/pending transitions |
| `ci-pending` | Yes | -- | Covers: pass -> ci-passed, fail -> ci-failed |
| `ci-passed` | Yes | -- | Covers: merge (auto/manual strategies), review gate |
| `ci-failed` | Yes | -- | Covers: retry -> ci-pending, max retries -> stuck |
| `review-pending` | Yes | -- | Covers: human approve, CI regression, PR merge |
| `merging` | Yes | -- | Covers: PR merged -> merged |
| `merged` | Yes | -- | Covers: -> verifying (if enabled), -> done |
| `bootstrapping` | **No** | No | **GAP:** No transition tests from bootstrapping state |
| `repairing` | **No** | `contract/build-snapshot.test.ts` | Snapshot building only, no transition tests |
| `reviewing` | **No** (not in exhaustive) | `orchestrator.test.ts` lines 5566-6330 | Covered in separate "Review state transitions" section -- thorough |
| `verifying` | **No** | `verify-main.test.ts` | Good coverage of verifying -> done, verifying -> verify-failed |
| `verify-failed` | **No** | `verify-main.test.ts` | Covers: retry -> repairing-main, max retries -> stuck |
| `repairing-main` | **No** | `verify-main.test.ts` | Covers: CI detected -> ci-pending (via transition) |
| `done` | Yes (terminal) | -- | Terminal -- no outgoing transitions |
| `stuck` | Yes (terminal) | -- | Terminal -- no outgoing transitions |

**Missing transition edges (not tested anywhere):**

1. `bootstrapping` -> `launching` (bootstrap complete)
2. `bootstrapping` -> `stuck` (bootstrap failure, max retries)
3. `repairing` -> `ci-pending` (repair worker pushes fix, CI restarts)
4. `repairing` -> `stuck` (repair worker fails)
5. `merging` -> `stuck` (PR closed without merging -- Review 2 Finding 11 noted this is unhandled in code)
6. `launching` -> `bootstrapping` (cross-repo item needs bootstrap -- if this transition exists)

**Error path gaps:**

The exhaustive section tests the "happy path" transitions well but has gaps in error recovery:
- **Max retries exhausted**: Tested for `ci-failed` (lines 2408+) but not for `launching` or `implementing` retry paths
- **Timeout hierarchy**: Heartbeat timeout is tested (lines 3827+) but the three-layer hierarchy (heartbeat -> liveness -> commit) is not tested as a cascading sequence
- **Stacked dep failure**: Tested in scenario tests (lines 4902+) but not in the exhaustive section

**Recommendation:** Add the 8 missing states to the exhaustive transition section. Priority: `bootstrapping` (cross-repo path), `repairing`/`repairing-main` (critical recovery paths), then `merging` error handling. Estimated effort: ~200 LOC.

### 3. Integration test gaps: no crash recovery round-trip -- SEVERITY: high
**Tag:** SIMPLIFY

`daemon-integration.test.ts` (982 LOC) covers 9 lifecycle scenarios:
1. Startup and shutdown
2. Single-item flow
3. Stuck item and retry logic
4. Stacking (dependent items)
5. Stuck dependency notification
6. Cleanup after merge
7. Multi-item orchestration
8. State persistence (serialize + deserialize)
9. Launch failure handling

**Missing integration scenarios:**

1. **Crash recovery round-trip**: Serialize state -> simulate crash (clear in-memory state) -> deserialize -> verify items resume from correct states. The "state persistence" test (scenario 8) tests `serializeOrchestratorState` and `writeStateFile`/`readStateFile` individually, but does not test the full round-trip through a simulated daemon restart. This is the highest-risk gap because Review 1 Finding 1 identified `OrchestratorItem`/`DaemonStateItem` divergence as the #1 correctness risk.

2. **Multi-cycle state transitions**: Tests use single `processTransitions` calls per step. A test that calls `processTransitions` in a loop (like the real daemon loop) with evolving snapshots would catch ordering bugs and flag management issues that single-call tests miss.

3. **Concurrent merge + launch in same cycle**: Review 2 Finding 4 noted that items can transition through `queued -> ready -> launching` in a single cycle. No integration test verifies this fast-path behavior with the WIP limit correctly enforced.

4. **Review worker lifecycle**: No integration test covers the full `ci-passed -> reviewing -> ci-passed (approved) -> merging` flow end-to-end. The review transitions are tested in `orchestrator.test.ts` but not as a multi-step integration sequence.

5. **Cross-repo bootstrap lifecycle**: `bootstrapping` -> `launching` -> `implementing` -> merge is not tested end-to-end.

**Recommendation:** Add crash recovery round-trip as the highest-priority integration test. Estimated effort: ~60 LOC (serialize state with 3-5 items in various states, clear orchestrator, deserialize, verify all items resume correctly).

### 4. Missing production module test files -- SEVERITY: medium
**Tag:** SIMPLIFY

Five production modules have no dedicated test file:

| Module | LOC | Risk Level | Notes |
|--------|-----|------------|-------|
| `core/send-message.ts` | ~142 | **High** | Message delivery is a critical path. `sendMessageImpl` -> `sendWithRetry` -> `attemptSend` -> `verifyDelivery` has complex fallback logic. Review 3 Finding 4 identified "silent success" bug here. Currently tested indirectly via orchestrator deps mocks. |
| `core/commands/pr-monitor.ts` | 675 | **High** | Core polling function. `checkPrStatus` and `checkPrStatusAsync` are tested indirectly in `watch.test.ts` (via vi.mock of `gh.ts`), but the sync/async code duplication (Review 4 Finding 10) means bugs in one path may not be caught. |
| `core/work-item-utils.ts` | 290 | **Medium** | Utility functions for work item manipulation. `extractBody`, `expandWildcardDeps`, `prTitleMatchesWorkItem` are tested indirectly via `parser.test.ts` and `work-item-files.test.ts`. `prTitleMatchesWorkItem` is tested in `merge-detection.test.ts`. Not a gap per se, but no single test file owns coverage. |
| `core/schedule-state.ts` | 108 | **Low** | Schedule state persistence. Moot if scheduling is stripped (Review 5). |
| `core/commands/repos.ts` | ~50 | **Low** | Simple `nw repos` command. Low-risk utility. |

**Recommendation:** Add test files for `send-message.ts` and `pr-monitor.ts` (direct tests, not via vi.mock). `work-item-utils.ts` is adequately covered via its consumers. `schedule-state.ts` and `repos.ts` are low-priority.

### 5. Test isolation: vi.mock leak documentation is ad-hoc -- SEVERITY: medium
**Tag:** SIMPLIFY

The `git.test.ts` file (line 5-11) contains a manual comment documenting the mock leak:

```typescript
// Mock leakage note: clean.test.ts and start.test.ts vi.mock("../core/git.ts"),
```

This is the only documentation of the mock leak problem in the test suite. Other test files that mock `gh.ts` (`ci.test.ts`, `watch.test.ts`, `clean.test.ts`) do not document the cross-leak risk. The comment at `clean.test.ts` line 9 says "Only mock modules that don't have their own test files" -- but `git.ts` and `gh.ts` both have their own test files, contradicting this comment.

**Known flake risk:** If `bun test` changes file ordering (e.g., due to a new test file being added), the mock execution order changes. This can cause intermittent test failures that are difficult to diagnose. No existing flake history was found, but the risk increases as more test files are added.

**Recommendation:** Two-phase fix:
1. (Immediate) Add a lint rule to `lint-tests.test.ts` that flags `vi.mock` calls for modules that have their own test file. Rule: `no-leaked-mock` -- detects `vi.mock("../core/X.ts")` when `test/X.test.ts` exists. This prevents new violations. ~30 LOC.
2. (Follow-up) Migrate existing vi.mock files to DI (per Finding 1 migration plan). This eliminates the leak source.

### 6. Lint rule completeness: 4 missing patterns -- SEVERITY: medium
**Tag:** SIMPLIFY

`lint-tests.test.ts` currently has 7 rules:
1. `no-leaked-server` -- Bun.serve without cleanup
2. `no-uncleared-interval` -- setInterval without clear
3. `no-long-timeout` -- setTimeout > 30s
4. `no-unreset-globals` -- globalThis override without restore
5. `no-unrestored-process-exit` -- process.exit override without restore
6. `no-unbounded-orchestrate-loop` -- orchestrateLoop without maxIterations
7. `no-em-dash` -- em dash in project files

**Missing patterns that should be caught:**

1. **`no-describe-skip` / `no-it-skip`**: `describe.skip` and `it.skip` left in code disable tests silently. Currently zero instances found (good!), but no rule prevents future additions. A single skipped test in a critical path (e.g., the exhaustive state transitions) could mask a regression. ~15 LOC.

2. **`no-leaked-mock`**: `vi.mock("../core/X.ts")` where `test/X.test.ts` exists. Prevents the cross-leak documented in Finding 1. ~25 LOC.

3. **`no-fs-writes-outside-tmp`**: Tests that write to non-tmp paths (e.g., `writeFileSync("/absolute/path/...")` where path doesn't start with `os.tmpdir()` or a known fixture dir) can pollute the filesystem. The `setupTempRepo` helper mitigates this for most tests, but direct `writeFileSync` calls outside temp dirs would not be caught. ~20 LOC. Lower priority -- most tests use the helper correctly.

4. **`no-hardcoded-timeout-values`**: Magic timeout numbers in tests (e.g., `setTimeout(() => {}, 5000)` or `{ timeout: 10000 }`) should use named constants for consistency. Currently the `no-long-timeout` rule catches > 30s, but shorter hardcoded timeouts are also fragile. ~15 LOC. Lowest priority.

**Recommendation:** Add `no-describe-skip` and `no-leaked-mock` rules. These have the highest value-to-effort ratio. The filesystem write rule is nice-to-have. The timeout constant rule is low priority.

### 7. Fixture quality: adequate but missing edge cases -- SEVERITY: low
**Tag:** KEEP

Test fixtures in `test/fixtures/`:

| Fixture | Purpose | Quality |
|---------|---------|---------|
| `valid.md` | Happy path: 4 items, 2 sections, dependencies | Good. Covers cross-section deps and bundle-with. |
| `cross_repo.md` | Cross-repo items with `Repo:` field | Good. Covers multi-repo with deps across repos. |
| `circular_deps.md` | Circular dependency detection | Good. Tests A -> B -> C -> A cycle. |
| `duplicate_ids.md` | Duplicate ID handling | Good. Two items with same ID in different sections. |
| `empty.md` | Empty/minimal input | Good. Tests parser with no items. |
| `malformed.md` | Malformed metadata | Good. Tests parser error recovery. |
| `multi_section.md` | Multiple sections | Good. Tests section-to-domain mapping. |

**Missing fixture edge cases:**

1. **Stacked items with `baseBranch`**: No fixture tests items with explicit `baseBranch` metadata. The stacking logic is tested in `orchestrator.test.ts` via programmatic item creation, but the parser's handling of stacked-specific metadata is not fixture-tested.

2. **Items with Bootstrap metadata**: `Bootstrap: true` is parsed in `work-item-files.ts` but no fixture includes it. Review 1 Finding 13 noted `extractBody` doesn't strip `Bootstrap:` from metadata prefixes.

3. **Items with wildcard dependencies**: `expandWildcardDeps` supports patterns like `MUX-*`, but no fixture tests this via the parser round-trip.

4. **Very long item content**: No fixture tests items with large body text (multiple paragraphs, code blocks, nested lists). The parser should handle these, and likely does, but boundary behavior is untested.

**Recommendation:** Keep existing fixtures. Add a `stacked.md` and `bootstrap.md` fixture if the parser is modified. The existing programmatic tests in `work-item-files.test.ts` are more flexible than fixtures for edge case testing. Low priority.

### 8. Test infrastructure quality: well-designed with minor issues -- SEVERITY: low
**Tag:** KEEP

**`setup-global.ts` (54 LOC):**
- 90-second global timeout + 1GB memory watchdog. Sound design.
- Uses `process.kill(process.pid, "SIGKILL")` to bypass mocked `process.exit`. Clever and necessary.
- Timer is `.unref()`'d so it doesn't keep the process alive. Correct.
- Sets `__nw_test_safety_loaded` sentinel for verification. Good practice.
- **Issue:** The `MEMORY_CHECK_INTERVAL_MS = 5_000` creates 12 checks per minute. Each `process.memoryUsage.rss()` call is cheap (~1us), so this is fine. No issue.

**`helpers.ts` (314 LOC):**
- `setupTempRepo`, `setupTempRepoPair`, `setupTempRepoWithRemote`: Three repo setup variants, each well-documented. Clean temp dir tracking with `tempDirs` array.
- `useFixtureDir`, `writeWorkItemFiles`: Convert multi-item markdown into individual work item files. The parsing logic duplicates some of `work-item-files.ts` (section heading detection, priority parsing). This is intentional -- the helper creates files that `work-item-files.ts` then reads back, testing the full round-trip.
- `registerCleanup`: Registers `afterEach` cleanup. Only used in 1 test file (`git.test.ts`). Other files call `cleanupTempRepos()` directly in `afterEach`. The two patterns are equivalent, but `registerCleanup` is slightly cleaner. Minor inconsistency.
- **All helpers are used.** No dead exports. `setupTempRepoPair` is used by `bootstrap.test.ts`. `setupTempRepoWithRemote` is used by `reconcile.test.ts`. All 7 exports are imported by at least one test file.

**`test/fakes/` (608 LOC):**
- `fake-github.ts` (168 LOC): Mock GitHub API responses for contract tests. Good typing.
- `fake-mux.ts` (128 LOC): Mock multiplexer with configurable behavior. Good alternative to vi.mock.
- `fake-worker.ts` (128 LOC): Mock worker lifecycle for scenario tests.
- `fake-worker.test.ts` (184 LOC): Tests for the fakes themselves. Good practice -- ensures test infrastructure is itself tested.

**`test/scenario/` (3,540 LOC):**
- 7 scenario test files covering complex multi-step flows (CI failure recovery, crew coordination, dependency chains, full lifecycle, stacking, stuck detection, watch mode).
- `helpers.ts` (106 LOC) provides scenario-specific utilities.
- Scenarios use the fake infrastructure from `test/fakes/` rather than vi.mock. Good pattern.

**`test/golden/` (377 LOC + golden files):**
- `status-table.test.ts` tests TUI output against golden files (20 `.expected` files).
- Tests cover multiple terminal widths (80, 120) and states (empty, queued, mixed, stuck, done).
- Update mechanism: `UPDATE_GOLDEN=1 bun test test/golden/` rewrites expected files.
- Good approach for visual regression testing.

**`test/contract/` (1,970 LOC):**
- `build-snapshot.test.ts` (large): Comprehensive snapshot building tests including repairing/verifying states.
- `gh-pr-checks.test.ts`, `gh-pr-status.test.ts`: Contract tests for GitHub API integration.
- These test the contract between the orchestrator and external systems.

**`test/smoke/` (3 files):**
- `init.test.ts`, `list.test.ts`, `status.test.ts`: CLI smoke tests that run actual `bun run core/cli.ts` commands.
- Integration-level tests that verify end-to-end CLI behavior.

## Production Module to Test Coverage Mapping

| Production Module | LOC | Test File(s) | Coverage Level | Notes |
|------------------|-----|-------------|----------------|-------|
| `core/orchestrator.ts` | 2,674 | `orchestrator.test.ts` (6,626), `orchestrator-unit.test.ts` (3,860), `daemon-integration.test.ts` (982), `scenario/*.test.ts` (~3,540) | **Thorough** | 11/19 states in exhaustive section; remainder covered in verify-main.test.ts and review section |
| `core/commands/orchestrate.ts` | 3,890 | `orchestrate.test.ts` (4,666), `contract/build-snapshot.test.ts` | **Good** | Loop, snapshot, reconstruct tested. TUI keyboard/rendering less covered. |
| `core/daemon.ts` | 711 | `daemon.test.ts` (775), `daemon-integration.test.ts` (982) | **Good** | State serialization, PID management, heartbeat. Missing: crash recovery round-trip. |
| `core/status-render.ts` | 2,113 | `status-render.test.ts` (3,058), `golden/status-table.test.ts` (377) | **Thorough** | Golden file tests + unit tests for rendering functions. |
| `core/commands/launch.ts` | 1,271 | `launch.test.ts` (1,816) | **Partial** | Uses vi.mock for git.ts. Branch management logic tested but mock leak risk. |
| `core/gh.ts` | 614 | `gh.test.ts` (666), `contract/gh-*.test.ts` (~700) | **Good** | Unit + contract tests. Mock leak from other files documented. |
| `core/git.ts` | 388 | `git.test.ts` (666) | **Partial** | Works around vi.mock leak by using `run()` directly. |
| `core/commands/pr-monitor.ts` | 675 | `watch.test.ts` (907) -- via vi.mock | **Partial** | No dedicated test file. Tested through mocked gh.ts calls. |
| `core/commands/clean.ts` | 321 | `clean.test.ts` (633) | **Good** | Uses vi.mock for git/gh but tests are comprehensive. |
| `core/commands/init.ts` | 942 | `init.test.ts` (2,175) | **Thorough** | Comprehensive initialization testing. |
| `core/commands/reconcile.ts` | 427 | `reconcile.test.ts` (797) | **Good** | Full DI, tests all reconcile phases. |
| `core/crew.ts` | 599 | `crew.test.ts` (617) | **Good** | WebSocket protocol testing. Moot if STRIP. |
| `core/mock-broker.ts` | 625 | `mock-broker.test.ts` (1,105) | **Thorough** | Moot if STRIP. |
| `core/schedule-eval.ts` | 262 | `schedule-eval.test.ts` (290) | **Good** | Cron expression evaluation. Moot if STRIP. |
| `core/schedule-files.ts` | 214 | `schedule-files.test.ts` (273) | **Good** | Moot if STRIP. |
| `core/schedule-runner.ts` | 317 | `schedule-runner.test.ts` (687) | **Good** | Moot if STRIP. |
| `core/schedule-history.ts` | 130 | `schedule-history.test.ts` (526) | **Thorough** | Moot if STRIP. |
| `core/schedule-state.ts` | 108 | None | **Uncovered** | Moot if STRIP. |
| `core/send-message.ts` | ~142 | None (indirect via orchestrator deps) | **Uncovered** | Critical path -- message delivery. |
| `core/work-item-files.ts` | 346 | `work-item-files.test.ts` (563) | **Good** | Parser round-trip testing. |
| `core/work-item-utils.ts` | 290 | None (indirect via parser/merge-detection tests) | **Partial** | Functions tested via consumers. |
| `core/parser.ts` | ~49 | `parser.test.ts` (1,267) | **Thorough** | Tests all fixture types. |
| `core/analytics.ts` | 448 | `analytics.test.ts` (1,910) | **Thorough** | Metric collection, cost parsing, latency stats. |
| `core/mux.ts` | 292 | `mux.test.ts` (215) | **Good** | Uses vi.mock for cmux.ts (low-risk). |
| `core/cmux.ts` | ~156 | `cmux.test.ts` | **Good** | Direct cmux command testing. |
| `core/delivery.ts` | 63 | `delivery.test.ts` | **Good** | Retry and verification logic. |
| `core/worker-health.ts` | ~270 | `worker-health.test.ts` (540) | **Good** | Screen-parsing heuristics tested with fixtures. |
| `core/partitions.ts` | 112 | `partitions.test.ts` | **Good** | Allocation and release. |
| `core/cross-repo.ts` | 429 | `cross-repo.test.ts` | **Good** | Resolution chain and bootstrap. |
| `core/lock.ts` | 119 | `lock.test.ts` | **Good** | Acquire, release, stale detection. |
| `core/tui-widgets.ts` | 590 | `tui-widgets.test.ts` (883) | **Good** | Widget rendering tests. |
| `core/commands/status.ts` | 531 | `status.test.ts` (1,695) | **Good** | Status display testing. |
| `core/commands/setup.ts` | 563 | `setup.test.ts` (796) | **Good** | Setup wizard testing. |
| `core/commands/repos.ts` | ~50 | None | **Uncovered** | Low-risk utility command. |
| `core/commands/schedule.ts` | 408 | `schedule-command.test.ts` (348) | **Partial** | Moot if STRIP. |
| `core/interactive.ts` | 449 | `interactive.test.ts` | **Good** | Interactive mode testing. |
| `core/templates.ts` | ~100 | `templates.test.ts` | **Good** | Template rendering. |
| `core/config.ts` | ~100 | `config.test.ts` | **Good** | Config parsing. |
| `core/paths.ts` | ~120 | `paths.test.ts` | **Good** | Path resolution. |
| `core/preflight.ts` | 230 | `preflight.test.ts` | **Good** | Environment validation. |
| `core/shell.ts` | 101 | `shell.test.ts` | **Good** | Shell execution. |
| `core/stack-comments.ts` | 86 | `stack-comments.test.ts` | **Good** | Clean DI-based tests. |

## Test LOC Removable if STRIP Features Are Removed

Cross-referencing Review 5's STRIP recommendations:

### Crew Mode Test LOC

| Test File | LOC | Notes |
|-----------|-----|-------|
| `test/crew.test.ts` | 617 | WebSocket crew broker tests |
| `test/crew-command.test.ts` | 283 | CLI `nw crew` command tests |
| `test/mock-broker.test.ts` | 1,105 | Mock WebSocket broker tests |
| `test/scenario/crew-coordination.test.ts` | ~420 (estimated from 13,066 bytes) | End-to-end crew scenario |
| **Crew total** | **~2,425** | |

### Scheduling Test LOC

| Test File | LOC | Notes |
|-----------|-----|-------|
| `test/schedule-runner.test.ts` | 687 | Runner lifecycle tests |
| `test/schedule-eval.test.ts` | 290 | Cron expression evaluation tests |
| `test/schedule-files.test.ts` | 273 | Schedule file parsing tests |
| `test/schedule-command.test.ts` | 348 | CLI `nw schedule` command tests |
| `test/schedule-tui.test.ts` | 94 | TUI display tests |
| `test/schedule-history.test.ts` | 526 | History persistence tests |
| **Scheduling total** | **~2,218** | |

### Combined Removable Test LOC

| Category | Test LOC | Production LOC (from Review 5) | Total |
|----------|----------|-------------------------------|-------|
| Crew mode | ~2,425 | ~1,346 | ~3,771 |
| Scheduling | ~2,218 | ~1,251 | ~3,469 |
| **Combined** | **~4,643** | **~2,597** | **~7,240** |

Stripping crew mode and scheduling would remove **~4,643 test LOC** (8.4% of total test LOC) and **~2,597 production LOC**, for a combined savings of **~7,240 LOC** (roughly 10% of the total codebase including tests).

## Theme A: Feature Necessity

### Tests for STRIP features

The crew and scheduling test suites are well-written and thorough. `mock-broker.test.ts` at 1,105 LOC is the most comprehensive test file for a module marked STRIP -- it tests WebSocket protocol details, reconnection, claim timeouts, and error handling. This is engineering effort invested in a feature with zero production users.

If crew mode is stripped, `crew.test.ts`, `crew-command.test.ts`, `mock-broker.test.ts`, and `scenario/crew-coordination.test.ts` are entirely removable.

If scheduling is stripped, all 6 `schedule-*.test.ts` files are entirely removable plus `schedule-state.ts` (the only untested schedule module) goes too.

### Tests for features that no longer exist

No test files were found for removed features. The test suite appears to track the current production code without orphaned tests.

### Unused test helpers

All 7 exports from `test/helpers.ts` are imported by at least one test file. No dead helper code.

The `captureOutput` function is duplicated across 6+ test files (`clean.test.ts`, `ci.test.ts`, `watch.test.ts`, `launch.test.ts`, etc.). Each copy is 15-20 LOC with identical logic (capture console.log/error + process.exit override). This should be extracted to `test/helpers.ts` as a shared utility. Estimated savings: ~80 LOC of duplication.

## Theme B: Complexity Reduction

### Are tests over-specified?

The orchestrator tests strike a good balance between behavior testing and implementation testing. Most tests verify state transitions (behavioral) rather than internal field values (implementation). The `makeWorkItem` + `mockDeps` pattern focuses tests on inputs and outputs.

**One over-specification pattern:** Several tests check specific `failureReason` strings (e.g., `expect(item.failureReason).toContain("worker-stalled")`). These are fragile -- a developer rewording an error message would break the test without changing behavior. However, `failureReason` is user-facing (shown in TUI and PR comments), so testing specific messages has value as a regression guard.

**Verdict:** Tests are appropriately specified. The `failureReason` string checks are a reasonable tradeoff between regression detection and maintenance burden.

### Test helper indirection

The test suite uses two helper patterns:
1. **`test/helpers.ts`**: Shared repo setup utilities (temp repos, fixtures, cleanup)
2. **Per-file helpers**: `makeWorkItem()`, `mockDeps()`, `emptySnapshot()`, `captureOutput()`

The per-file helpers are duplicated across `orchestrator.test.ts`, `orchestrator-unit.test.ts`, `orchestrate.test.ts`, and `daemon-integration.test.ts`. Each file has its own `makeWorkItem` with slight variations (different default priority, different fields). This duplication is intentional -- it keeps each test file self-contained and avoids coupling to a shared helper that might change.

**The `captureOutput` duplication is the exception.** It's identical across 6+ files and should be shared. The other per-file helpers are appropriately local.

### Can the 5 vi.mock files be simplified?

Yes. See Finding 1 for the migration plan. The key insight: modules that already have DI interfaces (`OrchestratorDeps`, `DaemonIO`, `ReconcileDeps`, `Multiplexer`) don't need vi.mock. Modules that call production functions directly (`cmdClean` -> `git.deleteBranch()`, `cmdCiFailures` -> `gh.prChecks()`) need DI interfaces added.

The pattern is consistent with the codebase's architectural direction (CLAUDE.md: "Prefer dependency injection over vi.mock"). The 5 vi.mock files are migration debt, not a design choice.

### Is the test infrastructure appropriately complex?

Yes. `setup-global.ts` (54 LOC) is minimal and addresses a real problem (test hangs from leaked resources). `lint-tests.test.ts` (705 LOC) is larger but justified -- it prevents an entire class of test infrastructure bugs. The lint rules run as part of the normal test suite, so they're auto-enforced.

The `test/fakes/` infrastructure (608 LOC) plus `test/scenario/` (3,540 LOC) is a significant investment but provides the highest-confidence testing (full lifecycle flows without mocks). The fake infrastructure is itself tested (`fake-worker.test.ts`), which is good practice.

**One simplification opportunity:** The `test/scenario/helpers.ts` (106 LOC) duplicates some functionality from `test/helpers.ts` (setupTempRepo, makeWorkItem). These could share a base, but since scenarios have different requirements (they use fakes, not temp repos), keeping them separate is reasonable.

## Recommendations

**Priority 1 (High -- test correctness):**
1. **Add crash recovery integration test** (Finding 3). Serialize state -> clear -> deserialize -> verify. Catches OrchestratorItem/DaemonStateItem divergence bugs identified in Review 1 Finding 1. ~60 LOC.
2. **Add exhaustive transitions for 6 missing states** (Finding 2). `bootstrapping`, `repairing`, `repairing-main`, `verifying`, `verify-failed`, and `merging` error path. ~200 LOC. (`reviewing` is already covered in separate section; `done`/`stuck` are terminal.)
3. **Add `send-message.ts` test file** (Finding 4). Direct tests for message delivery, verification, and the "silent success" bug (Review 3 Finding 4). ~80 LOC.

**Priority 2 (Medium -- test safety):**
4. **Add `no-leaked-mock` lint rule** (Finding 6). Prevents new vi.mock violations for modules with their own test files. ~25 LOC.
5. **Add `no-describe-skip` lint rule** (Finding 6). Prevents silently disabled tests. ~15 LOC.
6. **Migrate `clean.test.ts` and `launch.test.ts` off vi.mock** (Finding 1). These mock `git.ts` which is the highest cross-leak risk. ~100 LOC of DI interface additions.

**Priority 3 (Low -- code quality):**
7. **Extract `captureOutput` to `test/helpers.ts`** (Theme A). Remove ~80 LOC of duplication across 6+ files.
8. **Add `pr-monitor.ts` direct test file** (Finding 4). Currently only tested via vi.mock in `watch.test.ts`. ~100 LOC.
9. **Migrate `ci.test.ts` and `watch.test.ts` off vi.mock** (Finding 1). Lower risk than git.ts mocks. ~55 LOC of DI additions.

**If STRIP recommendations from Review 5 are implemented:**
10. **Remove crew test files** (Theme A). `crew.test.ts`, `crew-command.test.ts`, `mock-broker.test.ts`, `scenario/crew-coordination.test.ts`. ~2,425 LOC.
11. **Remove scheduling test files** (Theme A). All 6 `schedule-*.test.ts` files. ~2,218 LOC.

**Cross-references to Reviews 1-5:**
- **Review 1 Finding 1** (OrchestratorItem/DaemonStateItem divergence): Recommendation 1 above (crash recovery test) would catch divergence bugs at test time. The test should serialize an item in each WIP state and verify all fields survive the round-trip.
- **Review 2 Finding 2** (stuckOrRetry lastCommitTime): The exhaustive transition gap (Finding 2) means the retry path is not tested with commit timestamps. Adding retry tests would catch the stale-timeout bug.
- **Review 2 Finding 11** (handleMerging ignores closed PRs): The `merging` state exhaustive section only tests `merged` outcome, not `closed`. Adding this edge case would surface the missing code path.
- **Review 3 Finding 4** (silent delivery success): Recommendation 3 above (send-message.ts tests) would expose the verification gap for keystroke fallback.
- **Review 4 Finding 1** (GitHub API errors return empty): No test verifies that `checkPrStatus` with empty API responses (simulating outage) returns `"unknown"` CI status rather than `"pass"`. This is testable with DI for the gh.ts functions.
- **Review 5 Crew/Schedule STRIP**: Recommendations 10-11 provide the complete list of test files to remove, totaling ~4,643 LOC.
