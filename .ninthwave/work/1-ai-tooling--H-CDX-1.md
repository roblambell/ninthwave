# Feat: Add Codex tool profile and rendered agent artifact primitives (H-CDX-1)

**Priority:** High
**Source:** Spec `.opencode/plans/1775082497672-eager-rocket.md`
**Depends on:** None
**Domain:** ai-tooling
**Lineage:** 7b429af7-8ba3-4cf1-a57a-d9b10072ca4c

Extend the central AI-tool registry so Codex can be modeled as a first-class tool without piling more one-off conditionals into setup and launch code. Add a Codex profile with its command metadata, target directory, and command builders, and add the small shared primitive needed to render tool-owned agent artifacts instead of assuming every target is a verbatim Markdown copy. Keep root instruction files out of scope for this item.

**Test plan:**
- Extend `test/ai-tools.test.ts` to assert `codex` appears in `allToolIds()`, `agentTargetDirs()`, and `agentFileTargets()` with the expected `.codex/agents` target
- Add filename and content assertions for rendered Codex artifacts such as `ninthwave-implementer.toml` and the required `name`, `description`, and `developer_instructions` fields
- Add launch-builder assertions for interactive `codex --full-auto` and headless `codex exec --ask-for-approval never --sandbox workspace-write` command shapes

Acceptance: `core/ai-tools.ts` can describe Codex as a supported tool, produce ninthwave-owned Codex agent artifact metadata, and build stable interactive and headless Codex commands without introducing `AGENTS.md` management.

Key files: `core/ai-tools.ts`, `test/ai-tools.test.ts`
