# Refactor: Replace DEPS column with inline blocker indicator and sub-lines (H-DS-2)

**Priority:** High
**Source:** Status table UX redesign -- replace DEPS column with inline indicator + sub-lines
**Depends on:** H-DS-1
**Domain:** status-ux

Remove the DEPS column from the status table. In its place, add a 2-char dep indicator slot before the title: items with unresolved blockers show a color-coded `⧗` (via `blockerIcon` from H-DS-1), items without get 2 spaces so titles stay aligned. When `showBlockerDetail` is true (new default), emit a `formatBlockerSubline` line after each blocked item showing the blocker IDs. The `d` key toggle hides/shows sub-lines while the icon persists.

Changes span both `formatStatusTable` and `buildStatusLayout` (mirrored logic). Refactor `formatItemRow` and `formatQueuedItemRow` to accept `depIndicator` string instead of `depsStr`. Remove `depsColWidth` computation and `depsStr()` inner functions. Replace with `depIndicatorWidth = hasDeps ? 2 : 0` in `fixedWidth`. Flip `showBlockerDetail` default to `true` in `orchestrate.ts` and `status.ts`. Update help overlay text from "Toggle dependency details" to "Toggle blocker sub-lines". Rewrite all 13 existing DEPS-related tests and add new tests for sub-line behavior.

**Test plan:**
- Rewrite "shows DEPS header" test: verify no DEPS header exists, `⧗` icon appears before blocked item titles
- Rewrite "showBlockerDetail=true/false" tests: verify sub-lines appear/disappear with `└` prefix, icon persists in both modes
- Delete "showBlockerDetail widens DEPS column dynamically" test (no dynamic column)
- Rewrite "unresolved blocker count" tests: verify sub-lines contain actual blocker IDs
- Rewrite "DEPS column overflow" test: verify sub-line truncation with `...` for many deps
- Rewrite "DEPS column dash" test: verify no icon and no sub-line when all deps resolved
- Update `formatItemRow`/`formatQueuedItemRow` tests for new `depIndicator` parameter
- Add test: titles aligned whether or not item has blockers (2-char slot consistent)
- Add test: `buildStatusLayout` counts sub-lines in `itemLines.length`
- Update separator width test for new `fixedWidth` formula

Acceptance: No DEPS header or column in status output. Blocked items show color-coded `⧗` before title (RED for 2+, YELLOW for 1). Sub-lines with `└ ID-1, ID-2` appear below blocked items by default. Pressing `d` hides sub-lines (icon stays). Titles align regardless of blocker status. `bun test test/` passes. `nw status` renders correctly with dependency-bearing work items.

Key files: `core/status-render.ts`, `test/status-render.test.ts`, `core/commands/orchestrate.ts:2538`, `core/commands/status.ts:282`
