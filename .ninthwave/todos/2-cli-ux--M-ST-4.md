# Feat: Add ViewOptions type and DORA metrics panel (M-ST-4)

**Priority:** Medium
**Source:** Plan: Status Command Condensing (2026-03-27)
**Depends on:** H-ST-3
**Domain:** cli-ux

Add a `ViewOptions` interface (`showMetrics`, `showBlockerDetail`, `showHelp`) and wire it as an optional parameter to `formatStatusTable()`. Add a DORA-style session metrics panel that renders below the table when `showMetrics` is true. Metrics: lead time (median of endedAt-startedAt for merged items), P95 lead time, throughput (merged/hour), success rate (merged/(merged+failed)), session duration. Add `SessionMetrics` interface, `computeSessionMetrics()`, and `formatMetricsPanel()` as pure functions. When `showBlockerDetail` is true, expand the DEPS column to show full blocker IDs (dynamic width). When `showHelp` is true, render a footer line showing available key bindings. Pass `sessionStartedAt` as an optional parameter for throughput/session duration calculation.

**Test plan:**
- Unit tests for `computeSessionMetrics()`: no merged items (nulls), all merged, mix of merged+failed, single item, items without startedAt
- Unit tests for `formatMetricsPanel()`: verify layout structure, verify formatting of each metric
- Test `formatStatusTable()` with ViewOptions: showMetrics=true includes metrics panel, showBlockerDetail=true shows full IDs, showHelp=true shows key legend
- Test backward compatibility: calling formatStatusTable without viewOptions still works (defaults applied)
- Edge cases: zero session duration (avoid division by zero in throughput), all items queued (no lead time data)

Acceptance: `ViewOptions` type exported from status-render.ts. `formatStatusTable()` accepts optional `viewOptions` parameter. Metrics panel renders correctly with lead time, P95, throughput, success rate, session duration. `showBlockerDetail` expands DEPS to full IDs. Help footer renders key bindings. All existing tests pass without modification (backward-compatible signature).

Key files: `core/status-render.ts`, `test/status-render.test.ts`
