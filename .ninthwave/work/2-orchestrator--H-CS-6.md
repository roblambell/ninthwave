# Refactor: Rename verifier agent to forward-fixer (H-CS-6)

**Priority:** High
**Source:** Config simplification plan 2026-03-29
**Depends on:** None
**Domain:** orchestrator

Rename the "verifier" agent to "forward-fixer" throughout the codebase. The verifier creates fix-forward PRs for post-merge CI failures -- "forward-fixer" describes what it does.

File rename: `agents/verifier.md` -> `agents/forward-fixer.md`. Update frontmatter `name: ninthwave-forward-fixer`.

State renames in the orchestrator state machine:

| Old | New |
|-----|-----|
| `"verifying"` | `"forward-fix-pending"` |
| `"verify-failed"` | `"fix-forward-failed"` |
| `"repairing-main"` | `"fixing-forward"` |

Mechanical find-replace across all source and test files:

| Old | New |
|-----|-----|
| `verifyWorkspaceRef` | `fixForwardWorkspaceRef` |
| `verifyFailCount` | `fixForwardFailCount` |
| `maxVerifyRetries` | `maxFixForwardRetries` |
| `verifyMain` (config flag) | `fixForward` |
| `launchVerifier` (dep) | `launchForwardFixer` |
| `cleanVerifier` (dep) | `cleanForwardFixer` |
| `VerifierLaunchResult` | `ForwardFixerLaunchResult` |
| `launchVerifierWorker` | `launchForwardFixerWorker` |
| `handleVerifying` | `handleForwardFixPending` |
| `handleVerifyFailed` | `handleFixForwardFailed` |
| `handleRepairingMain` | `handleFixingForward` |
| `executeLaunchVerifier` | `executeLaunchForwardFixer` |
| `executeCleanVerifier` | `executeCleanForwardFixer` |
| `"launch-verifier"` (action) | `"launch-forward-fixer"` |
| `"clean-verifier"` (action) | `"clean-forward-fixer"` |
| `"ninthwave-verifier"` (agentName) | `"ninthwave-forward-fixer"` |
| `[Verifier]` (PR comments) | `[Forward-Fixer]` |

Branch and worktree naming: `ninthwave/verify-{id}` -> `ninthwave/fix-forward-{id}`, `ninthwave-verify-{id}` -> `ninthwave-fix-forward-{id}`.

Update `core/commands/setup.ts`: `AGENT_SOURCES` change `"verifier.md"` to `"forward-fixer.md"`, update `AGENT_DESCRIPTIONS`.

Update agent prompt in `agents/forward-fixer.md`: rename "Verifier Agent" to "Forward-Fixer Agent", update prompt variables, PR comment prefix, and the ignore list.

Update `DEP_DONE_STATES`, `POST_MERGE_STATES`, `WIP_STATES` sets in `core/orchestrator.ts`.

Add backward compatibility in `core/reconstruct.ts`: map old field names (`verifyWorkspaceRef`, `verifyFailCount`) and old state names (`"verifying"`, `"verify-failed"`, `"repairing-main"`) to the new names. Also handle old branch/worktree naming patterns in reconstruct.

**Test plan:**
- Run `bun test test/` -- all tests pass after rename
- Verify no stale references: `grep -r "verifier\|verifyWorkspace\|verifyFail\|verifyMain\|launchVerifier\|cleanVerifier\|VerifierLaunch\|launch-verifier\|clean-verifier\|repairing-main" core/ agents/` returns no hits (except backward-compat migration in reconstruct.ts)
- Test backward compat: verify `reconstructState()` handles state files with old field names and old state names
- `test/verify-main.test.ts` is the most impacted -- update all verifier/verify references
- Also update: `test/orchestrate.test.ts`, `test/orchestrator-unit.test.ts`, `test/seed-agent-files.test.ts`, `test/init.test.ts`, `test/ai-tools.test.ts`, `test/status-render.test.ts`, `test/contract/build-snapshot.test.ts`

Acceptance: `agents/verifier.md` is renamed to `agents/forward-fixer.md` with updated frontmatter. All source references use the new naming. States `"forward-fix-pending"`, `"fix-forward-failed"`, `"fixing-forward"` replace the old names. Branch/worktree naming uses `fix-forward-{id}`. `AGENT_SOURCES` and `AGENT_DESCRIPTIONS` in setup.ts are updated. Backward compat in reconstruct handles old state and field names. All tests pass.

Key files: `agents/verifier.md`, `core/orchestrator.ts`, `core/commands/launch.ts`, `core/commands/orchestrate.ts`, `core/commands/setup.ts`, `core/status-render.ts`, `core/reconstruct.ts`, `core/daemon.ts`, `core/snapshot.ts`, `test/verify-main.test.ts`, `test/orchestrate.test.ts`, `test/orchestrator-unit.test.ts`, `test/seed-agent-files.test.ts`, `test/init.test.ts`, `test/ai-tools.test.ts`, `test/status-render.test.ts`, `test/contract/build-snapshot.test.ts`
