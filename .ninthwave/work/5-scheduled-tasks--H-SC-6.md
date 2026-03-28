# Feat: Execution history and observability (H-SC-6)

**Priority:** High
**Source:** Scheduled tasks feature plan (CEO + Eng reviewed 2026-03-28)
**Depends on:** H-SC-3, H-SC-4
**Domain:** scheduled-tasks

Add execution history logging, `nw schedule history` subcommand, and TUI status display for running schedule workers.

1. Execution history (in `core/schedule-runner.ts`):
   - Append-only JSONL at `~/.ninthwave/projects/{slug}/schedule-history.jsonl`
   - Each entry: `{ taskId, startedAt, endedAt, result: "success"|"timeout"|"error", durationMs, daemonId? }`
   - Write entry on worker completion, timeout, or crash (in monitorScheduleWorkers)

2. Add `history` subcommand to `core/commands/schedule.ts`:
   - `nw schedule history <id>` -- show recent execution history for a task. Read JSONL, filter by taskId, display in a table: date, duration, result. Show last 20 entries by default.
   - `nw schedule history` (no id) -- show recent history across all tasks, sorted by time.

3. TUI status display (in `core/status-render.ts` or orchestrate.ts sync display):
   - When schedule workers are active, show a status line: `[sched] daily-tests -- running (2m 14s)`
   - Integrate with the existing `syncWorkerDisplay` pattern in the orchestrate loop

4. Structured daemon log events (extend the structured logging in orchestrate.ts):
   - `schedule-triggered`: taskId, triggerType (cron/manual), scheduleTime
   - `schedule-skipped`: taskId, reason (already-running, wip-full-queued, crew-denied, disabled)
   - `schedule-completed`: taskId, durationMs, result
   - `schedule-error`: taskId, error message

**Test plan:**
- Test JSONL history writing: write entry on success, write entry on timeout, write entry on error, read and filter by taskId
- Test `nw schedule history <id>` output format
- Test structured log events are emitted at correct points (mock log function, verify event types and fields)

Acceptance: `nw schedule history daily-tests` shows a table of past executions with dates, durations, and results. The TUI shows running schedule workers inline. Daemon logs contain structured events for every schedule lifecycle transition.

Key files: `core/schedule-runner.ts`, `core/commands/schedule.ts`, `core/status-render.ts`, `core/commands/orchestrate.ts`
