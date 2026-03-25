# Feat: Implement ClickUp task backend adapter (M-CKU-1)

**Priority:** Medium
**Source:** Vision L-VIS-5
**Depends on:** -
**Domain:** backend

Implement a `ClickUpBackend` class conforming to the `TaskBackend` and `StatusSync` interfaces in `core/types.ts`. Use the ClickUp API v2 via HTTP (no SDK — keep self-contained, Bun has native fetch).

Operations:
- `list()` — GET /list/{list_id}/task with filters. Map tasks to TodoItem format.
- `read()` — GET /task/{task_id}. Return full task details as TodoItem.
- `markDone()` — PUT /task/{task_id} with status="closed".
- `addStatusLabel()` / `removeStatusLabel()` — update custom field or tag for ninthwave state sync.

Mapping: ClickUp list → domain, priority from ClickUp priority field (1-4 → critical/high/medium/low), task ID → CKU-N format, description → body, subtasks → dependencies if tagged.

Configuration: API token via `CLICKUP_API_TOKEN` env var. List ID via `--clickup-list` flag or `.ninthwave/config`. Auto-detect from `.ninthwave/config` if present.

Integration:
- Add `--backend clickup` support to `ninthwave list` command
- Add ClickUp status sync to orchestrator (same pattern as GitHub Issues)

Acceptance: `ninthwave list --backend clickup` shows ClickUp tasks. Orchestrator syncs state to ClickUp during processing. Tasks are closed when merged.

Test plan: Unit tests with mocked HTTP responses. Test mapping logic for priority, domain, ID format. Test status sync transitions.

Key files: `core/backends/clickup.ts` (new), `core/types.ts`, `core/commands/list.ts`, `core/commands/orchestrate.ts`
