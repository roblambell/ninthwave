# Feat: Auto-decompose supervisor friction entries into TODO files (M-SUP-2)

**Priority:** Medium
**Source:** Self-improvement loop
**Depends on:**
**Domain:** supervisor

## Context

The supervisor writes friction files to `.ninthwave/friction/` when it detects anomalies during orchestration. Currently these files accumulate and are only reviewed manually during L-VIS cycles. The vision doc says: "Supervisor-generated friction entries auto-decomposed into TODOs."

Closing this loop means: supervisor detects anomaly → writes friction file → orchestrator auto-decomposes friction into TODO → worker implements fix → friction resolved. No human intervention except PR review.

## Requirements

1. Add a `decomposeFriction` function that reads unprocessed friction files from `.ninthwave/friction/` (excluding the `processed/` subdirectory) and generates TODO files in `.ninthwave/todos/`
2. Invoke `decomposeFriction` at the end of each orchestration run (after all items reach terminal state), gated by dogfooding mode or a `--auto-decompose` flag
3. Generated TODOs should have:
   - Priority derived from friction severity (critical/high → High, medium → Medium, low → Low)
   - Domain derived from friction component field
   - Acceptance criteria derived from the friction description
   - Source set to "friction-auto"
4. After decomposition, move processed friction files to `.ninthwave/friction/processed/`
5. Commit the new TODOs and moved friction files with message `chore: auto-decompose friction into TODOs`
6. Do NOT invoke an LLM for decomposition — use deterministic template-based generation. The friction file format is structured enough for pattern matching.

Acceptance: Supervisor friction files in `.ninthwave/friction/` are automatically decomposed into TODO files after orchestration completes. Processed friction files are moved to `processed/` subdirectory. Generated TODOs are parseable by the existing TODO parser. A `--auto-decompose` flag or dogfooding mode gates the behavior. Tests verify the decomposition for each severity level.

**Test plan:** Write unit tests for `decomposeFriction`: input a friction file with severity=high, verify output TODO has Priority=High. Test that files are moved to `processed/` after decomposition. Test that malformed friction files are skipped gracefully. Test that the function is a no-op when `.ninthwave/friction/` has no unprocessed files. Edge case: friction file with no severity field should default to Medium.

Key files: `core/commands/orchestrate.ts`, `core/todo-files.ts`, `core/orchestrator.ts`
