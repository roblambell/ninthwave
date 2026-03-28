# Refactor: Merge nw status into unified TUI and add no-args entry (H-UT-6)

**Priority:** High
**Source:** Unified TUI plan -- Phase 2C + 3D
**Depends on:** H-UT-4, H-UT-5
**Domain:** tui-ux

Make nw status --watch (the default live mode) call the orchestrate.ts runTUI() in read-only mode instead of running its own duplicated TUI loop. When a daemon is running, status reads items from the daemon state file and tails the log file for the log panel. When no daemon is running, it scans worktrees as today. nw status --once remains unchanged (one-shot print and exit). Remove the duplicated alt-screen, raw-mode, keyboard, and scroll code from status.ts.

Also wire nw (no-args) to open the TUI directly. Diagnostic states (no git repo, no .ninthwave, no work items) stay as text output before the TUI -- these do not make sense inside a TUI. If a daemon is already running, open TUI in read-only mode (same as nw status). If items exist and no daemon, run the interactive prompts then start orchestration. Empty state shows: "No work items found. Run /decompose to get started."

**Test plan:**
- Test nw status calls runTUI with readOnly: true when daemon is running
- Test nw status --once still works as one-shot print (no TUI)
- Test nw status with no daemon: scans worktrees, shows status in TUI
- Test log file tailing in read-only mode: new entries appear in log panel
- Test nw (no-args) with items and no daemon: routes to TUI
- Test nw (no-args) with no items: prints empty state message, does not enter TUI
- Test nw (no-args) with daemon running: opens read-only TUI
- Verify duplicated keyboard/scroll/alt-screen code removed from status.ts

Acceptance: nw status --watch uses the same panel TUI as nw watch (read-only). nw (no-args) opens the TUI directly when items exist. Empty state shows actionable message. Duplicated TUI code removed from status.ts. bun test test/ passes.

Key files: `core/commands/status.ts`, `core/commands/orchestrate.ts`, `core/cli.ts`, `core/commands/onboard.ts`, `test/status-render.test.ts`
