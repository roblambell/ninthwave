# Feat: Schedule state tracking and solo-mode execution (H-SC-3)

**Priority:** High
**Source:** Scheduled tasks feature plan (CEO + Eng reviewed 2026-03-28)
**Depends on:** H-SC-1
**Domain:** scheduled-tasks

Wire scheduled task execution into the daemon's orchestrate loop for solo mode (no crew). This is the core runtime -- checking isDue(), launching workers, monitoring liveness, enforcing timeouts, and managing WIP-aware queueing.

1. Create `core/schedule-state.ts`:
   - Read/write `~/.ninthwave/projects/{slug}/schedule-state.json` via `userStateDir()` from `daemon.ts`
   - State tracks: per-task lastRunAt (ISO string), queued task IDs, active worker entries (taskId, workspaceRef, startedAt)
   - Handle corrupt JSON (reset to empty + warn). Handle missing file (return empty state).

2. Create `core/schedule-runner.ts`:
   - `checkSchedules(tasks, state, now)` -- returns tasks that are due (isDue=true, not already running, enabled)
   - `processScheduleQueue(state, wipSlots)` -- dequeue tasks when WIP slots are available. Scheduled tasks consume from the shared memory-aware WIP pool.
   - `launchScheduledTask(task, mux, aiTool)` -- create cmux workspace, launch AI worker with task prompt on main branch. Worker prompt template instructs the worker to commit work items to a branch and push.
   - `monitorScheduleWorkers(state, mux)` -- check workspace liveness via isWorkerAlive pattern. Kill workspace + record error on timeout. Record success on worker exit. Clean workspace after.

3. Integrate into `core/commands/orchestrate.ts` at line ~1530 (after crew sync, before buildSnapshot):
   - Add schedule-related fields to `OrchestrateLoopDeps` (listScheduledTasks, scheduleState read/write, launchScheduledTask, monitorScheduleWorkers)
   - Gated by 30s interval check (`lastScheduleCheckMs`)
   - Check for trigger files in `~/.ninthwave/projects/{slug}/schedule-triggers/` (written by `nw schedule run`)
   - Log structured events: `schedule-triggered`, `schedule-skipped` (with reason), `schedule-completed`, `schedule-error`
   - Update `lastRunAt` in state file BEFORE launching worker (double-fire prevention; uses scheduled fire time, not poll time)

4. Add `schedule_enabled` to `KNOWN_CONFIG_KEYS` in `core/config.ts`.

**Test plan:**
- `test/schedule-runner.test.ts`: checkSchedules returns due tasks and skips disabled/already-running, processScheduleQueue launches when WIP available and queues when full, launchScheduledTask creates workspace (mock mux), monitorScheduleWorkers detects completion/timeout/crash (mock mux), trigger file processing (write file -> picked up -> deleted), double-fire prevention (lastRunAt updated before launch), integration test with mock deps showing full cycle (due -> launch -> monitor -> complete -> history)
- Verify WIP queueing: fill WIP with mock work items, fire schedule, confirm queued, free slot, confirm launched

Acceptance: A schedule file with `every 1m` fires within ~90s of daemon start. Workers are monitored and cleaned up on completion/timeout. WIP-full schedules queue and execute when slots open. Trigger files from `nw schedule run` are processed and cleaned up.

Key files: `core/schedule-state.ts`, `core/schedule-runner.ts`, `core/commands/orchestrate.ts:1530`, `core/config.ts`, `core/daemon.ts` (userStateDir), `test/schedule-runner.test.ts`
