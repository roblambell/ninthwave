# Refactor: Add deterministic AI launch override seam (H-TEST-1)

**Priority:** High
**Source:** Spec `.opencode/plans/1775087486017-cosmic-garden.md`
**Depends on:** None
**Domain:** deterministic-ai-launch
**Lineage:** 2260d5ca-76af-47df-8ed8-b6d2c2253ac8

Introduce a first-class launch override contract at the shared AI launch boundary so tests can replace real provider CLIs with a deterministic command. Keep the default behavior unchanged and thread the override cleanly through the existing implementer, reviewer, rebaser, and fix-forward launch paths. The goal is to create one supported seam in production code instead of relying on PATH shadowing or per-tool hacks.

**Test plan:**
- Extend `test/ai-tools.test.ts` to cover override-aware `buildLaunchCmd` and `buildHeadlessCmd` behavior for at least one real tool profile plus the no-override path
- Extend `test/launch.test.ts` to verify `launchAiSession()` passes the override context through shared launch plumbing without breaking existing worker roles
- Verify reviewer, rebaser, and forward-fixer launches still inherit the expected tool, agent, prompt, and state context when no override is set

Acceptance: A shared override contract exists in the AI launch path, default launches remain byte-for-byte compatible when the override is absent, and tests prove the seam can be used by all orchestrator worker types.

Key files: `core/ai-tools.ts`, `core/commands/launch.ts`, `test/ai-tools.test.ts`, `test/launch.test.ts`
