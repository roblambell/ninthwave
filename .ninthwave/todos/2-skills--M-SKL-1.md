# Feat: Update /decompose skill to use file-per-todo output format (M-SKL-1)

**Priority:** Medium
**Source:** Self-improvement loop
**Depends on:**
**Domain:** skills

## Context

The `/decompose` skill's SKILL.md and templates reference writing items to `TODOS.md`. Since grind cycle 3, ninthwave uses `.ninthwave/todos/` with one file per item. The skill output should match the actual format workers and the orchestrator consume.

## Requirements

1. Update `skills/decompose/SKILL.md` — change all references from `TODOS.md` to `.ninthwave/todos/` directory
2. Update the skill's output section to show the file-per-todo write format (e.g., "5 items written to `.ninthwave/todos/`")
3. Update any decomposition templates in `skills/decompose/` that reference `TODOS.md`
4. Ensure the skill instructs the AI to use `writeTodoFile()` or generate files matching the `{priority}-{domain}--{ID}.md` naming convention
5. Update the `/work` skill (`skills/work/SKILL.md`) if it references `TODOS.md` in its selection/processing phases
6. Do NOT change the skill's decomposition logic or quality — only update the output format references

Acceptance: No skill file under `skills/` references `TODOS.md` as a writable target. The `/decompose` skill output format matches the `.ninthwave/todos/` file-per-todo convention. The `/work` skill correctly references `.ninthwave/todos/` for item discovery.

**Test plan:** Search all files under `skills/` for `TODOS.md` references — should find zero writable references (historical mentions in examples are OK if clearly marked as legacy). Verify the decompose skill's output format example matches what `writeTodoFile()` produces.

Key files: `skills/decompose/SKILL.md`, `skills/work/SKILL.md`
