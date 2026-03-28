# Feat: Panel layout infrastructure for split TUI (H-UT-2)

**Priority:** High
**Source:** Unified TUI plan -- Phase 2A panel infrastructure
**Depends on:** None
**Domain:** tui-ux

Add panel layout types and rendering functions to status-render.ts for the unified TUI. Define PanelMode ("status-only" | "split" | "logs-only"), PanelLayout (with statusPanel, logPanel, footerLines), and LogPanelLayout types. Implement buildPanelLayout() that takes panel mode, status items, log entries, and terminal dimensions -- delegates to existing buildStatusLayout() for the status portion. Implement renderPanelFrame() that composites panels with a separator line (showing log count and shortcut hints), scroll indicators for each panel, and correct line counts matching terminal height. Split minimum is 35 rows -- below that, split mode degrades to full-screen cycling. Below 10 rows, legacy flat rendering (existing MIN_FULLSCREEN_ROWS behavior). Also add formatItemDetail() for rendering item detail view (PR link with OSC 8, CI status, last error, progress, cost, time in state).

**Test plan:**
- Unit test buildPanelLayout() for all three modes at terminal sizes 80x40, 80x20, 80x8
- Test split mode degradation: at 34 rows, buildPanelLayout("split") should produce status-only layout
- Test renderPanelFrame() output line count matches terminal height exactly
- Test panel separator formatting with various log entry counts
- Test formatItemDetail() for all item states (implementing, ci-failed, merged, stuck), with and without PR number, with missing optional fields
- Test scroll indicator placement in both panels
- Verify existing buildStatusLayout() and renderFullScreenFrame() tests still pass unchanged

Acceptance: buildPanelLayout() returns correct PanelLayout for all three modes. renderPanelFrame() produces terminal-height-exact output with proper scroll indicators and separator. Split view shows status top (60%) and logs bottom (40%) at 35+ rows. formatItemDetail() renders all item states with clickable PR links. bun test test/ passes.

Key files: `core/status-render.ts`, `test/status-render.test.ts`
