# Feat: GitHub Action for create-todo on CI/CD failure (M-GHA-1)

**Priority:** Medium
**Source:** Vision L-VIS-5
**Depends on:** -
**Domain:** action

Create a GitHub Action (`ninthwave-sh/create-todo`) that automatically creates a todo file in `.ninthwave/todos/` when a CI/CD workflow fails. This bridges production signals into ninthwave's work queue.

Implementation (in `actions/create-todo/`):
1. `action.yml` — action metadata. Inputs: todo priority (default: high), domain (default: ci), branch (default: main).
2. `index.ts` — action logic:
   - Triggered by `workflow_run` event with conclusion "failure"
   - Extracts: workflow name, run ID, failure URL, error logs (truncated)
   - Generates a todo file: `1-ci--H-CI-{N}.md` with failure context
   - Auto-increments ID by scanning existing CI-* files
   - Commits the file to the specified branch (default: main)
   - Opens a PR if configured, otherwise direct commit

Generated todo files follow the standard format: heading with ID, priority (default: high), source set to "GitHub Action (create-todo)", domain "ci", body with workflow name, run URL, and truncated error logs.

Packaging: Compile with `bun build` to a single JS file for the action runner. Publish as `ninthwave-sh/create-todo@v1`.

Acceptance: A failing workflow triggers the action, creates a todo file, and the file is parseable by `ninthwave list`. Works with both `.ninthwave/todos/` directory format.

Test plan: Unit tests for todo file generation and ID auto-increment. Integration test: simulate workflow_run event payload, verify todo file content. Manual test: add to a real repo, trigger a failure, verify todo appears.

Key files: `actions/create-todo/action.yml` (new), `actions/create-todo/index.ts` (new)
