# Feat: Consume broker remote state in live crew rendering (H-CRS-2)

**Priority:** High
**Source:** Decomposed from crew remote state follow-up on 2026-04-01
**Depends on:** H-CRS-1
**Domain:** crew-coordination

Thread enriched broker item snapshots through the nthwave crew client and live orchestrator rendering path. Replace the current boolean remote heuristic with broker-provided state, owner, and item metadata so the live TUI shows the same truth another daemon is reporting. Make this a clean cut and remove the old fallback override rather than layering another display heuristic on top.

**Test plan:**
- Add parsing tests for enriched `crew_update` payloads in `core/crew.ts`, including claimed implementing and review-state items.
- Add rendering tests proving remote queued, implementing, and review rows map from broker state instead of local inferred state.
- Cover the edge case where a remote item changes owner and the local daemon updates suppression/rendering on the next broker update.

Acceptance: `core/crew.ts` exposes broker-derived remote item snapshots, `core/commands/orchestrate.ts` consumes them for live crew rendering, and the TUI shows correct remote queued/implementing/review states without the old forced-implementing override.

Key files: `core/crew.ts`, `core/commands/orchestrate.ts`, `core/status-render.ts`, `test/crew-connect.test.ts`, `test/orchestrate.test.ts`, `test/status-render.test.ts`
