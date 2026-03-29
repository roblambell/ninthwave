# Test: Add send-message.ts test file (M-ER-9)

**Priority:** Medium
**Source:** Engineering review R6-F4, R7-D7
**Depends on:** M-ER-1
**Domain:** test

Create `test/send-message.test.ts` with direct tests for the message delivery pipeline in `core/send-message.ts`. This module is currently untested directly -- it's only exercised indirectly via orchestrator deps mocks.

Test coverage should include:

1. **`verifyDelivery` function:**
   - Screen readable + message NOT in last line -> returns true (delivered)
   - Screen readable + message IS in last line -> returns false (stuck in input)
   - Screen unreadable + paste buffer used -> returns true (trust paste)
   - Screen unreadable + keystroke used -> returns false (don't trust keystrokes) -- this tests the fix from M-ER-1
   - Short message (< 60 chars) probe matching
   - Long message (> 60 chars) truncated probe matching

2. **`attemptSend` function:**
   - Paste buffer succeeds -> returns true
   - Paste buffer fails -> falls back to `attemptDirectSend`
   - Both paste and direct send fail -> returns false

3. **`sendMessageImpl` function:**
   - Successful delivery on first attempt -> no retry
   - Failed delivery -> retries with exponential backoff (mock timer)
   - Max retries exhausted -> returns false

Use dependency injection for the `Runner` parameter (shell command execution) and the `Multiplexer` (workspace operations). Create mock implementations that return configurable results.

**Test plan:**
- Test all `verifyDelivery` scenarios listed above (6 test cases)
- Test `attemptSend` paste/keystroke fallback (3 test cases)
- Test retry behavior with configurable max retries (2 test cases)
- Verify the `usedPasteBuffer` flag from M-ER-1 is tested
- Run `bun test test/` to confirm no regressions

Acceptance: `test/send-message.test.ts` exists with at least 10 test cases covering delivery verification, fallback paths, and retry behavior. All tests pass. `bun test test/` passes.

Key files: `test/send-message.test.ts` (new), `core/send-message.ts`, `core/delivery.ts`
