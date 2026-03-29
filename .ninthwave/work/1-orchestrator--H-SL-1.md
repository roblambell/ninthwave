# Fix: Stacked launch race when dependency completes before launch (H-SL-1)

**Priority:** High
**Source:** Production failure -- stacked items fail with "fatal: invalid reference: origin/ninthwave/<dep-id>"
**Depends on:** None
**Domain:** orchestrator

When a dependency completes (merged, branch deleted from origin) between stacking promotion and actual launch, the dependent item fails because `origin/ninthwave/<dep-id>` no longer exists. Fix with two layers: (1) in `executeLaunch()`, re-check dependency state before launching -- if dep is now done/merged, clear baseBranch so the item launches from main; (2) in `launchSingleItem()`, when `fetchOrigin(baseBranch)` fails, fall back to fetching main instead of continuing with the stale ref.

**Test plan:**
- Add orchestrator unit test: item B depends on A (now in `done` state), B has stale `baseBranch = "ninthwave/A"` -- assert `launchSingleItem` receives `baseBranch: undefined` after guard clears it
- Add orchestrator unit test: item B depends on A (still in `ci-passed`) -- assert baseBranch is preserved
- Add launch unit test: mock `fetchOrigin` to throw on baseBranch -- assert fallback fetches main, `createWorktree` called with `"HEAD"` not `"origin/ninthwave/..."`
- Run full test suite to verify no regressions

Acceptance: Stacked items whose dependencies have already merged launch successfully from main instead of failing with "invalid reference". Both layers work independently. All existing tests pass.

Key files: `core/orchestrator.ts:1672`, `core/orchestrator.ts:2590`, `core/commands/launch.ts:474`
