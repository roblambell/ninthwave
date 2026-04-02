# Test: Fill operator-side TUI coverage gaps (H-TEST-6)

**Priority:** High
**Source:** Spec `.opencode/plans/1775087486017-cosmic-garden.md`
**Depends on:** None
**Domain:** operator-tui-tests
**Lineage:** c6ed4d35-fc63-446b-a6be-a6a4dad595e7

Complete the remaining operator-side TUI coverage using the existing in-process session seams. Focus on `runInteractiveWatchOperatorSession()`, `runTUI()`, and recovery-key parsing paths that are still under-tested, including managed vs unmanaged terminal modes, malformed transport input, control rebinding across restarts, and read-only TUI polling behavior. This item should close the direct TUI gaps that do not need the fake worker harness.

**Test plan:**
- Extend `test/orchestrate.test.ts` to cover `runInteractiveWatchOperatorSession()` with `manageTerminal: false`, `manageKeyboard: false`, malformed stdout after readiness, and repeated restart/control-binding cleanup paths
- Add direct coverage for `runTUI()` and `waitForEngineRecoveryKey()` so alt-screen entry/exit, signal abort, log refresh, and key parsing are verified deterministically
- Verify unmanaged terminal modes do not toggle raw mode or alt-screen and managed modes still restore terminal state after completion or disconnect

Acceptance: The operator-side TUI path has direct deterministic coverage for its remaining terminal-management, transport-edge, and recovery-input branches, including read-only TUI runner behavior.

Key files: `core/commands/orchestrate.ts`, `test/orchestrate.test.ts`, `test/status-render.test.ts`, `test/tui-keyboard.test.ts`
