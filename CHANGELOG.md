# Changelog

## 0.1.0 — 2026-03-23

Initial release as **ninthwave**.

### Added
- Batch TODO orchestrator (`core/batch-todos.sh`) — parse, order, start, merge, finalize
- `/work` skill — 5-phase interactive workflow (select, launch, autopilot, monitor, finalize)
- `/decompose` skill — break feature specs into PR-sized work items with dependency mapping
- `/ninthwave-upgrade` skill — self-update for both global and vendored installs
- `/todo-preview` skill — port-isolated dev server for live testing
- `todo-worker` agent — autonomous implementation agent for Claude Code, OpenCode, and Copilot CLI
- Remote installer (`remote-install.sh`) — one-liner global or per-project setup
- `setup` script — creates `.ninthwave/` project config, skill symlinks, and agent copies
- Unit test suite — 112 tests covering parser, batch-order, mark-done, and version-bump

### Fixed
- `_prompt_files` unbound variable on script exit (local array referenced by global EXIT trap)
- Unbound variable in `cmd_batch_order` when remaining array empties
- `cmd_mark_done` not cleaning section headers with intervening blank lines
- Soft skill dependencies — graceful fallback when optional skills are unavailable
