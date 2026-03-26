# Feat: Update vision.md for grind cycles 6-7 and current project status (H-DOC-2)

**Priority:** High
**Source:** Self-improvement loop
**Depends on:**
**Domain:** docs

## Context

vision.md is the source of truth for ninthwave's direction and the self-improvement loop's reference document. It's stale — it doesn't reflect grind cycle 7 (friction-driven orchestrator improvements, review workers, strait completion) or the completion status of Phase B and C-bis.

## Requirements

1. Add a "Shipped in grind cycle 7" section under "What Exists Today" listing: review worker integration (H-RVW-1 through M-RVW-5), friction-driven orchestrator improvements (H-ORC-8, H-ORC-9, M-CLI-2, M-ORC-8, M-ORC-9, M-ORC-10, M-UX-1, M-TST-5, L-ORC-3, L-UX-1), and strait CI fixes (H-FMT-1, M-CI-1)
2. Mark Phase B (Sandboxed Workers) policy-driven tier as complete — strait shipped with all TODOs (H-PRX-4 through M-PRX-9) plus CI gate
3. Mark Phase C-bis (Worker Health Monitoring) as complete — all items shipped (H-HLT-1, M-HLT-2, M-ORC-7, M-CLN-1)
4. Update Phase D (LLM Supervisor) remaining items — note that supervisor-generated friction auto-decomposition is next
5. Update the "Self-developing" paragraph with current grind cycle count (7+) and total friction items surfaced (25+)
6. Keep the document's voice and structure consistent with existing content

Acceptance: vision.md accurately reflects the current shipped state. Phases B and C-bis are marked complete. Grind cycle 7 features are documented. The "What Exists Today" section matches what actually exists.

**Test plan:** Cross-reference the shipped TODO IDs in vision.md against the merged PR list on GitHub. Verify no phase is marked complete that still has unshipped items. Verify the grind cycle count matches reality.

Key files: `vision.md`
