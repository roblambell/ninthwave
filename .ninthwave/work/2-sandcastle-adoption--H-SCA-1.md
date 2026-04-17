# Docs: Spike -- validate sandcastle end-to-end for one work item (H-SCA-1)

**Priority:** High
**Source:** docs/sandcastle-adoption-plan.md Phase 0
**Depends on:** None
**Domain:** sandcastle-adoption
**Lineage:** e9ea2c63-f97c-4401-ab82-d42c8071207b
**Requires manual review:** true

Validate on a throwaway branch that sandcastle (@ai-hero/sandcastle) can replace ninthwave's worktree + launch plumbing for one real work item end-to-end. Confirm the host-credential mount pattern authenticates Claude Code via the user's existing subscription with no ANTHROPIC_API_KEY. Measure whether sandcastle's `interactive()` or `run()` is the right entry point for ninthwave's daemon model (given the reframe that live TUI attachment is no longer central). The deliverable is `docs/sandcastle-spike-findings.md` capturing what worked, what broke, and a gap list split into upstream-to-sandcastle, adapt-locally, and defer buckets. This doc gates decomposition of Phases 1-5 in the plan.

**Test plan:**
- Manual: pick one recently merged ninthwave work item from git history; replay it through a throwaway script that calls `sandcastle.createWorkspace()` + `createSandbox()` + (either `interactive()` or `run()`); confirm a branch with the expected commits is produced.
- Manual: on a Docker bind-mount provider, bind `~/.claude` (and any other Claude Code subscription credential files) into the container; verify the agent starts a session authenticated to the subscription with no API key env var set.
- Manual: diff the sandcastle-produced branch against what ninthwave's current `core/commands/launch.ts` path would have produced for the same item (commit count, commit message shape, file scope); note any divergence in the findings doc.
- Manual: attempt two concurrent sandcastle runs, each on its own worktree, to confirm they do not interfere (port/partition, credential mount, filesystem).

Acceptance: `docs/sandcastle-spike-findings.md` is committed and answers explicitly: (1) did subscription auth via bind-mount work for Claude Code; (2) is `interactive()` or `run()` the correct entry point for ninthwave; (3) does commit extraction match ninthwave's expectations; (4) what sandcastle gaps exist, categorized as upstream / adapt-locally / defer; (5) a go / no-go recommendation for the bigger bet and a revised Phase 1 scope if needed. `docs/sandcastle-adoption-plan.md` is updated to reflect decisions taken from the spike. Any spike code that survives as a keeper is small, clearly scoped, and called out in the findings doc; all other spike code lives on a throwaway branch that is not merged.

Key files: `docs/sandcastle-spike-findings.md`, `docs/sandcastle-adoption-plan.md`, `package.json`, `core/commands/launch.ts`, `core/git.ts`
