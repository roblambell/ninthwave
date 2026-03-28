# Feat: Schedule CLI commands (H-SC-4)

**Priority:** High
**Source:** Scheduled tasks feature plan (CEO + Eng reviewed 2026-03-28)
**Depends on:** H-SC-1
**Domain:** scheduled-tasks

Add `nw schedule` command with subcommands: list, show, validate, run. Register in the command registry.

1. Create `core/commands/schedule.ts` with handler `cmdSchedule(args, projectRoot)`:
   - `nw schedule` (no args / `list`) -- list all schedule files with ID, schedule expression, domain, enabled status, and next-run time (e.g., "daily-tests -- every day at 09:00 -- next: tomorrow 09:00 (in 14h)"). Uses `nextRunTime()` from schedule-eval.ts. Disabled schedules shown with `[disabled]` tag.
   - `nw schedule show <id>` -- show full details of one schedule: title, schedule, priority, domain, timeout, enabled, prompt (truncated), next-run, last-run (from state file if available).
   - `nw schedule validate` -- parse all schedule files, report errors with filename and issue description. Exit 0 if all valid, exit 1 if any errors. Output format: `OK: ci--daily-tests.md` or `ERROR: ci--broken.md: missing Schedule field`.
   - `nw schedule run <id>` -- write a trigger file to `~/.ninthwave/projects/{slug}/schedule-triggers/{id}`. If no daemon is running (check PID file via `isDaemonRunning()` from daemon.ts), print error: "No daemon running. Start one with `nw watch`." If daemon is running, print "Trigger written. Daemon will pick it up next cycle (~30s)."

2. Register `schedule` command in `core/help.ts` command registry:
   - Name: `schedule`, Group: `diagnostic`, needsRoot: true, needsWork: false
   - Usage: `schedule [list|show <id>|validate|run <id>]`
   - Add import for `cmdSchedule`

**Test plan:**
- `test/schedule-command.test.ts`: list output with multiple schedules (verify next-run times shown), list with no schedules (empty message), show valid ID (all fields displayed), show invalid ID (error), validate all-valid (exit 0), validate with errors (exit 1 with details), run with daemon running (trigger file written), run without daemon (error message), run invalid ID (error)

Acceptance: `nw schedule` lists schedules with human-readable next-run times. `nw schedule validate` catches parse errors and reports them clearly. `nw schedule run <id>` writes trigger files for the daemon.

Key files: `core/commands/schedule.ts`, `core/help.ts`, `core/daemon.ts` (isDaemonRunning), `core/schedule-eval.ts` (nextRunTime), `test/schedule-command.test.ts`
