# Fix: Separator width bug and gitignore cleanup (H-ST-1)

**Priority:** High
**Source:** Plan: Status Command Condensing (2026-03-27)
**Depends on:** None
**Domain:** cli-ux

Two small fixes bundled together. (1) The status table separator line is capped at `Math.min(termWidth - 2, 78)` (line 515 of status-render.ts) but data rows can exceed 78 chars, especially with the BLOCKED BY column active. Fix the separator to use `Math.min(termWidth - 2, fixedWidth + titleWidth)` which are already computed on lines 506-507. (2) `.claude/worktrees/` shows as untracked in git status because `.gitignore` covers `.claude/projects/` but not `.claude/worktrees/`. Add the ignore rule.

**Test plan:**
- Update separator width assertions in `test/status-render.test.ts` -- verify separator length matches data row width at terminal widths 40, 80, 120, 200
- Add test case: separator width with BLOCKED BY column active (hasDeps=true) should be wider than 78
- Verify `git status` no longer shows `.claude/worktrees/` as untracked after gitignore change

Acceptance: Separator line width matches data row content width across all terminal widths. `.claude/worktrees/` is gitignored. All existing tests pass.

Key files: `core/status-render.ts:515`, `.gitignore`, `test/status-render.test.ts`
