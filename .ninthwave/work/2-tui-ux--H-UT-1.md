# Refactor: Remove analytics JSON, state archive, and friction auto-commit (H-UT-1)

**Priority:** High
**Source:** Unified TUI plan -- Phase 1 cleanup
**Depends on:** None
**Domain:** tui-ux

Remove all unnecessary file outputs from the orchestration pipeline. Stop writing .ninthwave/analytics/*.json files -- instead log the full RunMetrics object as a run_metrics structured log event in orchestrator.log. Rewrite nw analytics to read run_metrics events from the JSONL log (including rotated files .1/.2/.3). Remove archiveStateFile() and stateArchiveDir() from daemon.ts, and rewrite nw history to reconstruct timelines from structured log transition events. Remove health-samples.jsonl from RUNTIME_STATE_FILES (vestigial, no writer). Remove commitAnalyticsFiles() and commitFrictionFiles() from analytics.ts and their call sites in orchestrate.ts. Add .ninthwave/analytics/ to .gitignore.

**Test plan:**
- Update test/analytics.test.ts: remove writeRunMetrics, commitAnalyticsFiles, commitFrictionFiles tests. Add tests for log-based loadRuns() parsing run_metrics events from JSONL (happy path, empty log, malformed lines, rotated files)
- Update test/daemon.test.ts: remove archiveStateFile and state-archive migration tests, remove health-samples.jsonl migration test
- Add tests for log-based loadSnapshots() in history command (reconstruct timeline from transition events, empty log, unknown item ID)
- Verify orchestrate.test.ts still passes with analyticsDir/analyticsIO/analyticsCommit removed from deps

Acceptance: No .ninthwave/analytics/*.json files written after orchestration runs. nw analytics reads from orchestrator.log and shows correct trend data. nw history reconstructs item timelines from log events. No state-archive/ directory created on daemon startup. No auto-commit of analytics or friction files. bun test test/ passes.

Key files: `core/analytics.ts`, `core/commands/orchestrate.ts`, `core/commands/analytics.ts`, `core/commands/history.ts`, `core/daemon.ts`, `core/help.ts`, `test/analytics.test.ts`, `test/daemon.test.ts`
