# Feat: Surface Codex in selection, onboarding, and diagnostics (M-CDX-4)

**Priority:** Medium
**Source:** Spec `.opencode/plans/1775082497672-eager-rocket.md`
**Depends on:** H-CDX-1
**Domain:** ai-tooling
**Lineage:** 509117cf-052c-442a-9228-b15ebdcb90a7

Wire Codex through the remaining user-facing tool-selection paths so the CLI can discover, persist, and report it like the existing supported tools. This includes installed-tool detection, onboarding prompts, saved AI-tool preferences, and health/diagnostic output for operators.

**Test plan:**
- Extend `test/tool-select.test.ts` to cover Codex in installed-tool ordering, saved `ai_tools` preferences, and explicit tool selection paths
- Extend `test/onboard.test.ts` to verify Codex appears in first-run detection and selection prompts with the correct install guidance
- Extend `test/preflight.test.ts` and `test/doctor.test.ts` so Codex is included in availability checks and operator-facing output without adding unsupported external-config automation

Acceptance: tool selection, onboarding, preflight, and doctor all recognize Codex as a supported AI tool and present consistent Codex-specific messaging wherever the current tool list is surfaced.

Key files: `test/tool-select.test.ts`, `test/onboard.test.ts`, `test/preflight.test.ts`, `test/doctor.test.ts`
