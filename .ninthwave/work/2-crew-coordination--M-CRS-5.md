# Test: Add cross-repo crew-state regression coverage (M-CRS-5)

**Priority:** Medium
**Source:** Decomposed from crew remote state follow-up on 2026-04-01
**Depends on:** M-CRS-3, M-CRS-4
**Domain:** crew-coordination

Lock down the end-to-end behavior once both repos are updated. The regression suite should cover broker-fed remote state flowing into nthwave live rendering and persisted status, with explicit assertions for the cases that previously lied to the user.

**Test plan:**
- Add scenario coverage for a remote item actively implementing, a remote item waiting in review, and a remote item returning to queued after release.
- Verify live TUI mapping and persisted status mapping both agree on the same remote state snapshot.
- Cover the edge case where two daemons race and the last broker update wins without leaving stale remote state behind locally.

Acceptance: regression coverage fails if nthwave reverts to claimed-only remote rendering, and the end-to-end suite proves remote implementing/review/queued states stay truthful across broker sync, live TUI, and persisted status views.

Key files: `test/scenario/crew-coordination.test.ts`, `test/orchestrate.test.ts`, `test/status-render.test.ts`, `test/status.test.ts`
