# Feat: Generate and seed Codex managed agent artifacts (H-CDX-2)

**Priority:** High
**Source:** Spec `.opencode/plans/1775082497672-eager-rocket.md`
**Depends on:** H-CDX-1
**Domain:** ai-tooling
**Lineage:** baa25a68-5e42-49db-b08e-6a140f272d93

Teach project setup and worktree seeding to create only ninthwave-owned Codex artifacts under `.codex/agents/`. Detect Codex from those managed files, render the TOML artifacts during `init` and `setup`, and seed the same generated artifacts into worker worktrees while leaving user-owned root instruction files such as `AGENTS.md` untouched.

**Test plan:**
- Extend `test/setup.test.ts` to verify Codex detection from `.codex/agents`, rendered copy-plan entries, and pruning that removes only ninthwave-owned `ninthwave-*.toml` files
- Extend `test/init.test.ts` to verify init writes Codex managed artifacts without creating or refreshing `AGENTS.md`
- Extend `test/seed-agent-files.test.ts` to verify worktree seeding writes generated `.codex/agents/ninthwave-*.toml` files from remote-first or local-fallback agent sources

Acceptance: `init`, `setup`, and worktree seeding produce consistent `.codex/agents/ninthwave-*.toml` files, detect Codex from those managed artifacts, and never create, overwrite, or prune user-owned non-ninthwave Codex files.

Key files: `core/commands/setup.ts`, `core/commands/init.ts`, `core/agent-files.ts`, `test/setup.test.ts`, `test/init.test.ts`, `test/seed-agent-files.test.ts`
