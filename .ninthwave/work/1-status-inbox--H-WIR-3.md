# Feat: Surface inbox state in daemon snapshots and status UI (H-WIR-3)

**Priority:** High
**Source:** Spec `.opencode/plans/1775144464123-swift-wizard.md`
**Depends on:** H-WIR-1, H-WIR-2
**Domain:** status-inbox
**Lineage:** 815d03da-3c33-457e-9d93-ed5659b6094f

Project the new inbox metadata into persisted daemon state and expose it in the operator status surfaces. Status and detail views should make it obvious whether a worker is blocked in `nw inbox --wait`, which namespace it is using, whether messages are queued, and when inbox activity last occurred.

**Test plan:**
- Extend daemon serialization coverage for the new inbox metadata fields carried through orchestrator state snapshots
- Add `test/status-render.test.ts` and `test/status.test.ts` coverage for pending-count, waiting-since, namespace, and last-activity rendering in row and detail views
- Verify status rendering remains stable when inbox metadata is absent, partially populated, or stale after worker cleanup

Acceptance: Persisted daemon state includes the inbox metadata needed to explain worker wait state and queue health, and the status UI renders that information without regressing existing row or detail layouts. Operators can tell from status whether a worker is waiting, whether messages are queued, and which namespace the worker is attached to.

Key files: `core/daemon.ts`, `core/status-render.ts`, `core/commands/orchestrate.ts`, `test/status-render.test.ts`, `test/status.test.ts`
