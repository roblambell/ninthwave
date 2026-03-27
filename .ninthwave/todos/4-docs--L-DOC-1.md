# Docs: Copilot CLI integration guide (L-DOC-1)

**Priority:** Low
**Source:** Vision L-VIS-12 — tool integration polish
**Depends on:** (none)
**Domain:** docs

## Context

ninthwave supports three AI tools: Claude Code, OpenCode, and Copilot CLI. Claude Code has the deepest integration (agent mode, permissions bypass, append-system-prompt). Copilot CLI integration works but has undocumented quirks: prompt delivery via launcher scripts in `/tmp`, trusted folder requirements, and different session lifecycle behavior.

With Copilot CLI support maturing, document it so Copilot CLI users can get started without hitting known pitfalls. Note: auto-trust for Copilot folders was considered (M-CPT-1) but cancelled — users should manage their own `~/.copilot/config.json` trusted folders.

## Requirements

1. Add a `docs/copilot-cli.md` guide covering:
   - **Setup**: How `ninthwave init` / `ninthwave setup` configures Copilot CLI (trusted folders, agent seeding)
   - **How it works**: Prompt delivery mechanism (launcher scripts in `/tmp/nw-launch-{id}.sh`), session lifecycle, `-i` flag for stdin input
   - **Known differences from Claude Code**: No `--append-system-prompt` (prompt via launcher script instead), no `--permission-mode` (Copilot handles permissions differently), no `--agent` flag (agent prompt copied to `.github/agents/`)
   - **Troubleshooting**: Trust prompt issues, prompt delivery failures, session detection
2. Add a link to this guide from `README.md` in the "Supported AI Tools" section.
3. Keep the guide concise — focus on what's different, not what's shared.

Acceptance: `docs/copilot-cli.md` exists with setup, usage, differences, and troubleshooting sections. README.md links to it. Content is accurate for the current codebase.

**Test plan:**
- All links in the doc resolve (no broken references)
- Technical claims match the code in `core/commands/start.ts` (launchAiSession copilot path)
- README.md contains a link to the new doc

Key files: `docs/copilot-cli.md` (new), `README.md`
