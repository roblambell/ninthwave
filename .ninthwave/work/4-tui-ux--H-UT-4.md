# Feat: Item detail panel with Enter/i and Escape (H-UT-4)

**Priority:** High
**Source:** Unified TUI plan -- Phase 2D item detail panel
**Depends on:** H-UT-3
**Domain:** tui-ux

Add an item detail panel that replaces the log panel when the user presses Enter or i on a selected item in the status table. The detail view shows: PR link (clickable OSC 8 hyperlink), CI status breakdown (individual check names and pass/fail), last error message, worker progress percentage, cost so far (from heartbeat data), and time in current state. Press Escape to return to the log panel. If no items exist in the table, Enter is a no-op. Item data updates live on state transitions (the detail view re-renders with fresh data from OrchestratorItem). Add a "detail" panel sub-mode to TuiState that tracks which item ID is being viewed.

**Test plan:**
- Test Enter on selected item: detail panel replaces log panel, shows correct item data
- Test Escape from detail: returns to log panel at previous scroll position
- Test Enter with no items in table: no-op, no crash
- Test detail rendering for each item state (implementing, ci-failed, merged, stuck, queued)
- Test detail with PR number shows clickable OSC 8 link, without PR shows "--"
- Test detail updates when item state changes (e.g., implementing -> ci-pending)
- Test missing optional fields (no progress, no cost) render as "--"

Acceptance: Enter/i on a selected item shows a detail view in the bottom panel with PR link, CI status, errors, progress, cost, and time in state. Escape returns to the log panel. Detail updates live. No crash on empty table or missing data. bun test test/ passes.

Key files: `core/status-render.ts`, `core/commands/orchestrate.ts`, `test/status-render.test.ts`
