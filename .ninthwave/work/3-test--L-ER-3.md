# Test: Add no-leaked-mock and no-describe-skip lint rules (L-ER-3)

**Priority:** Low
**Source:** Engineering review R6-F6, R7-D9, R7-D10
**Depends on:** None
**Domain:** test

Add two new lint rules to `test/lint-tests.test.ts`:

1. **`no-leaked-mock`** (~25 LOC): Flag `vi.mock("../core/X.ts")` calls in test files when `test/X.test.ts` exists. Bun's test runner doesn't isolate `vi.mock` between files, so mocking a module that has its own test file causes mock leakage -- the mock persists and can break the module's own tests depending on execution order.

   Detection logic: scan each test file for `vi.mock("../core/` patterns. Extract the module path. Check if a corresponding test file exists (e.g., `vi.mock("../core/git.ts")` -> check for `test/git.test.ts`). If both exist, flag the violation.

   Suppression: `// lint-ignore: no-leaked-mock` on or above the flagged line.

   Known existing violations (document but don't fail initially, or add suppressions):
   - `clean.test.ts` mocks `git.ts` and `gh.ts`
   - `launch.test.ts` mocks `git.ts`
   - `ci.test.ts` mocks `gh.ts`
   - `watch.test.ts` mocks `gh.ts`

2. **`no-describe-skip`** (~15 LOC): Flag `describe.skip`, `it.skip`, and `test.skip` in test files. Skipped tests disable coverage silently and can mask regressions. Currently zero instances exist in the codebase, but this rule prevents future additions.

   Suppression: `// lint-ignore: no-describe-skip` on or above the flagged line.

**Test plan:**
- Verify `no-leaked-mock` detects `vi.mock` for modules with own test files
- Verify `no-leaked-mock` does NOT flag `vi.mock` for modules without own test files (e.g., cmux.ts is OK in mux.test.ts if cmux doesn't have its own test)
- Verify `no-describe-skip` detects `describe.skip`, `it.skip`, `test.skip`
- Verify lint-ignore suppression works for both rules
- Add suppressions to existing violations (clean, launch, ci, watch test files)
- Run `bun test test/` to confirm no regressions

Acceptance: Both lint rules are in `lint-tests.test.ts`. Existing violations have `// lint-ignore: no-leaked-mock` suppressions. Zero `describe.skip`/`it.skip` allowed without suppression. `bun test test/` passes.

Key files: `test/lint-tests.test.ts`
