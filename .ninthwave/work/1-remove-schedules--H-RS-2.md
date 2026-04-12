# Refactor: Delete remaining schedule modules and docs (H-RS-2)

**Priority:** High
**Source:** CEO review -- scheduled task functionality unused, adds complexity beyond core wedge
**Depends on:** H-RS-1
**Domain:** remove-schedules
**Lineage:** d0563574-ba2b-4779-b428-24a1f497d9ac

Delete the remaining schedule-specific code and documentation now that shared-module integration is gone. Schedule test files were deleted in H-RS-1 follow-up work to restore green CI after the shared exports were removed. Update README.md to remove the paragraph about scheduled work.

Files to delete:
- `core/schedule-eval.ts` (262 lines)
- `core/schedule-runner.ts` (321 lines)
- `core/schedule-processing.ts` (291 lines)
- `core/schedule-state.ts` (108 lines)
- `core/schedule-files.ts` (214 lines)
- `core/schedule-history.ts` (130 lines)
- `core/commands/schedule.ts` (408 lines)
- `.ninthwave/schedule-format.md`
- `core/docs/schedule-format.md`

Files to edit:
- `README.md` -- remove the "Separately, I use scheduled Ninthwave work..." paragraph from "How I use it" section

**Test plan:**
- `bun run test` passes cleanly (all schedule tests deleted, no remaining references)
- `nw init` in a temp directory does not create `.ninthwave/schedules/`
- Verify no remaining imports of deleted modules after module removal: `grep -r "schedule" core/ --include="*.ts"` returns zero hits (excluding comments/changelog)

Acceptance: No schedule-related files exist in core/, test/, or .ninthwave/. README describes only the decompose-and-orchestrate workflow. `bun run test` passes. `grep -r "from.*schedule" core/` returns nothing.

Key files: `core/schedule-eval.ts`, `core/schedule-runner.ts`, `core/schedule-processing.ts`, `core/schedule-state.ts`, `core/schedule-files.ts`, `core/schedule-history.ts`, `core/commands/schedule.ts`, `README.md`
