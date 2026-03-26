# Refactor: Relocate runtime state files to ~/.ninthwave/<project>/ (H-PUB-1)

**Priority:** High
**Source:** Dogfood friction — runtime state clutters project git history on public repos
**Depends on:**
**Domain:** daemon

## Context

Runtime state files (orchestrator.state.json, orchestrator.pid, orchestrator.log, health-samples.jsonl, version, state-archive/) are currently stored in `.ninthwave/` inside the project. These are per-developer ephemeral files that should never be committed. Instead of managing complex gitignore rules, relocate them to `~/.ninthwave/projects/<project-hash>/` where they naturally stay out of git.

## Requirements

1. Add a `userStateDir(projectRoot)` function that computes a stable per-project directory under `~/.ninthwave/projects/`. Use a path-derived hash or slug (e.g., encode the absolute project root path similarly to how Claude Code uses `-Users-roblambell-code-ninthwave`).
2. Update `daemon.ts` path functions (`pidFilePath`, `stateFilePath`, `logFilePath`) to use the new user state directory.
3. Update `analytics.ts` health-samples path to use the new user state directory.
4. Update `setup.ts` to write `.ninthwave/version` to the user state directory instead of the project.
5. Move `state-archive/` handling to the user state directory.
6. On first run, migrate any existing state files from `.ninthwave/` to the new location (one-time migration).
7. Remove the old runtime files from `.ninthwave/` after migration (cleanup).
8. Update `status.ts` to read from the new location.

Acceptance: All runtime state files are written to `~/.ninthwave/projects/<hash>/` instead of `.ninthwave/`. `daemon.ts`, `status.ts`, `analytics.ts`, and `setup.ts` all use the new path. Existing files are migrated on first run. No runtime state files appear in `git status` after setup.

**Test plan:**
- Unit test `userStateDir()` returns consistent paths for the same project root and different paths for different roots
- Unit test path functions (`pidFilePath`, `stateFilePath`, `logFilePath`) return paths under `~/.ninthwave/`
- Unit test migration: place files in old `.ninthwave/` location, run migration, verify moved to new location
- Verify `readStateFile`/`writeStateFile` still work with new paths via existing daemon tests

Key files: `core/daemon.ts`, `core/commands/orchestrate.ts`, `core/commands/status.ts`, `core/analytics.ts`, `core/commands/setup.ts`
