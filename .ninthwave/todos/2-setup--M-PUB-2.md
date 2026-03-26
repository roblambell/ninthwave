# Fix: Gitignore developer-local agent and skill symlinks (M-PUB-2)

**Priority:** Medium
**Source:** Dogfood friction — symlinks broken for external contributors on public repos
**Depends on:**
**Domain:** setup

## Context

`ninthwave setup` creates relative symlinks for agents (`.claude/agents/`, `.opencode/agents/`, `.github/agents/`) and skills (`.claude/skills/`). These point to the local ninthwave installation and are broken for anyone who doesn't have ninthwave installed at the same relative path. On public repos, that's every external contributor. The symlinks should be gitignored and re-created by `ninthwave setup` on each developer's machine.

## Requirements

1. Update the `.gitignore` modification block in `setup.ts` to add symlinked directories: `.claude/agents/`, `.claude/skills/`, `.opencode/agents/`, `.github/agents/`.
2. Update the parallel `.gitignore` block in `init.ts` to match.
3. Skip gitignoring symlink directories when the target project IS the ninthwave repo itself (detect via presence of `core/cli.ts` or check if bundleDir equals projectRoot). In self-hosting mode, these files are source, not symlinks.
4. Ensure idempotency — don't duplicate gitignore entries on re-run.

Acceptance: After `ninthwave setup` on a non-ninthwave project, `.claude/agents/`, `.claude/skills/`, `.opencode/agents/`, and `.github/agents/` appear in `.gitignore`. On the ninthwave repo itself, they are NOT gitignored. Re-running setup does not duplicate entries.

**Test plan:**
- Unit test: verify gitignore entries are added for non-ninthwave projects
- Unit test: verify gitignore entries are NOT added when projectRoot equals bundleDir (self-hosting)
- Unit test: verify idempotency — run setup twice, check no duplicate entries
- Verify symlinks are still created correctly after gitignore changes

Key files: `core/commands/setup.ts`, `core/commands/init.ts`
