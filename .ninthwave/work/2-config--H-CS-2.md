# Refactor: Replace .ninthwave/config with config.json (H-CS-2)

**Priority:** High
**Source:** Config simplification plan 2026-03-29
**Depends on:** None
**Domain:** config

Replace the legacy key=value `.ninthwave/config` format with `.ninthwave/config.json`. Kill dead config keys and unused features:

- **Kill LOC counting**: Remove `LOC_EXTENSIONS`, `DEFAULT_LOC_EXTENSIONS`, LOC stats in `scripts/version-bump.ts` (lines 105-117 and the if/else on totalLoc). Always prompt for bump level (patch/minor/major) instead of auto-patching based on LOC.
- **Kill github_token in config**: Simplify `resolveGithubToken()` in `core/gh.ts` to only check `process.env.NINTHWAVE_GITHUB_TOKEN`. Remove `loadConfig` import from gh.ts.
- **Kill dead init keys**: `ci_provider`, `test_command`, `MUX`, `REPO_TYPE`, `AI_TOOLS` are written by init but never read. Remove from `generateConfig()`.
- **Kill old types**: `ProjectConfig` and `DEFAULT_LOC_EXTENSIONS` from `core/types.ts`. `KNOWN_CONFIG_KEYS` from `core/config.ts`.

Rewrite `loadConfig()` in `core/config.ts` to read `.ninthwave/config.json` as JSON, returning `{ review_external: boolean, schedule_enabled: boolean }` with both defaulting to false. Define new `ProjectConfig` type inline in config.ts.

Update `generateConfig()` in `core/commands/init.ts` to output JSON. Write to `config.json` instead of `config`. Drop the separate workspace config.json write (lines 851-856) -- workspace data was only used for init's display summary.

Update consumers in `core/commands/orchestrate.ts` (lines 1949-1951) from string comparison to boolean. Update `core/commands/doctor.ts` to check for `config.json`.

Delete `.ninthwave/config` file from repo.

**Test plan:**
- Rewrite `test/config.test.ts` for JSON format: defaults when file missing, valid JSON parsing, malformed JSON returns defaults, unknown keys are ignored
- Update `test/init.test.ts`: config file assertions point to config.json, content is valid JSON
- Update `test/doctor.test.ts`: config path checks use config.json
- Update `test/gh.test.ts`: resolveGithubToken tests reflect env-var-only behavior
- Update version-bump tests if they exist to reflect LOC removal
- Run `bun test test/` -- full suite passes

Acceptance: `.ninthwave/config` (no extension) is deleted. `loadConfig()` reads `.ninthwave/config.json` as JSON. `ProjectConfig` is `{ review_external: boolean; schedule_enabled: boolean }`. `resolveGithubToken()` only checks env var. Version bump always prompts for level. `generateConfig()` outputs JSON. All tests pass.

Key files: `core/config.ts`, `core/types.ts`, `core/commands/init.ts`, `core/commands/orchestrate.ts:1949-1951`, `core/commands/doctor.ts:62-68`, `core/gh.ts:310-319`, `scripts/version-bump.ts:105-155`, `.ninthwave/config`, `test/config.test.ts`, `test/init.test.ts`, `test/doctor.test.ts`, `test/gh.test.ts`
