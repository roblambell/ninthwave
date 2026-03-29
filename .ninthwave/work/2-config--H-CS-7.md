# Refactor: Set per-role model defaults in agent frontmatter (H-CS-7)

**Priority:** High
**Source:** Config simplification plan 2026-03-29
**Depends on:** H-CS-5, H-CS-6
**Domain:** config

Set model defaults in agent frontmatter so each role uses the appropriate model tier. Claude Code reads the `model:` field natively from agent .md files -- no ninthwave code changes needed.

| Agent file | Old value | New value | Rationale |
|------------|-----------|-----------|-----------|
| `agents/implementer.md` | `model: inherit` | `model: opus` | Highest leverage -- correct first pass prevents cascading rework |
| `agents/reviewer.md` | `model: inherit` | `model: sonnet` | Structured checklist task, Sonnet follows detailed instructions well |
| `agents/rebaser.md` | `model: inherit` | `model: sonnet` | Conflict resolution needs understanding but not Opus-level reasoning |
| `agents/forward-fixer.md` | `model: inherit` | `model: sonnet` | CI failure diagnosis from logs + diff, minimal fix PRs |

Uses Claude Code's short aliases (`opus`, `sonnet`) which always resolve to the latest version. Other tools (Copilot, OpenCode) will interpret or ignore as they see fit.

**Test plan:**
- Verify frontmatter: `grep "^model:" agents/*.md` shows correct values
- No code tests needed -- this is a content-only change to agent prompt files

Acceptance: `agents/implementer.md` has `model: opus`. `agents/reviewer.md`, `agents/rebaser.md`, and `agents/forward-fixer.md` have `model: sonnet`. No other changes.

Key files: `agents/implementer.md`, `agents/reviewer.md`, `agents/rebaser.md`, `agents/forward-fixer.md`
