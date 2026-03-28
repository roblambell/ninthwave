# Review feedback relay is noisy and includes orchestrator's own comments

**Observed:** 2026-03-28
**Severity:** Medium
**Context:** Orchestrator relaying review feedback to workers

## What happened

Multiple issues with the review → worker feedback loop:

1. **Own comments relayed:** The orchestrator's `**[Orchestrator]** Status` comments get picked up and sent to the worker as "review feedback"
2. **Worker's own comments relayed:** The worker's `**[Worker: ID]** Addressed feedback` comment gets relayed back to the same worker
3. **Excessive noise:** Each review finding is relayed individually AND the full verdict is relayed, causing the worker to process the same information multiple times

## Recommended fix

1. Filter out `**[Orchestrator]**` and `**[Worker: *]**` prefixed comments when collecting review feedback
2. Only relay the final verdict/review event, not individual comment notifications
3. If using GitHub's native review API (inline comments + review body), just relay the review body
