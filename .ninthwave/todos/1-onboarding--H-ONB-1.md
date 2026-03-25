# Feat: Interactive first-run onboarding flow (H-ONB-1)

**Priority:** High
**Source:** Vision L-VIS-5
**Depends on:** H-CLI-2, H-ZLJ-1
**Domain:** onboarding

When `ninthwave` is run with no arguments in a directory that isn't set up yet, launch an interactive onboarding flow instead of printing help. This replaces the current "no args = help" behavior for uninitialized projects.

Flow:
1. **Welcome.** "Welcome to ninthwave — from spec to merged PRs, automatically."
2. **Detect multiplexer.** Auto-detect installed multiplexers (cmux, tmux, zellij). If multiple found, let user choose. If one found, confirm it. If none, prompt to install cmux (recommended) or tmux.
3. **Detect AI tool.** Auto-detect installed AI coding tools (claude, opencode, copilot). If multiple found, let user choose. If one found, confirm it. If none, prompt to install Claude Code (recommended).
4. **Run setup.** Execute `ninthwave setup` for the current project (seeds .ninthwave/, skills, agents).
5. **Launch session.** Open the chosen AI tool inside the chosen multiplexer. Create a workspace/session named "ninthwave".
6. **Pre-seed prompt.** Send a welcome message to the AI tool session: "You're set up with ninthwave. Try /decompose to break down a feature, or /work to process existing TODOs."
7. **Hand off.** The user is now in the multiplexer with their AI tool running. ninthwave's job is done.

For already-initialized projects, `ninthwave` with no args should still show help (current behavior).

Detection logic:
- `which claude` / `which opencode` / `which copilot` for AI tools
- Reuse `detectMuxType()` from `core/mux.ts` for multiplexers
- Use Bun's readline or simple stdin prompts for interactive choices (no external deps)

Acceptance: Running `ninthwave` in a new project directory launches the interactive flow. Running `ninthwave` in an already-setup project shows help. The flow ends with the user in a multiplexer session with their AI tool running and a welcome prompt visible.

Test plan: Unit tests for detection logic (mock which calls). Manual test: fresh directory, run `ninthwave`, complete the flow, verify AI tool is running in multiplexer.

Key files: `core/cli.ts`, `core/commands/setup.ts`, `core/mux.ts`
