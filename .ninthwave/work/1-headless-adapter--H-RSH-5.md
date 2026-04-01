# Feat: Add buildHeadlessCmd to AI tool profiles (H-RSH-5)

**Priority:** High
**Source:** Plan: Remove Send-Keys & Add Headless Adapter (eng-reviewed 2026-04-01)
**Depends on:** H-RSH-1
**Domain:** headless-adapter

Add a buildHeadlessCmd(opts: LaunchOpts, deps: LaunchDeps): LaunchCmdResult method to the AiToolProfile interface in core/ai-tools.ts. Implement for each profile:

Claude Code: claude -p "Start" --permission-mode bypassPermissions --agent {agentName} --append-system-prompt "$(cat '.ninthwave/.prompt')"

GitHub Copilot: create temp prompt file (same pattern as buildLaunchCmd), then copilot -p "$PROMPT" --agent={agentName} --allow-all --no-ask-user

OpenCode: create temp prompt file (same pattern as buildLaunchCmd), then opencode run "$PROMPT" --agent {agentName}

All three return initialPrompt: "" since the prompt is embedded in the command. Follow the same temp-file pattern used by buildLaunchCmd for copilot and opencode.

**Test plan:**
- Test Claude buildHeadlessCmd: verify -p flag present, --permission-mode, --agent, --append-system-prompt, no --name flag
- Test Copilot buildHeadlessCmd: verify -p flag, --no-ask-user, --allow-all, temp file created/referenced
- Test OpenCode buildHeadlessCmd: verify "run" subcommand, --agent flag, temp file created/referenced
- Test all three return initialPrompt: ""
- Verify buildLaunchCmd (interactive) still works unchanged

Acceptance: AiToolProfile interface requires buildHeadlessCmd. All 3 profiles implement it. Tests verify correct headless command construction. Existing buildLaunchCmd tests unaffected.

Key files: `core/ai-tools.ts`, `test/ai-tools.test.ts`
