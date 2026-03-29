# Feat: Add user-level config at ~/.ninthwave/config.json (H-CS-3)

**Priority:** High
**Source:** Config simplification plan 2026-03-29
**Depends on:** H-CS-2
**Domain:** config

Add user-level configuration at `~/.ninthwave/config.json`. For now, the only key is `ai_tool` -- the user's preferred AI coding tool (e.g., "claude", "opencode", "copilot").

Add `loadUserConfig()` to `core/config.ts` that reads `~/.ninthwave/config.json` and returns `{ ai_tool?: string }`. Handle missing file (return `{}`) and malformed JSON (warn and return `{}`).

Wire into `detectAiTool()` in `core/commands/run-items.ts` as priority 2 (between env var override and env detection):
1. `NINTHWAVE_AI_TOOL` env var (highest)
2. `~/.ninthwave/config.json` ai_tool (NEW)
3. Environment variable detection (CLAUDE_CODE_SESSION, etc.)
4. Process tree walk
5. Binary availability fallback

**Test plan:**
- Add tests for `loadUserConfig()` in `test/config.test.ts`: missing file returns `{}`, valid JSON returns parsed value, malformed JSON returns `{}`
- Add test for `detectAiTool()` user config priority: when `~/.ninthwave/config.json` has `ai_tool`, it takes precedence over env detection but not env var override. Use dependency injection or temp HOME to test without touching real user config.
- Run `bun test test/` -- full suite passes

Acceptance: `loadUserConfig()` exists in `core/config.ts` and reads `~/.ninthwave/config.json`. `detectAiTool()` checks user config between env var (step 1) and env detection (step 3). Unknown tool values produce a warning. Tests cover the priority chain.

Key files: `core/config.ts`, `core/commands/run-items.ts:36-91`
