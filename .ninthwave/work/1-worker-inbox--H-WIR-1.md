# Feat: Add inspectable worker inbox history and wait state (H-WIR-1)

**Priority:** High
**Source:** Spec `.opencode/plans/1775144464123-swift-wizard.md`
**Depends on:** None
**Domain:** worker-inbox
**Lineage:** aae16239-93be-48dc-a292-9506fdaadd92

Extend the inbox subsystem so operators can inspect an item's live worker queue without consuming messages. Add durable inbox history and explicit wait-state metadata so incidents like H-PBR-2 and H-TEST-4 can be reconstructed even after messages have been drained.

**Test plan:**
- Expand `test/inbox.test.ts` to cover non-destructive inbox inspection output, queue previews, and the guarantee that status/peek commands do not consume pending messages
- Add coverage for inbox history records across write, deliver, drain, clean, and interrupted wait paths
- Add daemon integration coverage proving hub-root inspection can resolve and report the active worker namespace when it differs from the current cwd namespace

Acceptance: `nw inbox` can report pending message count, queue location, recent message previews, and wait-state metadata for an item without deleting queued messages. Inbox writes, deliveries, drains, cleans, and interrupted waits leave durable history entries that remain inspectable after the live queue changes. Operators can inspect the live worker namespace even when it differs from the current working directory namespace.

Key files: `core/commands/inbox.ts`, `core/daemon.ts`, `test/inbox.test.ts`, `test/daemon-integration.test.ts`
