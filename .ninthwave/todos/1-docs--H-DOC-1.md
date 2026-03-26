# Feat: Update README.md for current feature set and file-per-todo format (H-DOC-1)

**Priority:** High
**Source:** Self-improvement loop
**Depends on:**
**Domain:** docs

## Context

README.md has drifted significantly from the current state. The `/decompose` example output shows `TODOS.md` (replaced by `.ninthwave/todos/` in grind cycle 3). Many features shipped in grind cycles 4-7 are undocumented: `nw retry`, `nw doctor`, review workers, stacked branch execution, interactive CLI flow, granular failure states, strait/proxy integration, custom GitHub identity, persistent watch mode.

## Requirements

1. Replace all references to `TODOS.md` with `.ninthwave/todos/` format in examples and prose
2. Update the `/decompose` example output to show `5 items across 3 batches written to .ninthwave/todos/`
3. Add documentation for shipped CLI commands missing from the reference table: `retry`, `doctor`, `stop`
4. Update the "What gets installed" details section to reflect `.ninthwave/todos/` instead of `TODOS.md`
5. Add a brief mention of stacked branch execution in the "What You Get" section
6. Update the "Work item backends" table to include Sentry and PagerDuty under Observability
7. Ensure the `nw setup` description mentions it creates `.ninthwave/todos/` directory
8. Keep changes scoped to README.md — do not modify other documentation files

Acceptance: README.md no longer references `TODOS.md` as a writable file. All CLI commands listed in `core/commands/` are represented in the reference table. The `/decompose` example output matches the `.ninthwave/todos/` file-per-todo format.

**Test plan:** Verify no broken markdown links. Verify all CLI commands from `core/commands/` directory are mentioned in the README reference table. Search for any remaining `TODOS.md` references that aren't historical context.

Key files: `README.md`
