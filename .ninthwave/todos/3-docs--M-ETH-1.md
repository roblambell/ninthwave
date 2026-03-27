# Docs: Create ETHOS.md — project principles and boundaries (M-ETH-1)

**Priority:** Medium
**Source:** Manual review (L-VIS-13)
**Domain:** docs

Create an `ETHOS.md` file in the project root that codifies ninthwave's core principles and hard boundaries. This serves as the authoritative reference for what ninthwave will and won't do — guiding both contributors and the self-improvement loop.

Key principles to capture (non-exhaustive — review with maintainer):
- **Never modify user config outside the project directory.** ninthwave operates within `.ninthwave/` and the project root. It does not write to `~/.copilot/`, `~/.claude/`, or any user-global config. If a tool requires external configuration, document it — don't automate it.
- **Convention over configuration.** Sensible defaults, minimal config files.
- **Deterministic core, advisory AI.** The daemon is deterministic TypeScript. The supervisor is advisory only. LLM output never bypasses deterministic logic.
- **Scope discipline.** Each iteration narrows before it widens. Ship the narrowest wedge, then extend.
- **Transparency.** Every action is auditable — PR comments, analytics, friction logs. No silent side effects.

The file should be concise (target ~50 lines). It's a guardrail document, not a manifesto.

Acceptance: `ETHOS.md` exists at the project root with documented principles. CLAUDE.md references ETHOS.md as required reading. The "never modify user config outside project dir" principle is explicitly stated.

Key files: `ETHOS.md` (new), `CLAUDE.md`
