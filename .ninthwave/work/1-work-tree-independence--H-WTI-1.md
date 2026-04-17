# Refactor: Read work items and config from origin/main, not the working tree (H-WTI-1)

**Priority:** High
**Source:** Conversation 2026-04-17 -- user dogfooding question about coexisting with the daemon while on a feature branch surfaced that stale or modified working trees silently exclude work items from orchestration.
**Depends on:** None
**Domain:** orchestrator
**Lineage:** 803a8b57-1a9c-4f3c-b8d9-c580f6a24f35
**Requires manual review:** true

Make the daemon's view of work items and `config.json` independent of the user's working tree by sourcing both directly from `origin/main` via git plumbing (`git ls-tree origin/main` for listing, `git show origin/main:<path>` for contents). Today `listWorkItems()` reads `.ninthwave/work/*.md` from the filesystem and `getCleanRemoteWorkItemFiles()` intersects that set with origin/main, which means a stale or dirty user checkout silently skips items: new items added to main since the user branched are invisible, and items the user modified locally are excluded. After this change the daemon sees exactly what is on `origin/main` regardless of the user's branch, dirty files, or fetch freshness. `config.local.json` continues to come from the working tree (it is gitignored by design and is the only intentional local override). Hard-fail with an actionable error on daemon startup and on any work-item read if `git rev-parse origin/main` does not resolve -- no graceful fallback, since the rest of the orchestration assumes a remote main exists. `nw init` should also fail until the user has pushed at least once.

**Test plan:**
- Unit: replace tests for `getCleanRemoteWorkItemFiles` (the diff-based filter) with tests for the new origin-only reader: lists exactly the files on origin/main, contents match `git show origin/main:<path>`, no working-tree filesystem reads occur.
- Unit: `listWorkItems` (or its replacement) returns the same items regardless of the simulated current branch, dirty index, or modified `.ninthwave/work/*.md` in the working tree.
- Unit: precondition check fails with a clear, actionable error message when `origin/main` does not resolve; verify the message names the missing ref and the remediation (push first, configure remote).
- Unit: `config.json` reader sources from `origin/main`; `config.local.json` continues to come from the working tree; both compose in the same precedence order as today.
- Integration: end-to-end orchestrate run with the user checkout on a stale feature branch that (a) lacks a work item present on origin/main, (b) has a locally modified work item, and (c) has a work item deleted from origin/main but still present locally -- the daemon processes exactly the origin/main set in all three cases.
- Integration: fresh repo with no `origin/main` -- daemon refuses to start with the precondition error; once the user pushes, the next start succeeds.
- Regression: existing orchestrator and parser tests pass.
- Lint: search the codebase to confirm no remaining `readdirSync`/`readFileSync` paths target `.ninthwave/work/` from the project root in the daemon hot path.

Acceptance: `listWorkItems` (or its successor) reads work item filenames and contents from `origin/main` via `git ls-tree` and `git show`, with no filesystem reads of `.ninthwave/work/` in the daemon hot path. `getCleanRemoteWorkItemFiles` is removed (or collapses to a thin "list files on origin/main" helper) and the working-tree-vs-origin diff filter is gone. `config.json` is read from `origin/main`; `config.local.json` is the only file still read from the working tree. Daemon startup and every work-item read fail loudly with an actionable message when `origin/main` does not resolve, and `nw init` fails until the user has pushed. A user can run `nw` against a project while their main checkout is on any branch, dirty, stale, or has locally edited `.ninthwave/work/*.md` files, and the daemon's behavior is identical to a fresh checkout of main. All existing tests pass; new tests cover the origin-only reader, the precondition failure, and the stale-checkout integration scenarios.

Key files: `core/work-item-files.ts`, `core/git.ts`, `core/parser.ts`, `core/commands/orchestrate.ts`, `core/commands/init.ts`, `core/daemon.ts`, `core/orchestrate-event-loop.ts`, `test/`
