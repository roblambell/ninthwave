# Refactor: Extract captureOutput to shared test helper (L-ER-5)

**Priority:** Low
**Source:** Engineering review R6 Theme A, R7-D11
**Depends on:** None
**Domain:** test

Extract the `captureOutput` pattern from 6+ test files into `test/helpers.ts` as a shared utility. Each test file currently has its own 15-20 LOC copy with identical logic: capture `console.log`, `console.error`, and `process.exit`, then restore originals in cleanup.

Create a shared helper in `test/helpers.ts`:

```typescript
export function captureOutput(): {
  logs: string[];
  errors: string[];
  exitCode: number | null;
  restore: () => void;
}
```

The function:
1. Saves original `console.log`, `console.error`, `process.exit`
2. Replaces them with mock implementations that capture output
3. Returns the captured arrays and a `restore()` function

Each test file replaces its local `captureOutput` with an import from `test/helpers.ts`.

Files to update (grep for `captureOutput` or the common pattern `const originalLog = console.log`):
- `test/clean.test.ts`
- `test/ci.test.ts`
- `test/watch.test.ts`
- `test/launch.test.ts`
- `test/status.test.ts`
- Any other test files with the same pattern

**Test plan:**
- Verify the shared `captureOutput` captures console.log, console.error, and process.exit correctly
- Verify `restore()` restores all originals
- Verify all updated test files pass with the shared helper
- Grep for duplicate `captureOutput` implementations to ensure none remain
- Run `bun test test/` to confirm no regressions

Acceptance: `captureOutput` is in `test/helpers.ts`. All duplicates are removed from individual test files. ~80 LOC of duplication eliminated. `bun test test/` passes.

Key files: `test/helpers.ts`, `test/clean.test.ts`, `test/ci.test.ts`, `test/watch.test.ts`, `test/launch.test.ts`, `test/status.test.ts`
