# Feat: Implement zellij multiplexer adapter (H-ZLJ-1)

**Priority:** High
**Source:** Vision L-VIS-5
**Depends on:** -
**Domain:** mux

Implement a `ZellijAdapter` class conforming to the `Multiplexer` interface in `core/mux.ts`. This is the third multiplexer backend after cmux and tmux.

Zellij operations to implement:
- `launchWorkspace()` — `zellij --session <name>` or `zellij action new-tab --name <name>`
- `splitPane()` — `zellij action new-pane`
- `sendMessage()` — `zellij action write-chars` or `zellij action write`
- `readScreen()` — `zellij action dump-screen <path>` then read the file
- `listWorkspaces()` — `zellij list-sessions`
- `closeWorkspace()` — `zellij delete-session <name>` or `zellij action close-tab`
- `isAvailable()` — check if `zellij` binary exists

Integration:
- Add `ZellijAdapter` to `getMux()` in `core/mux.ts`
- Add "zellij" to `detectMuxType()` auto-detection chain (after cmux, before tmux)
- Support `--mux zellij` flag and `NINTHWAVE_MUX=zellij` env var
- Add `waitForReady()` support

Acceptance: `ninthwave orchestrate --items X --mux zellij` launches workers in zellij sessions. Auto-detection finds zellij when running inside a zellij session. All Multiplexer interface methods work.

Test plan: Unit tests for ZellijAdapter methods (mock shell calls). Integration test: launch a workspace, send a message, read screen, close it. Manual test with zellij installed.

Key files: `core/mux.ts`, `core/commands/orchestrate.ts`, `core/commands/start.ts`
