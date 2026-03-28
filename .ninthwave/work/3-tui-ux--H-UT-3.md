# Feat: Log ring buffer, panel wiring, and keyboard shortcuts (H-UT-3)

**Priority:** High
**Source:** Unified TUI plan -- Phase 2B log buffer + panel wiring
**Depends on:** H-UT-1, H-UT-2
**Domain:** tui-ux

Wire the panel rendering system into the orchestrate.ts TUI. Extend TuiState with panelMode, logBuffer (LogEntry[]), logScrollOffset, and logLevelFilter. The log function in TUI mode is a closure created inside cmdWatch that appends to a file -- add a ring buffer push to this closure so log entries feed the panel without disk reads during render. Cap buffer at 500 entries, drop oldest on overflow. Default panel mode is split view. Add keyboard shortcuts: Tab cycles panel mode (split -> logs-only -> status-only -> split), j/k scroll log panel, l cycles log level filter (info -> warn -> error -> all), G jumps to end (re-enable follow mode). Replace existing renderTuiFrame() calls with renderPanelFrame() calls. Extract a runTUI() function from cmdWatch() that can be called by status.ts in read-only mode (export it).

**Test plan:**
- Unit test ring buffer: push 600 entries, verify length is 500 and oldest are dropped
- Test log level filter: buffer with mixed levels, filter to "error" shows only error entries
- Test panel mode cycling: split -> logs-only -> status-only -> split, verify state transitions
- Test small terminal (< 35 rows): Tab shows hint instead of split, cycles between full-screen views
- Test j/k scroll clamping: scroll beyond buffer end stays at max, scroll before 0 stays at 0
- Test G key resets scroll to follow mode (scrollOffset = buffer.length - viewportHeight)
- Verify renderPanelFrame() is called instead of renderTuiFrame() in the TUI render path
- Integration test: mock log closure, verify entries appear in both logBuffer and file

Acceptance: TUI shows split view by default with status table on top and live log stream below. Tab toggles between split/logs-only/status-only. j/k scroll the log panel. l filters by level. G jumps to latest. Log entries stream in real-time from the orchestrator event loop. runTUI() is exported for status.ts to call. bun test test/ passes.

Key files: `core/commands/orchestrate.ts`, `test/orchestrate.test.ts`
