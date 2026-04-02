# Feat: Gate orchestrator side effects while paused (H-TPAU-3)

**Priority:** High
**Source:** Spec `.opencode/plans/1775081194442-witty-star.md`
**Depends on:** H-TPAU-1, H-TPAU-4
**Domain:** pause-orchestrator
**Lineage:** 0a3a5179-4589-4d8c-82ea-8d4f6bca1a90

Implement the actual pause semantics in the main watch loop so the dashboard keeps updating while no new orchestration side effects fire. While paused, keep polling, snapshots, logs, and running workers alive, but buffer watch-mode intake, suppress launches and other orchestrator actions, and skip schedule or external-review side effects until resume. On resume, re-derive valid work from the latest state instead of replaying stale buffered action objects.

**Test plan:**
- Add `test/orchestrate.test.ts` coverage proving polling and rendering continue while paused but launches, merges, reviews, rebases, and other side effects do not execute
- Add watch-mode coverage that newly discovered work items stay buffered during pause and are enrolled only after resume
- Verify resume recomputes valid actions from fresh state, executes them once, and does not duplicate work after multiple paused poll cycles

Acceptance: While paused, the interactive watch loop continues to refresh state but does not launch or advance new side effects, and newly discovered watch work does not enter the orchestrator yet. Resuming processes buffered intake and only executes currently valid actions once, without duplicate launches or stale replay behavior.

Key files: `core/commands/orchestrate.ts`, `test/orchestrate.test.ts`
