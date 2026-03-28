# Feat: Shift+Tab merge strategy cycling in TUI (H-TUI-4)

**Priority:** High
**Source:** TUI status improvements plan 2026-03-28
**Depends on:** H-TUI-3
**Domain:** cli-ux

Add Shift+Tab (`\x1B[Z`) keyboard shortcut to cycle through merge strategies during a `nw watch` TUI session, inspired by Claude Code's mode switcher. Display current strategy in the footer shortcuts line. When `--dangerously-bypass` was passed, include bypass as a 4th option in the cycle, displayed in red with a double-arrow prefix like Claude Code's bypass mode indicator.

Cycle order:
- Normal: auto -> reviewed -> manual -> (repeat)
- With --dangerously-bypass: auto -> reviewed -> manual -> bypass -> (repeat)

Footer display:
- Normal: `q quit  d deps  up/down scroll  shift+tab auto`
- Bypass active: `q quit  d deps  up/down scroll  >> bypass on` (red)

**Test plan:**
- Test keyboard handler: verify `\x1B[Z` triggers strategy cycle callback and rotates through auto -> reviewed -> manual correctly
- Test with bypassEnabled: verify cycle includes bypass as 4th option
- Test Orchestrator.setMergeStrategy(): verify it changes strategy and subsequent evaluateMerge uses new strategy
- Test footer rendering: verify shortcuts line includes strategy label, verify bypass renders in red

Acceptance: Shift+Tab cycles merge strategy in TUI. Current strategy shown in footer shortcuts line. When --dangerously-bypass active, bypass option appears in red in the cycle. Strategy changes are logged as structured events. Strategy change takes effect on next poll cycle.

Key files: `core/commands/orchestrate.ts:1576-1658,2243-2261`, `core/status-render.ts:1238-1247`, `core/orchestrator.ts:430-440`
