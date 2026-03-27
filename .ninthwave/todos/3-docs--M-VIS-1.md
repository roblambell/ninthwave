# Refactor: Trim VISION.md — stop accumulating completion markers (M-VIS-1)

**Priority:** Medium
**Source:** Manual review (L-VIS-13)
**Domain:** docs

VISION.md has grown to 30KB+ because each vision cycle appends completion markers (strikethrough, "*(complete)*" annotations, shipped status notes) to every section. This is wrong — VISION.md should describe the product vision and what's next, not serve as a changelog or audit trail of what shipped. That's what CHANGELOG.md is for.

**Changes needed:**
1. **Remove completed sections entirely** or collapse them to a single "Shipped" summary line. Sections like `A. Solidify the Foundation *(complete)*`, `A-bis`, `A-ter`, `A-quater`, `A-quinquies`, `A-sexies`, `C-alpha`, `B. Sandboxed Workers`, `C-bis. Worker Health Monitoring` are all marked complete — they clutter the document and make it hard to see what's actually next.
2. **Remove inline strikethrough markers** (`~~done item~~`) from remaining sections. Replace with a clean list of what's left to do.
3. **Remove the "Decomposed →" cross-references.** These are internal tracking artifacts that belong in TODO files, not the vision document.
4. **Update the Feature-Completeness section** to reflect current state without the inline achievement markers — just state the criteria and whether they're met.
5. **Add a convention note** (either in VISION.md header or CLAUDE.md) that vision workers should NOT add completion markers to VISION.md. Completed work goes in CHANGELOG.md.

Target: VISION.md should be under 15KB after trimming — roughly half its current size.

Acceptance: VISION.md is trimmed to focus on current and future vision only. Completed sections are removed or collapsed. No strikethrough markers remain. No "Decomposed →" references remain. A convention is documented (in VISION.md or CLAUDE.md) that prohibits adding completion markers to VISION.md. File size is under 15KB.

Key files: `VISION.md`, `CLAUDE.md`
