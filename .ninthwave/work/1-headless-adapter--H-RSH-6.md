# Feat: Wire headless detection and launch dispatch (H-RSH-6)

**Priority:** High
**Source:** Plan: Remove Send-Keys & Add Headless Adapter (eng-reviewed 2026-04-01)
**Depends on:** H-RSH-3, H-RSH-4, H-RSH-5
**Domain:** headless-adapter

Wire the HeadlessAdapter into the detection and launch paths:

1. core/mux.ts detectMuxType: change the final fallback from throwing an error to returning "headless". Add "headless" as a valid value for the NINTHWAVE_MUX env override.

2. core/mux.ts checkAutoLaunch: remove the error paths for "nothing-installed" and "cmux-not-in-session". Always return { action: "proceed" } since headless is always available.

3. core/mux.ts createMux (or equivalent factory): add a "headless" case that instantiates HeadlessAdapter.

4. core/commands/launch.ts launchAiSession: when mux.type is "headless", use profile.buildHeadlessCmd instead of profile.buildLaunchCmd. The rest of the flow (launchWorkspace call, return ref) is the same.

**Test plan:**
- Test detectMuxType returns "headless" when no CMUX_WORKSPACE_ID, no $TMUX, no tmux binary, no cmux binary
- Test detectMuxType accepts NINTHWAVE_MUX=headless override
- Test checkAutoLaunch always returns { action: "proceed" } in all scenarios
- Test createMux returns HeadlessAdapter for "headless" type
- Test launchAiSession dispatches to buildHeadlessCmd when mux.type is "headless"
- Test launchAiSession dispatches to buildLaunchCmd when mux.type is "tmux" or "cmux"

Acceptance: Running nw without tmux/cmux installed no longer errors. detectMuxType returns "headless" as fallback. Headless workers are spawned via HeadlessAdapter. All tests pass.

Key files: `core/mux.ts`, `core/commands/launch.ts`, `test/mux.test.ts`, `test/launch.test.ts`
