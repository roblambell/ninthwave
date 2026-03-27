# Friction: PR comments from trusted collaborators not relayed to workers

**Observed:** 2026-03-27
**Project:** strait (ninthwave-sh/strait)
**Severity:** Medium
**Component:** orchestrator PR monitoring / cmux send

## What happened

User left "you need to rebase" comments on both PR #23 (M-V2-4) and PR #28 (L-V2-5). The orchestrator never relayed these comments to the workers via `cmux send`. The workers had no idea they needed to take action.

The SKILL.md documents that the orchestrator should relay review feedback from trusted collaborators to workers, and that `cmux send` is the mechanism. No `cmux send` actions appear anywhere in the daemon log.

## Expected behavior

The orchestrator should:
1. Poll for new PR comments on items in `ci-pending`, `ci-passed`, or `stuck` states
2. Identify comments from trusted collaborators (repo members/owners)
3. Relay actionable comments to the appropriate worker via `cmux send`
4. For "rebase" comments specifically, the orchestrator could handle the rebase itself (as it already has `daemon-rebase` capability) instead of relaying

## Log evidence

No `cmux send` events appear in the full daemon log. The only communication actions are `daemon-rebase` (orchestrator doing the rebase itself) and `sync-stack-comments` (posting stack navigation comments).

## Suggested fix

Add a PR comment polling loop to the orchestrator's tick cycle. When new comments from trusted collaborators are detected, use `cmux send` to relay them to the worker session. For common actionable patterns like "rebase", the orchestrator could take the action directly.
