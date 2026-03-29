# Fix: Worker reliability fixes bundle (M-ER-1)

**Priority:** Medium
**Source:** Engineering review R3-F4, R3-F2, R4-F4, R4-F3, R3-F3
**Depends on:** None
**Domain:** worker

Five small targeted reliability fixes across different worker lifecycle modules:

1. **Fix message delivery silent success** (~15 LOC in `core/send-message.ts`): Update `verifyDelivery()` (lines ~122-141) to accept a `usedPasteBuffer: boolean` parameter (default `true`). When `screen.exitCode !== 0` (can't read screen to verify), return `usedPasteBuffer` instead of unconditionally returning `true`. The paste-buffer path is inherently reliable, but the keystroke fallback (`attemptDirectSend`) is not -- keystrokes can be dropped or interleaved. Thread this flag from `attemptSend` (which knows the delivery method) through to `verifyDelivery`.

2. **Atomic partition allocation** (~10 LOC in `core/partitions.ts`): Replace the `existsSync(path)` + `writeFileSync(path, todoId)` pattern in `allocatePartition()` (lines ~16-30) with atomic file creation using `openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY)`, then `writeSync(fd, todoId)`, then `closeSync(fd)`. This prevents a TOCTOU race where two concurrent processes both see partition N as available.

3. **Fix daemonRebase stale branch** (~3 LOC in `core/git.ts`): In `daemonRebase()` (lines ~277-296), add a `fetch origin <branch>` call after the existing `fetch origin main` (line ~279) and before the `rebase` (line ~283). Without this, the local tracking ref for the branch may be stale if a worker pushed since the last fetch, causing the rebase to operate on outdated local state.

4. **Validate cross-repo alias** (~10 LOC in `core/cross-repo.ts`): Add regex validation for the `alias` parameter at the top of `resolveRepo()` and `bootstrapRepo()`. Reject any alias that doesn't match `/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/` (GitHub's repo name restrictions). Without this, a malformed `Repo:` field like `../../../etc` could cause path traversal via `path.join(parentDir, alias)`.

5. **Line-anchored error detection** (~10 LOC in `core/worker-health.ts`): Change the `ERROR_INDICATORS` check in `isWorkerInError()` (lines ~60-69) from substring matching to line-anchored matching. Split screen content by newlines and check if any line starts with (after trimming) one of the error indicators. Currently, `"Error:"` matches if the worker's screen shows code containing that string (e.g., a Python traceback in test output), causing false positive health detection.

**Test plan:**
- Test `verifyDelivery` returns false for keystroke path when screen unreadable
- Test `allocatePartition` with concurrent calls (second call gets EEXIST, moves to next slot)
- Test `daemonRebase` fetches both `origin/main` and `origin/<branch>`
- Test `resolveRepo` rejects aliases with path traversal characters (`../foo`, `foo;bar`)
- Test `isWorkerInError` returns false for code content containing "Error:" mid-line but true for "Error:" at line start
- Verify `bun test test/` passes

Acceptance: Unverifiable keystroke deliveries are not assumed successful. Partition allocation is atomic. Daemon rebase fetches the branch before rebasing. Cross-repo aliases are validated against path traversal. Error detection is line-anchored. `bun test test/` passes.

Key files: `core/send-message.ts:122`, `core/partitions.ts:16`, `core/git.ts:277`, `core/cross-repo.ts:20`, `core/worker-health.ts:60`
