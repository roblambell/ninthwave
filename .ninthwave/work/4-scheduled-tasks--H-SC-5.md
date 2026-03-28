# Feat: Crew mode schedule claims (H-SC-5)

**Priority:** High
**Source:** Scheduled tasks feature plan (CEO + Eng reviewed 2026-03-28)
**Depends on:** H-SC-3
**Domain:** scheduled-tasks

Add schedule_claim/schedule_claim_response message types to the crew protocol so only one daemon in a crew executes each scheduled task occurrence.

1. Add message types to `core/crew.ts`:
   - `ScheduleClaimMessage`: `{ type: "schedule_claim", requestId: string, daemonId: string, taskId: string, scheduleTime: string }`
   - `ScheduleClaimResponseMessage`: `{ type: "schedule_claim_response", requestId: string, taskId: string, granted: boolean }`
   - Add to `ClientMessage` and `ServerMessage` union types
   - Add `scheduleClaim(taskId: string, scheduleTime: string): Promise<boolean>` to `CrewBroker` interface
   - Implement in `WebSocketCrewBroker`: send schedule_claim, await schedule_claim_response with timeout (reuse existing CLAIM_TIMEOUT_MS pattern)

2. Add handler to `core/mock-broker.ts`:
   - Track claimed keys in a `Map<string, { daemonId: string, expiresAt: number }>` (key = `taskId:scheduleTime`)
   - On schedule_claim: check if key exists and not expired. If unclaimed, grant and store with expiry = now + task timeout (default 30 min). If already claimed, deny.
   - Periodic cleanup of expired keys (piggyback on existing heartbeat check interval)
   - Prefer daemons with available WIP capacity when multiple claim simultaneously (check daemon's claimed item count)

3. Update `core/schedule-runner.ts`: In crew mode, call `crewBroker.scheduleClaim(taskId, scheduleTime)` before launching. The scheduleTime is the cron's computed fire time (not poll time) to ensure all daemons generate the same key. If denied, skip (log `schedule-skipped` with reason `crew-denied`). If WS disconnected, fall back to solo execution (log warning).

**Test plan:**
- Extend `test/mock-broker.test.ts`: first daemon claims schedule -> granted, second daemon claims same key -> denied, claim key expires after timeout -> re-claimable, WS disconnect during claim -> timeout error
- Extend `test/schedule-runner.test.ts`: crew mode claim granted -> launch, crew mode claim denied -> skip, crew disconnected -> fallback to solo

Acceptance: In a 2-daemon crew, a schedule fires on both daemons but only one executes (the other is denied by the broker). Disconnected daemons fall back to solo execution.

Key files: `core/crew.ts`, `core/mock-broker.ts`, `core/schedule-runner.ts`, `test/mock-broker.test.ts`, `test/schedule-runner.test.ts`
