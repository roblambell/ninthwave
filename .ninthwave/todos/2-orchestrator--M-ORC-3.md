# Feat: Relay trusted PR comments to workers (M-ORC-3)

**Priority:** Medium
**Source:** Friction log: pr-comments-not-relayed-to-workers.md (2026-03-27)
**Depends on:** None
**Domain:** orchestrator

PR comments from trusted collaborators (OWNER, MEMBER, COLLABORATOR) are never relayed to workers. The orchestrator has sendMessage infrastructure and watch.ts has comment polling patterns, but they are not wired together in the orchestrator tick.

Add a comment polling step to the orchestrator's per-item evaluation. For items with open PRs in WIP states, periodically check for new comments from trusted collaborators using the GitHub API (reuse the `TRUSTED_ASSOC` jq filter pattern from `core/commands/watch.ts`). Track a `lastCommentCheck` timestamp per item to avoid duplicate relays. When new trusted comments are found, relay them to the worker via `sendMessage`. For comments that match actionable patterns like "rebase", the orchestrator can handle the action directly (it already has daemonRebase capability).

**Test plan:**
- Unit test: new trusted comment detected -> sendMessage action generated with comment content
- Unit test: untrusted comment (NONE association) -> no action generated
- Unit test: previously-seen comments (before lastCommentCheck) -> no duplicate relay
- Unit test: "rebase" keyword in comment -> daemon-rebase action generated instead of relay
- Verify comment polling does not run for items without a prNumber

Acceptance: Trusted collaborator comments on PRs are relayed to workers via sendMessage. Comments are not relayed more than once. Actionable "rebase" comments trigger daemon-rebase directly. Tests pass.

Key files: `core/orchestrator.ts`, `core/gh.ts`, `core/commands/watch.ts:96`, `test/orchestrator-unit.test.ts`
