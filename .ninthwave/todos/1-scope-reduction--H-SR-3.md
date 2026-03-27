# Refactor: Drop tmux and zellij multiplexer adapters (H-SR-3)

**Priority:** High
**Source:** Scope reduction -- only CMUX is actively developed against; zellij was broken as recently as 2026-03-26
**Depends on:** None
**Domain:** scope-reduction

Remove TmuxAdapter and ZellijAdapter from the multiplexer abstraction. Keep CmuxAdapter as the sole implementation. Keep the Multiplexer interface (good abstraction pattern even with one impl). Remove the --mux CLI flag and NINTHWAVE_MUX env var handling silently.

CMUX is the primary multiplexer: checked first in detection, recommended in README, and has the simplest adapter (thin CLI wrapper at 29 lines). Tmux (190 lines) and Zellij (179 lines) add maintenance burden for multiplexers not being actively tested. Zellij required two bug-fix commits on 2026-03-26.

**Test plan:**
- Run `bun test test/` -- all tests pass after removal
- Grep for "TmuxAdapter", "ZellijAdapter", "tmux", "zellij" -- no orphaned references in source code (README history mentions are fine)
- Verify `nw start X` works without --mux flag (defaults to cmux)
- Verify detectMuxType() returns "cmux" when cmux binary is available
- Verify getMux() returns CmuxAdapter instance

Acceptance: TmuxAdapter and ZellijAdapter removed. Tests for removed adapters deleted. CLI flags removed. Detection simplified to cmux-only. Multiplexer interface preserved. Tests pass.

Key files:
- DELETE `test/tmux-adapter.test.ts` (515 lines)
- DELETE `test/zellij-adapter.test.ts` (494 lines)
- `core/mux.ts` -- remove: TmuxAdapter class (lines 94-262), ZellijAdapter class (lines 284-462), TmuxAdapterOptions interface (lines 74-80), ZellijAdapterOptions interface (lines 265-271), defaultSleep function (line 70), imports from delivery.ts used only by tmux/zellij (checkDelivery, sendWithRetry, Sleeper type at lines 5-6). Simplify: MuxType to just "cmux" (line 465), detectMuxType to remove zellij/tmux detection steps (lines 500-536), getMux to remove tmux/zellij switch cases (lines 546-565). Keep: Multiplexer interface, CmuxAdapter, ShellRunner type
- `core/cli.ts` -- remove "--mux cmux|tmux" from help text (line 56)
- `core/commands/orchestrate.ts` -- remove --mux flag parsing (lines 1650-1658)
- `core/commands/start.ts` -- remove --mux flag parsing (lines 563-569), update usage hint (line 576)
- `test/mux.test.ts` -- remove TmuxAdapter describe block (lines 95-577), ZellijAdapter describe block (lines 578-748), tmux/zellij detection tests from detectMuxType block (lines 749-854), tmux/zellij cases from getMux block (lines 855-918)
- `test/mux-fail-fast.test.ts` -- remove or delete entirely (all tests are tmux/zellij specific: lines 30-207)
- `README.md` -- remove "Using with tmux" section (lines 196-220), update prerequisites (line 164), update multiplexer mentions
- `ARCHITECTURE.md` -- update MuxType references (line 135), remove TmuxAdapter/ZellijAdapter from concrete implementations list (line 145), update extension example (lines 153-159)
