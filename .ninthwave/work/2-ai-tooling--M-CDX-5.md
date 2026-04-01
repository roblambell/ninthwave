# Docs: Document Codex support and managed-file boundaries (M-CDX-5)

**Priority:** Medium
**Source:** Spec `.opencode/plans/1775082497672-eager-rocket.md`
**Depends on:** H-CDX-2, H-CDX-3, M-CDX-4
**Domain:** ai-tooling
**Lineage:** 5235daa0-4557-4334-babc-c88281c8c276

Update the user-facing documentation so Codex support is explained consistently once the implementation lands. Cover installation and onboarding, the generated `.codex/agents/ninthwave-*.toml` files, launch behavior, and the explicit rule that ninthwave does not create or manage root `AGENTS.md`.

**Test plan:**
- Manually review `README.md`, `docs/onboarding.md`, and `docs/faq.md` for consistent supported-tool lists and Codex setup language
- Add or update a Codex-specific guide and verify it matches the shipped command shapes, generated file locations, and ownership boundaries from the implemented code
- Manually verify `CONTRIBUTING.md` reflects the canonical-source vs generated-artifact boundary for Codex without implying root-instruction management

Acceptance: the general docs and the new Codex-specific guide consistently describe Codex as a supported tool, point to the correct generated `.codex/agents/*.toml` artifacts, and explicitly state that ninthwave does not create or overwrite `AGENTS.md`.

Key files: `README.md`, `docs/onboarding.md`, `docs/faq.md`, `CONTRIBUTING.md`, `docs/codex-cli.md`
