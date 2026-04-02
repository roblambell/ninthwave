# Fix: Keep implementers accountable for CI-red PRs (H-WIR-4)

**Priority:** High
**Source:** Spec `.opencode/plans/1775144464123-swift-wizard.md`
**Depends on:** None
**Domain:** implementer-prompt
**Lineage:** 4b69bf09-bbb8-4c40-ac26-7fd27c91e453

Harden the implementer agent instructions so opening a PR is not treated as the end of responsibility when CI is still failing. The prompt should make the post-PR contract explicit: on each CI failure the worker stays in the investigate, test, and push loop until it either ships a candidate fix or posts a real blocker comment.

**Test plan:**
- Update `test/seed-agent-files.test.ts` assertions to cover the stronger post-PR CI ownership language and the requirement to re-enter the fix loop on repeated failures
- Verify seeded prompt output still preserves the existing inbox wait contract and post-message flow while replacing any misleading "PR created" completion framing in CI-fix steps
- Confirm prompt seeding still produces the expected implementer artifact for managed tool copies

Acceptance: The seeded implementer prompt states that a CI-failed PR remains the worker's responsibility, requires repeated investigate, test, and push cycles after each CI-failure message, and allows returning to idle wait only after a new fix push or a documented blocker. Existing inbox wait and post-message handling instructions remain intact.

Key files: `agents/implementer.md`, `test/seed-agent-files.test.ts`
