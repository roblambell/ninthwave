# Refactor: Update filesystem boundary rules in ETHOS.md and CLAUDE.md (H-CS-4)

**Priority:** High
**Source:** Config simplification plan 2026-03-29
**Depends on:** H-CS-3
**Domain:** config

ETHOS.md principle 1 ("Never modify user config outside the project directory") now conflicts with `~/.ninthwave/config.json`. This principle is really a development convention, not a product ethos item.

Move it from ETHOS.md to CLAUDE.md and update the wording to reflect the actual boundary: ninthwave operates within the project directory and `~/.ninthwave/`. It does not write to tool-specific user config (`~/.copilot/`, `~/.claude/`, `~/.config/`, etc.).

Remove principle 1 from ETHOS.md and renumber the remaining principles (2-6 become 1-5). Add a new convention to CLAUDE.md's Conventions section that clarifies the filesystem boundary, including the `~/.ninthwave/` exception.

**Test plan:**
- Manual review: verify ETHOS.md no longer contains the old principle 1, principles are renumbered
- Manual review: verify CLAUDE.md has the updated filesystem boundary convention
- Verify no broken cross-references to ETHOS.md principle numbers elsewhere in the repo

Acceptance: ETHOS.md principle 1 is removed and remaining principles renumbered. CLAUDE.md has a convention stating ninthwave operates within the project directory and `~/.ninthwave/` only. No writes to `~/.copilot/`, `~/.claude/`, `~/.config/`, or other tool-specific user config.

Key files: `ETHOS.md`, `CLAUDE.md`
