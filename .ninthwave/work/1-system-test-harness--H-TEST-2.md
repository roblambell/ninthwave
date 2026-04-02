# Test: Build deterministic fake worker and system harness (H-TEST-2)

**Priority:** High
**Source:** Spec `.opencode/plans/1775087486017-cosmic-garden.md`
**Depends on:** H-TEST-1
**Domain:** system-test-harness
**Lineage:** 5838f7d0-c362-48ad-8269-ae24e7f8ab0f

Add the reusable test infrastructure that will power the new orchestrator system suite. This includes a deterministic fake AI worker script, scenario description helpers, CLI spawning helpers, and file/log assertions for headless worker runs. The harness should make success, failure, hang, and secondary-worker scenarios easy to script without duplicating setup across tests.

**Test plan:**
- Add focused helper coverage that proves the fake worker receives item, tool, agent, prompt, and state context from the launch override seam
- Verify the harness can script success, non-zero exit, and hang behavior and that headless logs and state artifacts are captured deterministically
- Smoke-test temp repo setup plus CLI invocation so later `test/system/*` files can build on one stable helper layer

Acceptance: The repo has a reusable deterministic fake worker and system harness that can launch scripted headless runs, capture runtime artifacts, and drive later CLI/system tests without ad hoc setup.

Key files: `test/bin/fake-ai-worker.sh`, `test/system/helpers/cli-harness.ts`, `test/system/helpers/fake-ai-scenario.ts`, `test/system/helpers/fake-terminal.ts`, `test/helpers.ts`
