# Fix: Deduplicate daemon state transition events (M-EVT-1)

**Priority:** Medium
**Source:** Friction log (2026-03-27 supervisor friction — duplicate item-merged events)
**Domain:** daemon

The orchestrator daemon emits duplicate `item-merged` events when an item's merged state is detected on consecutive poll cycles. The supervisor and analytics consumer see redundant events, adding noise to monitoring and friction detection.

**Root cause:** `processTransitions` emits state-change events on every poll cycle where the state matches, rather than only on the transition edge. The `transition()` method in `core/orchestrator.ts` likely doesn't guard against re-entering the same state.

**Fix:**
1. In `Orchestrator.transition()`, add a guard: if `item.state === newState`, skip the transition and don't emit events.
2. Alternatively, add a `lastEmittedState` field on `OrchestratorItem` and only emit events when the state actually changes.
3. Verify that `handlePrLifecycle`'s merged detection path doesn't call `transition("merged")` on every poll after the item is already merged.

Acceptance: Each state transition emits exactly one event. Duplicate `item-merged` events are eliminated. Existing orchestrator and state machine tests pass. Analytics event counts match unique transitions.

**Test plan:** Add a test to `test/orchestrator.test.ts` that runs two consecutive `processTransitions` calls with the same merged snapshot and verifies only one `item-merged` event is emitted.

Key files: `core/orchestrator.ts`, `core/commands/orchestrate.ts`, `test/orchestrator.test.ts`
