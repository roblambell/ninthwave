# Fix: Share getAvailableMemory across CLI and daemon (M-ER-4)

**Priority:** Medium
**Source:** Engineering review R3-F7, R7-B16
**Depends on:** H-ER-5
**Domain:** worker

Extract the macOS-aware `getAvailableMemory()` function from `core/commands/orchestrate.ts` into a shared module, and use it in `core/commands/launch.ts` instead of raw `os.freemem()`.

Currently, `nw start` and `nw <ID>` use `os.freemem()` (via `launch.ts:1034` and `launch.ts:1221`) for WIP limit calculation. On macOS, `os.freemem()` reports only the "free" memory category, excluding "inactive" pages (file cache the OS can reclaim). A typical macOS system might report 500MB "free" but have 4GB reclaimable, causing `calculateMemoryWipLimit` to compute 0 (clamped to 1).

The daemon already has the correct implementation -- `getAvailableMemory()` in `orchestrate.ts` parses `vm_stat` on macOS to include inactive pages. But this isn't exported for use by `launch.ts`.

Steps:
1. Create `core/memory.ts` with the `getAvailableMemory()` function (or add it to an existing shared module)
2. Update `core/commands/orchestrate.ts` to import from the new location
3. Update `core/commands/launch.ts` to use `getAvailableMemory()` instead of `freemem()`
4. Export the function for any future callers

**Test plan:**
- Add test for `getAvailableMemory`: verify it returns a number > 0 on the current platform
- Verify `nw start` with a manually set `--wip-limit` still works
- Verify existing orchestrate.test.ts tests pass
- Run `bun test test/` to confirm no regressions

Acceptance: `nw start` and `nw watch` use the same `getAvailableMemory()` function. WIP limit calculations are consistent between CLI and daemon on macOS. `bun test test/` passes.

Key files: `core/memory.ts` (new), `core/commands/orchestrate.ts`, `core/commands/launch.ts:1034`
