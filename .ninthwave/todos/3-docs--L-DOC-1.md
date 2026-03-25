# Docs: Update vision.md to mark A-quater complete and add new phase (L-DOC-1)

**Priority:** Low
**Source:** Vision L-VIS-5
**Depends on:** -
**Domain:** docs

Update `vision.md` to reflect the current state:

1. Mark Phase A-quater (Operational Maturity) as **complete**. Add strikethrough and "Done" like previous phases. List what shipped: analytics persistence, memory-aware WIP, cost/token tracking, GitHub Issues adapter, daemon mode, worker retry.

2. Add new phase section "A-quinquies: Surface Area & Onboarding" (current) with the items from this cycle:
   - Interactive onboarding flow (ONB-1)
   - CLI polish (CLI-2)
   - zellij multiplexer adapter (ZLJ-1)
   - ClickUp task backend (CKU-1)
   - nono sandboxing (SBX-1)
   - GitHub Action create-todo (GHA-1)

3. Update the feature-completeness checklist:
   - ✓ GitHub Issues adapter (achieved)
   - ⏳ ClickUp adapter (in progress)
   - ⏳ zellij multiplexer (in progress)
   - ⏳ Sandboxed workers via nono (in progress)

4. Update "What Exists Today" section to mention grind cycles 0-4 (not 0-1).

5. Update "Self-developing" paragraph with current stats.

Acceptance: vision.md accurately reflects the current state. No stale "in progress" references for completed items.

Test plan: Read the updated file and verify all claims match the codebase state. No broken markdown.

Key files: `vision.md`
