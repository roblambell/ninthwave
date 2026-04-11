# Refactor: Disconnect schedule integration from shared modules (H-RS-1)

**Priority:** High
**Source:** CEO review -- scheduled task functionality unused, adds complexity beyond core wedge
**Depends on:** None
**Domain:** remove-schedules
**Lineage:** 3707e2cc-9421-43c8-b59f-60eaaf7c2e96

Remove all references to schedule functionality from shared (non-schedule-specific) modules. After this change, the schedule-* modules become dead code that nothing imports, but still exist on disk. The build must pass with no schedule integration active.

Files to modify (remove schedule-related imports, types, wiring, and logic blocks):

- `core/orchestrate-event-loop.ts` -- remove `processScheduledTasks` import, `scheduleDeps`/`isScheduleExecutionEnabled` from `OrchestratorLoopDeps` interface, `lastScheduleCheckMs` state variable, and the 27-line schedule processing block (~lines 1064-1090)
- `core/commands/orchestrate.ts` -- remove schedule imports (~lines 55, 112-120, 148, 237), `resolveScheduleExecutionEnabled()`, `scheduleEnabled` state fields, `scheduleLoopDeps` wiring block (~lines 2340-2358), schedule deps injection (~lines 2390-2393), and all TUI schedule toggle handling (~40 lines scattered)
- `core/config.ts` -- remove `schedule_enabled` from ProjectConfig interface and defaults, remove `isProjectScheduleEnabled()` function, remove `schedule_enabled_projects` from UserConfig, remove related parsing/saving logic
- `core/tui-keyboard.ts` -- remove `scheduleEnabledToMode`/`scheduleModeToEnabled` imports, `scheduleEnabled`/`pendingScheduleEnabled` state, `onScheduleEnabledChange` callback, sync logic, and toggle handler
- `core/tui-settings.ts` -- remove `ScheduleEnabledMode` type, `SCHEDULE_ENABLED_OPTIONS`, schedule setting row, mode/label conversion functions
- `core/status-render.ts` -- remove `scheduleEnabledToMode` import and schedule toggle display logic
- `core/help.ts` -- remove schedule command import and registration block
- `core/commands/init.ts` -- remove `DEFAULT_SCHEDULE_FILES`, `.ninthwave/schedules/` directory creation, schedule format file copy, and related gitignore entries
- `core/types.ts` -- remove `ScheduledTask` interface
- `core/crew.ts` -- remove `ScheduleClaimMessage` and `ScheduleClaimResponseMessage` interfaces, remove from ClientMessage/ServerMessage unions, remove send/receive handlers and `pendingScheduleClaims` tracking
- `core/broker-server.ts` -- remove `schedule_claim` case in message dispatch and `handleScheduleClaim()` method
- `core/mock-broker.ts` -- remove `schedule_claim` case and mock `handleScheduleClaim()` method
- `core/broker-state.ts` -- remove `"schedule_claim"` from event union, `scheduleClaimExpiryMs` option, `claimScheduleSlot()` function, and cleanup logic
- `core/broker-store.ts` -- remove `ScheduleClaimEntry` interface, `scheduleClaims` map from `CrewState`, and serialization/deserialization logic

**Test plan:**
- `bun run test` passes with no schedule-related failures (schedule test files may show import errors -- that's expected since their imports will be dead, but they won't run if their targets don't exist)
- `bun run core/cli.ts --help` shows no schedule command
- TypeScript type-checks cleanly (no dangling references to removed types)

Acceptance: All 14 shared modules compile with zero references to schedule functionality. The schedule-* modules are dead code (unreachable). `bun run test:unit` passes (excluding schedule test files which will fail on missing exports -- that is expected and resolved in H-RS-2).

Key files: `core/orchestrate-event-loop.ts`, `core/commands/orchestrate.ts`, `core/config.ts`, `core/tui-keyboard.ts`, `core/tui-settings.ts`, `core/status-render.ts`, `core/help.ts`, `core/commands/init.ts`, `core/types.ts`, `core/crew.ts`, `core/broker-server.ts`, `core/mock-broker.ts`, `core/broker-state.ts`, `core/broker-store.ts`
