# Fix: Alt screen buffer for TUI scrollback fix (H-TUI-1)

**Priority:** High
**Source:** TUI status improvements plan 2026-03-28
**Depends on:** None
**Domain:** cli-ux

The TUI uses cursor-home (`\x1B[H`) to redraw each frame, which preserves every render in the terminal scrollback buffer. Scrolling up shows ghost frames of previous renders. Switch to alternate screen buffer (`\x1B[?1049h` / `\x1B[?1049l`) so the TUI runs in an isolated screen that does not pollute scrollback. Enter on TUI start, leave on exit, with a `process.on('exit')` safety net.

**Test plan:**
- Verify `renderTuiFrame` still uses `\x1B[H` (alt screen is caller's responsibility, not the render function's)
- Test that the cleanup function in `setupKeyboardShortcuts` or the finally block writes `ALT_SCREEN_OFF` on exit
- Manual: run `nw watch`, scroll up in terminal -- no ghost frames visible

Acceptance: TUI enters alternate screen buffer on start and leaves it on exit. Scrolling up in the terminal shows no ghost frames from previous renders. Terminal state is always restored, even on SIGINT/SIGTERM.

Key files: `core/output.ts`, `core/commands/orchestrate.ts:2370-2443`, `core/commands/status.ts:300-420`
