# Fix: Preserve known PR state through snapshot and restart recovery (H-PRR-1)

**Priority:** High
**Source:** Decomposed from orchestrator PR recovery bug plan 2026-04-01
**Depends on:** None
**Domain:** worker-reliability

Fix the `nw watch` recovery path so an item does not fall back to raw `implementing` after the orchestrator has already learned its PR number. Update snapshot assembly to reuse tracked `prNumber` when GitHub temporarily returns empty or `no-pr`, and update restart reconstruction to keep the item in PR-tracking flow when daemon state already knows the PR. Keep the change limited to snapshot/reconstruct recovery and regression tests; do not add heartbeat stickiness or broader PR archaeology in this item.

**Test plan:**
- Add `buildSnapshot` coverage for an implementing item with existing `orchItem.prNumber` when `checkPr` returns `null` or `no-pr`, and verify the snapshot preserves `prNumber` with synthetic `prState` `open`
- Add `buildSnapshotAsync` parity coverage for the same fallback when async PR lookup returns empty or `null`
- Add `reconstructState` tests proving daemon-state `prNumber` restores `ci-pending` instead of `implementing` when `checkPr` returns empty or `no-pr`
- Re-run existing merged/title-collision recovery coverage to verify already-tracked PR numbers still resolve correctly after the fallback change

Acceptance: `core/snapshot.ts` and `core/reconstruct.ts` preserve already-known PR tracking when GitHub PR polling is temporarily blind. An item with known `prNumber` no longer regresses to `implementing` solely because `checkPr` returned empty or `no-pr`. Targeted snapshot and restart recovery regressions pass, and existing merge-detection coverage remains green.

Key files: `core/snapshot.ts`, `core/reconstruct.ts`, `test/contract/build-snapshot.test.ts`, `test/async-snapshot.test.ts`, `test/orchestrate.test.ts`, `test/merge-detection.test.ts`
