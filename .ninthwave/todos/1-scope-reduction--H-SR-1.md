# Refactor: Remove supervisor feature (H-SR-1)

**Priority:** High
**Source:** Scope reduction -- supervisor is redundant with /work skill and adds LLM cost
**Depends on:** None
**Domain:** scope-reduction

Remove the supervisor feature entirely. The supervisor was a separate LLM session that monitored the orchestration pipeline for anomalies and sent nudge messages to stuck workers. It is being removed because the daemon handles all state transitions deterministically and the /work skill provides equivalent LLM oversight when desired.

**Test plan:**
- Run `bun test test/` -- all tests pass after removal
- Verify `nw orchestrate --help` no longer mentions --supervisor or --supervisor-interval
- Grep codebase for "supervisor", "Supervisor", "SUPERVISOR" -- no orphaned references in source (friction logs and git history are fine)
- Verify interactive flow works without supervisor step: item selection -> merge strategy -> WIP limit -> summary

Acceptance: All supervisor code, tests, agent prompt, CLI flags, and integration points are removed. Tests pass. No dead imports or orphaned references.

Key files:
- DELETE `core/supervisor.ts` (isDogfoodingMode, shouldActivateSupervisor)
- DELETE `agents/supervisor.md` (agent prompt)
- DELETE `test/supervisor.test.ts`
- `core/commands/orchestrate.ts` -- remove: import of shouldActivateSupervisor (line 41-42), sendSupervisorEvent function (lines 1122-1143), buildSupervisorHeartbeat function (lines 1148-1163), supervisor heartbeat tracking (lines 1179-1181), prevScreenHealth map and supervisor health-change block (lines 1214, 1338-1354), supervisor event sends on transitions (lines 1384-1427), supervisor heartbeat block (lines 1438-1449), --supervisor and --supervisor-interval flag parsing (lines 1593-1594, 1638-1643), interactive result supervisor assignment (line 1790), supervisor activation/launch/recovery block (lines 1954-2013), supervisorSessionRef in serializeOrchestratorState calls (lines 2042, 2051), supervisor config in loopConfig (line 2132), supervisor cleanup in finally block (lines 2161-2174), supervisorSessionRef and supervisorHeartbeatMs from OrchestrateLoopConfig interface (lines 1092-1095), launchSupervisorSession from start.ts import (line 28), comment on line 5
- `core/commands/start.ts` -- remove entire supervisor section (lines 688-827): SUPERVISOR_AGENT_TARGETS, seedSupervisorAgent, SupervisorContext, buildSupervisorInitialMessage, launchSupervisorSession. Keep sendWithReadyWait import (used by regular worker launch at line 233)
- `core/daemon.ts` -- remove supervisorSessionRef from DaemonState interface (line 48) and serializeOrchestratorState extras parameter (line 324)
- `core/interactive.ts` -- remove supervisor from InteractiveResult (line 19), delete promptSupervisor function (lines 241-249), remove supervisor from confirmSummary display (lines 270-272), remove supervisor step from runInteractiveFlow (lines 304-305), remove supervisor from result object (line 312), renumber Step 5 to Step 4
- `core/commands/setup.ts` -- remove "supervisor.md" from AGENT_SOURCES (line 242) and AGENT_DESCRIPTIONS (line 249)
- `skills/work/SKILL.md` -- remove supervisor mode section (lines 134-140), supervisor flag in orchestrate command (lines 157-164), supervisor_event log reference (line 192)
- `ARCHITECTURE.md` -- remove Supervisor Architecture section (lines 181-212)
- `test/interactive.test.ts` -- remove promptSupervisor tests (lines 249-271), supervisor in runInteractiveFlow tests (lines 310, 317, 341, 347)
- `test/setup.test.ts` -- remove supervisor.md references (lines 86, 314, 406, 414, 420, 506, 515, 517, 617, 842-859, 908, 1369, 1511, 1516-1521)
