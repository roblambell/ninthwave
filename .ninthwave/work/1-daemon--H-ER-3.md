# Fix: Daemon persistence hardening (H-ER-3)

**Priority:** High
**Source:** Engineering review R5-F1, R1-F1, R5-F4, R5-F9, R1-F9
**Depends on:** None
**Domain:** daemon

Four targeted improvements to `core/daemon.ts` for crash recovery and data integrity:

1. **Atomic state file writes** (~5 LOC): Change `writeStateFile()` (lines ~245-256) to write to a `.tmp` file first, then `renameSync` to the target path. `renameSync` is atomic on POSIX -- the file either has old content or new content, never partial JSON. This prevents corruption if the daemon is killed mid-write.

2. **Serialize critical crash recovery fields** (~20 LOC): Add `workspaceRef`, `partition`, and `resolvedRepoRoot` to the `DaemonStateItem` interface (lines ~19-63) and to `serializeOrchestratorState()` (lines ~503-542). Without these fields, a daemon crash loses the ability to manage in-flight workers -- liveness checks return false for all workers, partitions become orphaned, and cross-repo items lose their target repo context.

3. **Daemon PID file locking** (~10 LOC): Change `writePidFile()` (lines ~168-179) to use `O_CREAT | O_EXCL` (exclusive create) instead of plain `writeFileSync`. This prevents two concurrent `nw watch` invocations from both passing the `isDaemonRunning` check and both writing their PID, which would result in two daemons managing the same items.

4. **DaemonState deserialization validation** (~30 LOC): Add a lightweight shape validator in `readStateFile()` (lines ~258-270) after `JSON.parse`. Check that `items` is an array and each item has `id` (string) and `state` (string) fields. If validation fails, log a warning and return `null` (same as corrupt file behavior). This catches partially-written or schema-migrated state files before they cause runtime errors.

**Test plan:**
- Add test for atomic write: verify `.tmp` file is created and renamed (mock `io.writeFileSync` and `io.renameSync`)
- Add test for crash recovery fields: serialize an OrchestratorItem with workspaceRef, partition, resolvedRepoRoot set, verify they appear in DaemonStateItem output
- Add test for PID locking: verify EEXIST error is handled gracefully when PID file already exists
- Add test for validation: pass malformed JSON (missing items array, item without id) to readStateFile, verify it returns null
- Verify existing daemon.test.ts and daemon-integration.test.ts still pass

Acceptance: `writeStateFile` uses write-then-rename. `workspaceRef`, `partition`, and `resolvedRepoRoot` survive serialization round-trip. Two concurrent PID file writes don't both succeed. Malformed state files return null instead of crashing. `bun test test/` passes.

Key files: `core/daemon.ts:245`, `core/daemon.ts:19`, `core/daemon.ts:503`, `core/daemon.ts:168`, `core/daemon.ts:258`
