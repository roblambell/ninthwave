# Feat: Persist remote crew state into daemon and status views (M-CRS-3)

**Priority:** Medium
**Source:** Decomposed from crew remote state follow-up on 2026-04-01
**Depends on:** H-CRS-2
**Domain:** crew-coordination

Extend the persisted daemon/status model so `nw status` and status-watch render the same remote truth as the live TUI. Store broker-derived remote item snapshots, ownership metadata, and enough display fields to avoid reintroducing local state inference in the non-live status paths.

**Test plan:**
- Add daemon serialization tests for remote item snapshot fields and crew ownership metadata.
- Add `status` rendering tests for remote queued, implementing, and review states coming from persisted daemon data.
- Cover the edge case where a remote item disappears from broker updates and the persisted status view clears the stale snapshot on the next write.

Acceptance: daemon state persists broker-derived remote item snapshots, `nw status` and status-watch render remote item state from persisted broker truth, and no status path falls back to the old claimed-only heuristic.

Key files: `core/daemon.ts`, `core/commands/status.ts`, `core/status-render.ts`, `test/status.test.ts`, `test/orchestrate.test.ts`
