# Refactor: Rename repairer agent to rebaser (H-CS-5)

**Priority:** High
**Source:** Config simplification plan 2026-03-29
**Depends on:** None
**Domain:** orchestrator

Rename the "repairer" agent to "rebaser" throughout the codebase. The repairer only does rebases -- the current name is misleading.

File rename: `agents/repairer.md` -> `agents/rebaser.md`. Update frontmatter `name: ninthwave-rebaser`.

State rename: `"repairing"` -> `"rebasing"` in the orchestrator state machine. The status-render already maps this state to display "rebasing", so after the rename the mapping becomes identity.

Mechanical find-replace across all source and test files:

| Old | New |
|-----|-----|
| `"repairing"` (state) | `"rebasing"` |
| `repairWorkspaceRef` | `rebaserWorkspaceRef` |
| `repairAttemptCount` | `rebaseAttemptCount` |
| `maxRepairAttempts` | `maxRebaseAttempts` |
| `launchRepair` (dep) | `launchRebaser` |
| `cleanRepair` (dep) | `cleanRebaser` |
| `RepairLaunchResult` | `RebaserLaunchResult` |
| `launchRepairWorker` | `launchRebaserWorker` |
| `handleRepairing` | `handleRebasing` |
| `executeLaunchRepair` | `executeLaunchRebaser` |
| `executeCleanRepair` | `executeCleanRebaser` |
| `"launch-repair"` (action) | `"launch-rebaser"` |
| `"clean-repair"` (action) | `"clean-rebaser"` |
| `"ninthwave-repairer"` (agentName) | `"ninthwave-rebaser"` |
| `[Repairer]` (PR comments) | `[Rebaser]` |

Update the agent prompt in `agents/rebaser.md`: rename "Repair Worker Agent" to "Rebaser Agent", update all `YOUR_REPAIR_*` prompt variables to `YOUR_REBASE_*`, update PR comment prefix, update the ignore list mentioning `[Repairer]`.

Add backward compatibility in `core/reconstruct.ts`: when reading persisted state, map old `repairWorkspaceRef` field to `rebaserWorkspaceRef` so running daemons survive the upgrade.

**Test plan:**
- Run `bun test test/` -- all tests pass after rename
- Verify no stale references: `grep -r "repairer\|repairWorkspace\|repairAttempt\|launchRepair\|cleanRepair\|RepairLaunch\|launch-repair\|clean-repair" core/ agents/` returns no hits
- Test backward compat: verify `reconstructState()` handles state files with old field names
- Check `test/verify-main.test.ts`, `test/orchestrator-unit.test.ts`, `test/orchestrate.test.ts` for repair references and update

Acceptance: `agents/repairer.md` is renamed to `agents/rebaser.md` with updated frontmatter. All source references to "repairer"/"repairing"/"repair" (in the agent context) use the new naming. State `"rebasing"` replaces `"repairing"`. Backward compat in reconstruct handles old field names. All tests pass.

Key files: `agents/repairer.md`, `core/orchestrator.ts`, `core/commands/launch.ts`, `core/commands/orchestrate.ts`, `core/status-render.ts`, `core/reconstruct.ts`, `core/daemon.ts`, `core/snapshot.ts`, `test/verify-main.test.ts`, `test/orchestrator-unit.test.ts`, `test/orchestrate.test.ts`
