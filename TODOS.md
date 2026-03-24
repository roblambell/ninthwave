# TODOS

<!-- Format guide: see $(cat .ninthwave/dir)/core/docs/todos-format.md -->

## Operational Maturity (vision exploration, 2026-03-24)


### Feat: Memory-aware dynamic WIP limits (H-WIP-1)

**Priority:** High
**Source:** Vision — prevent OOM on memory-constrained machines
**Depends on:** None

The WIP limit is currently a static number (default 5). Each worker consumes ~2.5GB (AI tool + language server + worktree). On a 16GB Mac with other processes, launching 5 workers risks OOM. Use `os.freemem()` and `os.totalmem()` to estimate available capacity at each batch launch. Cap WIP at `floor(availableMemory / 2.5GB)` with a minimum of 1 and a maximum of the configured limit. Log when WIP is reduced due to memory pressure.

**Test plan:**
- Unit test: WIP calculation returns correct values for various memory scenarios
- Unit test: WIP never drops below 1
- Unit test: WIP respects configured maximum even when memory allows more
- Edge case: system reports 0 free memory (should still allow 1 worker)

Acceptance: WIP limit is dynamically calculated based on available memory. Workers are queued when memory is constrained instead of launching immediately. Structured log emitted when WIP is reduced. Tests pass. No regression in orchestrator tests.

Key files: `core/commands/orchestrate.ts`, `core/orchestrator.ts`

---

### Feat: GitHub Issues adapter — close issues on merge and sync status (M-GHI-2)

**Priority:** Medium
**Source:** Vision — complete the GitHub Issues lifecycle loop
**Depends on:** H-GHI-1

Implement `markDone(id)` on `GitHubIssuesBackend` to close the issue via `gh issue close`. During orchestration lifecycle, add status labels to issues: `status:in-progress` when worker starts, `status:pr-open` when PR is created, remove status labels and close issue on merge. Wire into orchestrator's state transition hooks so status syncs automatically when using the GitHub Issues backend.

**Test plan:**
- Unit test: markDone calls `gh issue close` with correct issue number
- Unit test: status labels are added/removed at correct state transitions
- Edge case: issue already closed (markDone is idempotent)
- Edge case: status label doesn't exist on the repo (skip gracefully, don't error)

Acceptance: Issues are automatically closed when their PRs merge. Status labels reflect orchestrator state during processing. Label operations are idempotent and skip gracefully on missing labels. Tests pass.

Key files: `core/backends/github-issues.ts`, `core/commands/orchestrate.ts`

---

### Feat: Automatic worker retry on crash or OOM (M-RET-1)

**Priority:** Medium
**Source:** Vision — resilience improvement for production use
**Depends on:** H-WIP-1

When a worker transitions to "stuck" due to heartbeat timeout or workspace death, automatically retry once before marking as permanently stuck. Clean up the failed worktree, create a fresh one, and relaunch the worker. Add `retryCount` to `OrchestratorItem` and `maxRetries` to `OrchestratorConfig` (default: 1). Log retries as structured events. Only mark as permanently stuck after exhausting retries.

**Test plan:**
- Unit test: stuck worker triggers retry transition when retryCount < maxRetries
- Unit test: retry creates fresh worktree and relaunches worker
- Unit test: permanently stuck after maxRetries exhausted
- Unit test: retryCount is tracked in item metrics for analytics
- Edge case: worker crashes during retry (second attempt counts correctly)

Acceptance: Workers that crash are retried once automatically with a fresh worktree. Retry count is tracked per item and reflected in analytics. Items are permanently stuck only after exhausting retries. Retries are logged as structured events. Tests pass. No regression in orchestrator state machine tests.

Key files: `core/orchestrator.ts`, `core/commands/orchestrate.ts`, `core/commands/clean.ts`

---

## Engineering Review (vision exploration, 2026-03-24)


### Docs: Engineering review — core orchestrator and state machine (H-ENG-1)

**Priority:** High
**Source:** Vision — comprehensive architecture audit
**Depends on:** None

Run `/plan-eng-review` on the core orchestrator: state machine (`core/orchestrator.ts`), command driver (`core/commands/orchestrate.ts`), and supporting modules (shell execution, git operations, lock management). Audit: state transition correctness, error handling at boundaries, race conditions in concurrent operations, recovery robustness, and test coverage gaps. Document findings in a `docs/reviews/eng-review-orchestrator.md` file. For each finding that requires a code change, add a new TODO item to TODOS.md with the appropriate priority, description, and test plan.

**Test plan:**
- Run `/plan-eng-review` targeting orchestrator modules
- Verify review document is comprehensive (covers all 13 states and transitions)
- Verify each actionable finding has a corresponding TODO with acceptance criteria

Acceptance: `docs/reviews/eng-review-orchestrator.md` exists with structured findings. Every actionable finding (not just observations) has a corresponding TODO added to TODOS.md. Review covers: state transitions, error handling, race conditions, recovery paths, and test coverage. No code changes in this TODO — findings only.

Key files: `core/orchestrator.ts`, `core/commands/orchestrate.ts`, `core/shell.ts`, `core/git.ts`, `core/lock.ts`, `test/orchestrator.test.ts`, `test/orchestrate.test.ts`

---

### Docs: Engineering review — worker lifecycle and communication (H-ENG-2)

**Priority:** High
**Source:** Vision — comprehensive architecture audit
**Depends on:** None

Run `/plan-eng-review` on the worker lifecycle: launch (`core/commands/start.ts`), multiplexer abstraction (`core/mux.ts`, `core/cmux.ts`), message sending (`core/send-message.ts`), heartbeat monitoring, cleanup (`core/commands/clean.ts`), and reconciliation (`core/commands/reconcile.ts`). Audit: worker launch reliability, message delivery guarantees, heartbeat accuracy, cleanup completeness, and cross-platform edge cases (cmux vs tmux). Document findings in `docs/reviews/eng-review-workers.md`. Add TODOs for actionable findings.

**Test plan:**
- Run `/plan-eng-review` targeting worker lifecycle modules
- Verify review covers both cmux and tmux code paths
- Verify each actionable finding has a corresponding TODO

Acceptance: `docs/reviews/eng-review-workers.md` exists with structured findings. Every actionable finding has a corresponding TODO added to TODOS.md. Review covers: launch reliability, message delivery, heartbeat accuracy, cleanup completeness, and multiplexer edge cases. No code changes in this TODO — findings only.

Key files: `core/commands/start.ts`, `core/mux.ts`, `core/cmux.ts`, `core/send-message.ts`, `core/commands/clean.ts`, `core/commands/reconcile.ts`, `test/start.test.ts`, `test/mux.test.ts`, `test/clean.test.ts`, `test/reconcile.test.ts`

---

### Docs: Engineering review — data pipeline (parser, analytics, webhooks, templates) (M-ENG-3)

**Priority:** Medium
**Source:** Vision — comprehensive architecture audit
**Depends on:** None

Run `/plan-eng-review` on the data pipeline: TODOS.md parser (`core/parser.ts`), analytics (`core/analytics.ts`, `core/commands/analytics.ts`), webhooks (`core/webhooks.ts`), decomposition templates (`core/templates.ts`), cross-repo resolution (`core/cross-repo.ts`), and configuration (`core/config.ts`). Audit: parser robustness with malformed input, analytics data integrity, webhook failure handling, template extensibility, and cross-repo edge cases. Document findings in `docs/reviews/eng-review-data-pipeline.md`. Add TODOs for actionable findings.

**Test plan:**
- Run `/plan-eng-review` targeting data pipeline modules
- Verify review covers edge cases in parser (malformed TODOS.md, missing fields)
- Verify each actionable finding has a corresponding TODO

Acceptance: `docs/reviews/eng-review-data-pipeline.md` exists with structured findings. Every actionable finding has a corresponding TODO added to TODOS.md. Review covers: parser robustness, analytics integrity, webhook failure handling, template extensibility, and cross-repo edge cases. No code changes in this TODO — findings only.

Key files: `core/parser.ts`, `core/analytics.ts`, `core/commands/analytics.ts`, `core/webhooks.ts`, `core/templates.ts`, `core/cross-repo.ts`, `core/config.ts`, `test/parser.test.ts`, `test/analytics.test.ts`, `test/webhooks.test.ts`, `test/templates.test.ts`

---

## Worker Reliability (eng-review-workers, 2026-03-24)


### Fix: Sanitize TODO title with allowlist to prevent shell injection (H-WRK-1)

**Priority:** High
**Source:** Eng review W-7 — `docs/reviews/eng-review-workers.md`
**Depends on:** None

`launchAiSession` in `core/commands/start.ts` (line 98) interpolates `safeTitle` into a shell command string. The current sanitization (line 242) only strips `` ` ``, `$`, and `'` but doesn't handle `"`, `\`, `;`, `|`, `&`, or newlines. Switch to an allowlist approach: replace everything except `[a-zA-Z0-9 _-]` with `_`.

**Test plan:**
- Unit test: titles with shell metacharacters (`"`, `\`, `;`, `|`, `&`, newlines) are sanitized
- Unit test: normal titles pass through unchanged
- Unit test: empty title produces safe output

Acceptance: `safeTitle` sanitization uses an allowlist (`[a-zA-Z0-9 _-]`). Shell metacharacters are replaced, not just stripped. Tests cover all common injection vectors. No regression in start tests.

Key files: `core/commands/start.ts`, `test/start.test.ts`

---

### Feat: Add time-based heartbeat for stuck worker detection (H-WRK-2)

**Priority:** High
**Source:** Eng review W-15 — `docs/reviews/eng-review-workers.md`
**Depends on:** None

The current liveness check is binary (workspace exists = alive). A worker that launches but hangs indefinitely is never detected as stuck. Add a time-based heartbeat: if `lastCommitTime` is null and the worker has been in `implementing` state for longer than a configurable timeout (e.g., 30 minutes), or if `lastCommitTime` is stale beyond a longer timeout (e.g., 60 minutes), transition to `stuck`. The `lastCommitTime` field is already tracked in `buildSnapshot` but not used in transition logic.

**Test plan:**
- Unit test: worker with no commits after launch timeout transitions to stuck
- Unit test: worker with stale commit beyond activity timeout transitions to stuck
- Unit test: worker with recent commits stays in implementing
- Unit test: timeout values are configurable via `OrchestratorConfig`
- Edge case: worker that just launched (within grace period) is not marked stuck

Acceptance: Workers that hang without making commits are detected as stuck after a configurable timeout. `OrchestratorConfig` has `launchTimeoutMs` and `activityTimeoutMs` fields. State machine uses `lastCommitTime` and `lastTransition` timestamps for stuck detection. Tests pass. No regression.

Key files: `core/orchestrator.ts`, `core/commands/orchestrate.ts`, `test/orchestrator.test.ts`

---

### Fix: Add delivery verification and retry to TmuxAdapter sendMessage (H-WRK-3)

**Priority:** High
**Source:** Eng review W-25 — `docs/reviews/eng-review-workers.md`
**Depends on:** None

The tmux `sendMessage` uses `send-keys -l` without delivery verification or retry, while cmux has paste-buffer + verify + exponential backoff. Extract the verification logic from `send-message.ts` into a shared utility and wire it into `TmuxAdapter.sendMessage`. Alternatively, have `TmuxAdapter` use tmux's `load-buffer` + `paste-buffer` approach (analogous to cmux's atomic paste) with verification.

**Test plan:**
- Unit test: TmuxAdapter sendMessage verifies delivery via readScreen
- Unit test: TmuxAdapter retries on failed delivery
- Unit test: TmuxAdapter falls back gracefully when verification fails
- Integration: message delivery works end-to-end on tmux

Acceptance: `TmuxAdapter.sendMessage` includes delivery verification and retry with exponential backoff. Tmux and cmux paths have equivalent delivery guarantees. Tests cover retry and verification scenarios. No regression.

Key files: `core/mux.ts`, `core/send-message.ts`, `test/mux.test.ts`

---

### Fix: Log warnings on fetch/merge failures during worktree creation (M-WRK-4)

**Priority:** Medium
**Source:** Eng review W-3 — `docs/reviews/eng-review-workers.md`
**Depends on:** None

`launchSingleItem` in `core/commands/start.ts` (lines 200-208) silently catches `fetchOrigin` and `ffMerge` failures. A network failure means the worktree is created from stale local `main`, leading to merge conflicts later. Replace bare `catch {}` with `catch { warn(...) }` so users see that the worktree may be based on outdated code.

**Test plan:**
- Unit test: fetch failure logs a warning but continues
- Unit test: ff-merge failure logs a warning but continues
- Verify warning message includes actionable context

Acceptance: `fetchOrigin` and `ffMerge` failures log warnings with `warn()`. Worktree creation still proceeds. Tests verify warnings are emitted. No regression.

Key files: `core/commands/start.ts`, `test/start.test.ts`

---

### Fix: TmuxAdapter splitPane returns correct pane ID (M-WRK-5)

**Priority:** Medium
**Source:** Eng review W-9 — `docs/reviews/eng-review-workers.md`
**Depends on:** None

`TmuxAdapter.splitPane` (mux.ts lines 92-108) runs `tmux split-window` then `tmux display-message -p '#{pane_id}'` to get the new pane's ID. But `display-message` returns the active pane's ID, which may not be the newly created pane. Fix by using `tmux split-window -P -F '#{pane_id}'` which prints the new pane's ID as output.

**Test plan:**
- Unit test: splitPane returns the pane ID from split-window output
- Unit test: splitPane returns fallback when -P flag output is empty
- Verify via injected ShellRunner mock

Acceptance: `TmuxAdapter.splitPane` uses `split-window -P -F '#{pane_id}'` and returns the correct pane ID. Tests verify correct pane ID is returned. No regression.

Key files: `core/mux.ts`, `test/mux.test.ts`

---

### Fix: Log cleanup failures instead of silently swallowing (M-WRK-6)

**Priority:** Medium
**Source:** Eng review W-19 — `docs/reviews/eng-review-workers.md`
**Depends on:** None

`cleanItem` in `core/commands/clean.ts` (lines 157-175) has multiple `try/catch` blocks that silently ignore errors from `removeWorktree`, `deleteBranch`, and `deleteRemoteBranch`. Replace bare `catch {}` with `catch (e) { warn(...) }` so cleanup failures are visible. The cleanup should still continue on error (resilient), but should not be silent.

**Test plan:**
- Unit test: removeWorktree failure logs warning and continues
- Unit test: deleteBranch failure logs warning and continues
- Unit test: deleteRemoteBranch failure logs warning and continues
- Verify cleanup completes even when all operations fail

Acceptance: All `catch {}` blocks in `cleanItem` and `cleanSingleWorktree` log warnings. Cleanup still completes on failure (resilient behavior preserved). Tests verify warnings. No regression.

Key files: `core/commands/clean.ts`, `test/clean.test.ts`

---

### Fix: Scope cmdClean workspace closing to merged items only (M-WRK-7)

**Priority:** Medium
**Source:** Eng review W-20 — `docs/reviews/eng-review-workers.md`
**Depends on:** None

`cmdClean` without a target ID calls `cmdCloseWorkspaces(mux)` which kills ALL todo workspaces before checking merge status. Active workers for non-merged items are killed. Fix by deferring workspace closure: close workspaces only for items whose branches are confirmed merged, or at minimum warn before closing active workspaces.

**Test plan:**
- Unit test: cmdClean without target only closes workspaces for merged worktrees
- Unit test: active workers for non-merged items are not killed
- Unit test: targeted cleanup (with ID) still closes the specific workspace

Acceptance: `cmdClean` (without target ID) only closes workspaces for items that are confirmed merged. Non-merged worker workspaces are preserved. Tests cover both targeted and broad cleanup. No regression.

Key files: `core/commands/clean.ts`, `test/clean.test.ts`

---

### Test: Add TmuxAdapter unit tests (M-WRK-8)

**Priority:** Medium
**Source:** Eng review — `docs/reviews/eng-review-workers.md`
**Depends on:** None

`TmuxAdapter` has zero test coverage. All 7 methods (`isAvailable`, `launchWorkspace`, `splitPane`, `sendMessage`, `readScreen`, `listWorkspaces`, `closeWorkspace`) are untested. Use the injectable `ShellRunner` constructor parameter to test without requiring tmux to be installed. Mirror the structure of the `CmuxAdapter` delegation tests.

**Test plan:**
- Test all 7 TmuxAdapter methods via injected ShellRunner
- Test session name generation (`nw-N` pattern)
- Test `listWorkspaces` filtering to `nw-` prefix
- Test `sendMessage` two-step (send-keys -l + Enter)
- Test error handling when tmux commands fail

Acceptance: All 7 `TmuxAdapter` methods have unit tests. Tests use dependency injection (ShellRunner), no real tmux required. Tests verify session name patterns, filtering, and error handling. No regression.

Key files: `core/mux.ts`, `test/mux.test.ts`

---

### Fix: Use word-boundary matching in isWorkerAlive (L-WRK-9)

**Priority:** Low
**Source:** Eng review W-16 — `docs/reviews/eng-review-workers.md`
**Depends on:** None

`isWorkerAlive` in `core/commands/orchestrate.ts` (line 207) uses `workspaces.includes(item.workspaceRef)` which is a substring match on the entire listing string. `workspace:1` would match `workspace:10`. Fix by splitting the listing into lines and doing per-line matching, or use regex word boundaries.

**Test plan:**
- Unit test: workspace:1 does not match workspace:10
- Unit test: exact workspace ref matches correctly

Acceptance: `isWorkerAlive` uses per-line matching or word-boundary regex. No false positives from partial ID matches. Tests cover the edge case. No regression.

Key files: `core/commands/orchestrate.ts`, `test/orchestrate.test.ts`

---

### Fix: Include TODO ID in tmux session names for workspace identification (L-WRK-10)

**Priority:** Low
**Source:** Eng review W-26 — `docs/reviews/eng-review-workers.md`
**Depends on:** None

`TmuxAdapter` uses session names like `nw-1`, `nw-2` which don't include the TODO ID. `closeWorkspacesForIds` and `isWorkerAlive` rely on the TODO ID appearing in workspace listings. Change tmux session names to include the TODO ID (e.g., `nw-H-WRK-1-1`) for reliable workspace identification.

**Test plan:**
- Unit test: tmux session name includes TODO ID when provided
- Unit test: closeWorkspacesForIds finds tmux sessions by TODO ID
- Unit test: isWorkerAlive correctly matches tmux sessions

Acceptance: Tmux session names include the TODO ID. Workspace identification functions reliably match tmux sessions. Tests verify ID-based matching. No regression.

Key files: `core/mux.ts`, `core/commands/orchestrate.ts`, `test/mux.test.ts`

---

### Test: Add tests for extractTodoText and cross-repo cleanup paths (L-WRK-11)

**Priority:** Low
**Source:** Eng review — `docs/reviews/eng-review-workers.md`
**Depends on:** None

`extractTodoText` in `core/commands/start.ts` has no tests (edge cases: missing ID, duplicate ID, malformed headers). The cross-repo worktree cleanup path in `cmdClean` (lines 199-214) is also untested. Add tests for both.

**Test plan:**
- Unit test: extractTodoText with valid ID returns correct text
- Unit test: extractTodoText with missing ID returns empty string
- Unit test: extractTodoText with duplicate IDs returns first match
- Unit test: cmdClean handles cross-repo worktrees from index file
- Unit test: cmdClean handles malformed cross-repo index entries

Acceptance: `extractTodoText` has unit tests covering edge cases. Cross-repo cleanup path in `cmdClean` has tests. All new tests pass. No regression.

Key files: `core/commands/start.ts`, `core/commands/clean.ts`, `test/start.test.ts`, `test/clean.test.ts`

---

## Vision (recurring, 2026-03-24)


### Feat: Explore vision, scope next iteration, and decompose into TODOs (L-VIS-5)

**Priority:** Low
**Source:** Self-improvement loop
**Depends on:** ANL-*, WIP-*, GHI-*, DAE-*, RET-*, ENG-*

This is a recurring meta-item. When all other TODOs are complete, this item triggers a new cycle: (1) Review the current state of ninthwave against the product vision — what's shipped, what's missing, what friction was logged. (2) Read the friction log and identify actionable improvements. (3) Identify the next most impactful capability or refinement. (4) Decompose it into TODO items following the standard format. (5) Add a new copy of this same item (L-VIS-6, etc.) depending on the new terminal items, so the cycle continues.

Acceptance: New TODO items are written to TODOS.md. A new vision exploration item is added depending on the new terminal items. The friction log is reviewed and actionable items are addressed. TODOS.md is non-empty after this item completes.

Key files: `TODOS.md`, `CLAUDE.md`, `README.md`, `vision.md`

---
