# Fix merged-item metadata enrichment and restart recovery (H-PMV-1)

**Priority:** High
**Source:** Decomposed from premature `verifying` -> `done` investigation plan 2026-04-01
**Depends on:** None
**Domain:** post-merge-verification

Build the metadata foundation for reliable post-merge verification. Extend merged-item snapshots so polling can backfill `mergeCommitSha` and the repository default branch for items that were merged by the orchestrator or externally on GitHub, even when the merge commit is not visible on the first poll.

Limit this item to snapshot/recovery plumbing: add the new merged-item fields in `core/orchestrator-types.ts`, add a small default-branch lookup helper in `core/gh.ts`, enrich `merged` items in `core/snapshot.ts`, and make `core/reconstruct.ts` preserve a recoverable waiting state when an item restarts in `merged` without a `mergeCommitSha`. Do not change the orchestrator's `merged -> done` transition rules yet.

**Test plan:**
- Add `buildSnapshot` coverage for a merged item whose first poll lacks `mergeCommit.oid` and verify the snapshot keeps the item in a recoverable merged state instead of dropping post-merge metadata
- Add coverage for externally merged PRs so merged snapshots can pick up `mergeCommitSha` and default-branch information during later polls
- Add restart/reconstruction tests proving a merged item without `mergeCommitSha` remains resumable after daemon restart
- Run `bun test test/contract/build-snapshot.test.ts test/merge-detection.test.ts test/orchestrate.test.ts --smol --bail`

Acceptance: `core/snapshot.ts` can enrich merged items with best-effort `mergeCommitSha` and default-branch metadata, `core/reconstruct.ts` preserves merged waiting state across restart, and merged items no longer depend on a one-shot merge SHA lookup at merge time to remain recoverable.

Key files: `core/snapshot.ts`, `core/orchestrator-types.ts`, `core/gh.ts`, `core/reconstruct.ts`, `test/contract/build-snapshot.test.ts`, `test/merge-detection.test.ts`, `test/orchestrate.test.ts`
