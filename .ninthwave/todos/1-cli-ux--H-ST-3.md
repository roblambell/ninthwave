# Refactor: Condense status columns -- DEPS count and DURATION (H-ST-3)

**Priority:** High
**Source:** Plan: Status Command Condensing (2026-03-27)
**Depends on:** H-ST-1
**Domain:** cli-ux

Two column changes to make the status table more condensed and useful. (1) Replace BLOCKED BY (13-char column that overflows with multiple IDs like "H-NW-1, H-NW-2") with DEPS -- a 5-char column showing the count of unresolved blockers (e.g., "2", "1", "-"). Full blocker IDs will be available via a detail toggle in a later item. (2) Replace AGE (worktree creation time, not useful) with DURATION using the existing `startedAt`/`endedAt` fields on StatusItem. Add a `formatDuration(item)` function that uses `formatElapsed()` (already at line 211) when `startedAt` exists, falling back to `formatAge(item.ageMs)` for the worktree-scan path.

**Test plan:**
- Update header assertions: `BLOCKED BY` -> `DEPS`, `AGE` -> `DURATION`
- Update multi-dep blocker test (line 302): expect count string ("1") instead of full ID ("H-NW-2")
- Add `formatDuration()` unit tests: item with startedAt+endedAt, item with startedAt only (active), item with neither (ageMs fallback)
- Verify DEPS column never overflows 5 chars with any number of blockers
- Verify existing sort-by-blocked tests still pass (sorting logic unchanged)

Acceptance: DEPS column header shows "DEPS" and is 5 chars wide. Blocker counts display correctly (count or "-"). DURATION column header shows "DURATION". Duration uses startedAt/endedAt when available, falls back to ageMs. All tests pass.

Key files: `core/status-render.ts:260-273`, `core/status-render.ts:335-346`, `core/status-render.ts:480-560`, `test/status-render.test.ts`
