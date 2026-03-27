# Feat: Add copilot trust folder advisory to `nw doctor` (M-DOC-1)

**Priority:** Medium
**Source:** Friction — copilot folder trust prompt blocked every worker launch (2026-03-26)
**Depends on:** None
**Domain:** dx

## Problem

When using GitHub Copilot CLI as the AI tool, each worker launches in a git worktree under a path like `~/.worktrees/todo-{ID}`. Copilot requires paths to be in `~/.copilot/config.json#trusted_folders` before it will proceed non-interactively. Unknown paths trigger a "Confirm folder trust" interactive prompt that blocks automation entirely.

The fix is simple (add the project root to `trusted_folders` — copilot does parent-path prefix matching), but users don't discover this until workers are already stuck. Per ETHOS.md principle #1, ninthwave must not modify user config outside the project directory. Instead, `nw doctor` should detect this and advise the user.

## Fix

### 1. Add `checkCopilotTrust(projectRoot, runner)` to `core/preflight.ts`

```typescript
export function checkCopilotTrust(
  projectRoot: string,
  runner: ShellRunner,
): CheckResult {
  // Only relevant if copilot is available
  if (runner("which", ["copilot"]).exitCode !== 0) {
    return { status: "info", message: "Copilot not installed (skip trust check)" };
  }

  // Read ~/.copilot/config.json
  const home = process.env.HOME ?? "";
  const configPath = `${home}/.copilot/config.json`;
  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    const trusted: string[] = config.trusted_folders ?? [];
    // Check if project root or a parent is trusted
    const isTrusted = trusted.some((folder: string) =>
      projectRoot.startsWith(folder) || folder.startsWith(projectRoot)
    );
    if (isTrusted) {
      return { status: "pass", message: "Copilot trusts project root" };
    }
    return {
      status: "warn",
      message: "Project root not in Copilot trusted_folders",
      detail: `Add "${projectRoot}" to ~/.copilot/config.json trusted_folders to prevent trust prompts in worktrees`,
    };
  } catch {
    // No config file — copilot might not be configured yet
    return {
      status: "warn",
      message: "Could not read ~/.copilot/config.json",
      detail: "Run copilot once to generate config, then add project root to trusted_folders",
    };
  }
}
```

### 2. Wire into `nw doctor`

Add the check to `core/commands/doctor.ts` output. Show as a warning (not a blocking failure) since copilot is optional.

### 3. Wire into pre-flight (advisory only)

Add to `preflight()` as a non-blocking check (warning, not failure) so it appears during `nw orchestrate` startup when copilot is the detected AI tool.

## Test plan

- Unit test: returns "info" when copilot is not installed
- Unit test: returns "pass" when project root is in trusted_folders
- Unit test: returns "warn" when project root is NOT in trusted_folders
- Unit test: returns "warn" when config.json doesn't exist
- Unit test: parent-path matching works (trusting `/Users/rob/code` covers `/Users/rob/code/ninthwave`)
- Verify `nw doctor` shows the advisory when copilot is installed but root isn't trusted

Acceptance: `nw doctor` warns when copilot is installed but the project root isn't in `trusted_folders`. The check is non-blocking (warning, not failure). No files outside the project directory are modified. Users get a clear one-line fix instruction.

Key files: `core/preflight.ts` (add check), `core/commands/doctor.ts` (wire into doctor output)
