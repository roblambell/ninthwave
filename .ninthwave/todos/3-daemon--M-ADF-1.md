# Feat: Auto-decompose friction files into TODOs (M-ADF-1)

**Priority:** Medium
**Source:** VISION.md section D (previously H-ADF-1)
**Domain:** daemon

Close the self-improvement loop: when `.ninthwave/friction/` contains unprocessed friction files (not in the `processed/` subdirectory), automatically decompose actionable items into TODO files. This is the final piece of the autonomous friction → TODO → PR → merged pipeline.

**Implementation:**
1. Add a `decomposeFriction` function in `core/commands/` that:
   - Scans `.ninthwave/friction/*.md` for files not yet in `processed/`
   - Reads each friction file and classifies it: actionable (needs a code change) vs informational (observation only)
   - For actionable items, generates a TODO file in `.ninthwave/todos/` with proper format (title, priority based on severity, acceptance criteria derived from the friction description, affected files)
   - Moves processed friction files to `.ninthwave/friction/processed/`
2. Wire into the orchestrator's end-of-run hook (after all items reach terminal state) or as a standalone `ninthwave decompose-friction` command.
3. The decomposition should be deterministic (no LLM required) for simple friction patterns (single file, clear fix description). For complex friction, generate a TODO with a broader scope and mark it for human review.

Acceptance: Unprocessed friction files in `.ninthwave/friction/` are decomposed into TODO files. Each generated TODO has a title, priority (derived from severity), domain, description, and acceptance criteria. Processed friction files are moved to `processed/`. The command is idempotent — running twice doesn't create duplicate TODOs. At least the simple case (friction with clear severity and description) works without LLM involvement.

**Test plan:** Unit test: (1) create a temp friction file with severity and description, run decomposeFriction, verify a TODO file is created with correct format; (2) verify the friction file is moved to processed/; (3) verify idempotency.

Key files: `core/commands/decompose-friction.ts` (new), `core/cli.ts`, `.ninthwave/friction/`, `test/decompose-friction.test.ts` (new)
