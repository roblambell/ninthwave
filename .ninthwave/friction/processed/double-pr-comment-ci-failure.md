# Friction: Orchestrator posts duplicate CI failure comments on PR

**Observed:** 2026-03-27
**Project:** strait (ninthwave-sh/strait)
**Severity:** Medium
**Component:** orchestrator PR comment posting

## What happened

The orchestrator posted the same comment twice on H-CP-20's PR:

```
[Orchestrator] CI failure detected for H-CP-20. Worker notified.
[Orchestrator] CI failure detected for H-CP-20. Worker notified.
```

Both comments were posted by the same user, at the same time, with identical text.

## Expected behavior

Dedup PR comments before posting. Options:
1. **Check for existing identical comment** before posting — query recent comments, skip if the same text was posted within the last N minutes
2. **Use a comment ID/nonce** — include a state transition ID in the comment, and check if that transition was already commented on
3. **Edit existing comment** instead of posting a new one — update the previous orchestrator comment with the new state

Option 1 is simplest. The orchestrator should never post the same comment text twice in a row on the same PR.
