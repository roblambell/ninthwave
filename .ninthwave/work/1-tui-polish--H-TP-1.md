# Fix: Title rename and footer wrap fix (H-TP-1)

**Priority:** High
**Source:** Live daemon session observation 2026-03-29
**Depends on:** None
**Domain:** tui-polish

Remove the word "status" from the TUI title -- it currently says "ninthwave status" in the top-left but should just say "ninthwave". Three locations in `core/status-render.ts`: `formatStatusTable` (line 814), `formatTitleMetrics` (lines 1184-1185 including the plain-text width variable), and `buildStatusLayout` empty-state branch (line 1236). Also update the docstring example at line 1177.

Fix the item count in the bottom-right being clipped by terminal deferred-wrap. `formatUnifiedProgress` (line 1167) fills the line to exactly `termWidth`, so the last character ("s" in "items") lands in the terminal's final column and gets wrapped/overwritten. Apply the same `-1` guard that `formatTitleMetrics` already uses (line 1212) -- change the gap calculation from `termWidth - 2 - leftPlain.length - totalText.length` to `termWidth - 2 - leftPlain.length - totalText.length - 1`.

Update all test assertions in `test/status-render.test.ts` and `test/status.test.ts` that check for `"ninthwave status"` to check for `"ninthwave"` instead. Do NOT change assertions about the `ninthwave status --watch` command string (those are CLI commands, not display text).

**Test plan:**
- Update ~25 existing test assertions from "ninthwave status" to "ninthwave"
- Add a test in status-render.test.ts verifying `formatUnifiedProgress` output length is < termWidth (not equal to it)
- Verify all tests pass with `bun test test/`

Acceptance: TUI title shows "ninthwave" (no "status" suffix). `formatUnifiedProgress` output is at most `termWidth - 1` characters wide, preventing deferred-wrap clipping. All existing tests pass after assertion updates.

Key files: `core/status-render.ts:814`, `core/status-render.ts:1167`, `core/status-render.ts:1184`, `core/status-render.ts:1236`, `test/status-render.test.ts`, `test/status.test.ts`
