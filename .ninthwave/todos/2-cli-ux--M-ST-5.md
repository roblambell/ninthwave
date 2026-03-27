# Feat: Add keyboard toggling to status watch mode (M-ST-5)

**Priority:** Medium
**Source:** Plan: Status Command Condensing (2026-03-27)
**Depends on:** M-ST-4
**Domain:** cli-ux

Add keyboard shortcut handling to `cmdStatusWatch()` in status.ts. When stdin is a TTY, enter raw mode and listen for keystrokes: `m` toggles metrics panel, `d` toggles deps detail view, `?` toggles help footer, `q` quits. Maintain a mutable `ViewOptions` state in the watch loop closure. On keypress, toggle the relevant boolean and force an immediate re-render (do not wait for the 5s interval). Pass the current ViewOptions through `renderStatus()` to `formatStatusTable()`. On cleanup (quit or abort signal), restore terminal state (exit raw mode). Non-TTY mode skips keyboard setup and uses default ViewOptions. Update `renderStatus()` signature to accept optional ViewOptions.

**Test plan:**
- Unit test: `renderStatus()` accepts and passes ViewOptions through to formatStatusTable
- Integration test: verify cmdStatusWatch handles AbortSignal correctly with keyboard setup (no hanging)
- Verify non-TTY mode: when stdin.isTTY is false, no raw mode is entered, default options used
- Verify terminal state cleanup: raw mode is exited on quit and on abort signal

Acceptance: `m`, `d`, `?`, `q` keys work in watch mode. Each keypress triggers immediate re-render. Metrics panel toggles on/off with `m`. Deps detail toggles with `d`. Help footer toggles with `?`. `q` exits cleanly. Non-TTY mode works without keyboard handling. Terminal state restored on exit.

Key files: `core/commands/status.ts:237-270`, `core/commands/status.ts:276`
