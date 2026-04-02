# Fix: Make inbox delivery targets explicit and safe (H-WIR-2)

**Priority:** High
**Source:** Spec `.opencode/plans/1775144464123-swift-wizard.md`
**Depends on:** H-WIR-1
**Domain:** inbox-delivery
**Lineage:** 6284cdd1-371c-4f58-8576-e8bc38d33911

Centralize how orchestrator actions resolve an implementer inbox target and make every delivery outcome observable in structured logs. Remove silent repo-root and hub-root fallbacks for review and generic worker nudges so messages either reach the live worktree namespace or fail in an explicit, debuggable way while preserving the current CI-failure relaunch path.

**Test plan:**
- Extend `test/orchestrator-unit.test.ts` to cover safe inbox-root resolution for CI failure, review feedback, rebase, and generic send-message actions
- Add assertions that review and generic messages no longer write to repo-root or hub-root fallback namespaces when no safe live worktree target exists
- Add cleanup coverage in `test/clean.test.ts` for best-effort removal of legacy inbox namespaces and any new delivery metadata side effects

Acceptance: Orchestrator inbox actions resolve a single explicit target for implementer delivery, structured logs record where each message was written or why it was not delivered, and review or generic nudges never silently land in the wrong namespace. CI failures keep the existing relaunch behavior when no safe live worker inbox target exists.

Key files: `core/orchestrator-actions.ts`, `core/commands/orchestrate.ts`, `test/orchestrator-unit.test.ts`, `test/clean.test.ts`
