# Feat: In-TUI item selection widgets (M-UT-7)

**Priority:** Medium
**Source:** Unified TUI plan -- Phase 3E
**Depends on:** H-UT-6
**Domain:** tui-ux

Replace readline-based promptItems(), promptMergeStrategy(), and promptWipLimit() with in-TUI selection rendered in the same alt-screen as the main TUI. Build three widget primitives in raw ANSI: a checkbox list for item selection (arrow keys to navigate, space to toggle, Enter to confirm), a single-select picker for merge strategy (auto/manual/bypass), and a number picker for WIP limit (1-10). All widgets render inside the existing alt-screen buffer using raw mode keypresses. The selection screen is the first thing users see when starting orchestration from nw or nw watch without --items. After confirming selections, transition seamlessly into the main TUI panel view. This is the hardest UI piece -- readline prompts continue to work as a fallback until this ships.

**Test plan:**
- Test checkbox list widget: render items, arrow navigation, space toggles, Enter confirms
- Test merge strategy picker: render options, arrow cycles, Enter selects
- Test WIP limit picker: render number, up/down changes value, clamped to 1-10
- Test selection screen rendering at various terminal sizes (80x40, 80x25)
- Test selecting 0 items: shows error message, stays on selection screen
- Test selecting all items: works correctly
- Test transition from selection screen to main TUI: seamless, no flicker
- Test keyboard escape: cancels selection, exits process

Acceptance: Users select items, merge strategy, and WIP limit entirely within the TUI. No readline prompts appear. Selections flow seamlessly into the main panel TUI. All three widgets handle edge cases (empty list, boundary values). bun test test/ passes.

Key files: `core/commands/orchestrate.ts`, `core/tui-widgets.ts`, `core/interactive.ts`, `test/orchestrate.test.ts`
