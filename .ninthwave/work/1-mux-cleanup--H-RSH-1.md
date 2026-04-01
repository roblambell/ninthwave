# Refactor: Strip Multiplexer interface and delete send-keys files (H-RSH-1)

**Priority:** High
**Source:** Plan: Remove Send-Keys & Add Headless Adapter (eng-reviewed 2026-04-01)
**Depends on:** None
**Domain:** mux-cleanup

Delete the three send-keys implementation files (core/tmux-send.ts, core/send-message.ts, core/delivery.ts) and their three test files. Remove `sendMessage` from the Multiplexer interface in core/mux.ts. Strip `sendMessage` implementations and related imports from TmuxAdapter (core/tmux.ts) and CmuxAdapter (core/cmux.ts). Remove `waitForReady` from mux.ts. Add `"headless"` to the `MuxType` union. Keep `readScreen` in the interface -- it is still used for diagnostic captures.

**Test plan:**
- Delete test/tmux-send.test.ts, test/send-message.test.ts, test/delivery.test.ts entirely
- Remove sendMessage delegation test from test/mux.test.ts (~line 63)
- Remove waitForReady tests from test/mux.test.ts (~lines 295-391)
- Remove send-message.ts import tests from test/cmux.test.ts (~line 10)
- Verify readScreen tests still pass in test/mux.test.ts, test/tmux.test.ts
- Run full test suite to confirm no broken imports

Acceptance: `sendMessage` is gone from the Multiplexer interface. The 6 send-keys files are deleted. `MuxType` includes `"headless"`. `readScreen` remains. All remaining tests pass. No file imports tmux-send.ts, send-message.ts, or delivery.ts.

Key files: `core/mux.ts`, `core/tmux.ts`, `core/cmux.ts`, `core/tmux-send.ts`, `core/send-message.ts`, `core/delivery.ts`, `test/mux.test.ts`, `test/tmux.test.ts`, `test/cmux.test.ts`
