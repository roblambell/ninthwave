# Fix: Add final shutdown footer after double Ctrl-C in TUI (L-TQF-1)

**Priority:** Low
**Source:** Spec `.opencode/plans/1775111202827-neon-planet.md`
**Depends on:** None
**Domain:** tui-quit-feedback
**Lineage:** 5438fce4-5a45-4b83-b021-87055d65a222

Add a dedicated shutdown-in-progress footer state to the interactive TUI so the second `Ctrl-C` shows a red `Closing...` message before shutdown completes. Keep the first `Ctrl-C` confirmation unchanged, cancel the pending timer safely on the second press, and preserve the existing graceful quit path instead of refactoring the shutdown flow.

**Test plan:**
- Add `test/tui-keyboard.test.ts` coverage proving the second `Ctrl-C` clears the pending confirmation state, sets the shutdown footer state, and still routes through `onShutdown`
- Add `test/status-render.test.ts` coverage for the red `Closing...` footer and its precedence over the normal strategy/update footer and the yellow `ctrlCPending` footer
- Update targeted `test/orchestrate.test.ts` TUI fixtures or assertions only where the new footer state must be initialized or observed

Acceptance: Pressing `Ctrl-C` once still shows `Press Ctrl-C again to exit`. Pressing `Ctrl-C` a second time within the confirmation window switches the shared TUI footer to a red `Closing...` message before the session exits. The existing shutdown path remains intact, the first-press timer cannot clear the new shutdown state after the second press, and the focused keyboard/render tests cover the new behavior.

Key files: `core/tui-keyboard.ts`, `core/status-render.ts`, `core/commands/orchestrate.ts`, `test/tui-keyboard.test.ts`, `test/status-render.test.ts`, `test/orchestrate.test.ts`
