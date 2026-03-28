# Feat: Post-completion prompt, exit summary, and persistent layout (H-UT-5)

**Priority:** High
**Source:** Unified TUI plan -- Phase 3A/3B/3C
**Depends on:** H-UT-3
**Domain:** tui-ux

When all items reach terminal state (done/stuck) and TUI mode is active (not --watch, not daemon, not --json), show a completion banner ("All items complete. N merged, M stuck.") with inline analytics summary (lead time, throughput, cost from collectRunMetrics()), and replace the footer with an interactive prompt: [r] Run more [c] Clean up [q] Quit. The r key re-enters item selection and restarts the orchestrate loop. The c key cleans up worktrees/workspaces for done items. The q key exits and triggers the end-of-run summary. This prompt is mutually exclusive with --watch mode, which continues its existing rescan behavior.

After exiting the TUI (via q, Ctrl-C, or normal exit), print a compact summary to stdout that persists in terminal scrollback: "ninthwave: N merged, M stuck, K queued (Xm Ys) / Cost: $X.XX (N PRs) | Lead time: p50 Xm, p95 Ym". Print in the finally block after exitAltScreen().

Also add persistent layout preference: on panel mode toggle (Tab), write the current mode to ~/.ninthwave/projects/{slug}/preferences.json. On TUI startup, read the preference file. If missing or corrupt JSON, default to split view.

**Test plan:**
- Test post-completion detection: all items done -> prompt shown, all stuck -> prompt shown, mix -> prompt shown
- Test --watch mode: all items done -> NO prompt (continues rescan)
- Test r key: re-enters selection flow, restarts loop (mock interactive flow)
- Test c key: calls cleanup for done items
- Test q key: exits, triggers summary
- Test exit summary format: correct counts, duration, cost, latency. Test with 0 items (minimal output)
- Test Ctrl-C during prompt: clean exit with summary
- Test persistent prefs: write on toggle, read on startup, missing file -> split default, corrupt JSON -> split default, roundtrip write+read

Acceptance: Post-completion prompt appears when all items are terminal in non-watch TUI mode. r/c/q keys work as described. End-of-run summary prints to stdout after TUI exit and persists in scrollback. Layout preference persists between sessions. bun test test/ passes.

Key files: `core/commands/orchestrate.ts`, `core/daemon.ts`, `test/orchestrate.test.ts`
