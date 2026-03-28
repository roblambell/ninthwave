# Fix: Session duration metrics truncation (H-TUI-2)

**Priority:** High
**Source:** TUI status improvements plan 2026-03-28
**Depends on:** None
**Domain:** cli-ux

The title metrics line ("Lead: 4m  Thru: 17.3/hr  Session: 10m") fills exactly `termWidth` characters, causing some terminals to clip the final character due to deferred-wrap behavior. The "m" suffix on session duration gets lost. Fix by subtracting 1 from `termWidth` in the gap calculation in `formatTitleMetrics()` to leave a safety margin that prevents right-edge truncation.

**Test plan:**
- Update existing "shows right-aligned Lead/Thru/Session when metrics available" test to verify visible output width is `<= termWidth - 1`
- Add boundary test where termWidth is exactly `titlePlain.length + 4 + metricsStr.length + 1` -- verify full metrics string including "m" suffix is present
- Add test where termWidth is too narrow -- verify graceful fallback to plain title

Acceptance: `formatTitleMetrics()` never produces a line that fills `termWidth` exactly. Session duration always shows with its unit suffix (e.g., "10m" not "10"). Existing tests pass.

Key files: `core/status-render.ts:1066-1102`
