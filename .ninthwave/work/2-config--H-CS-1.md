# Refactor: Kill domain mapping (H-CS-1)

**Priority:** High
**Source:** Config simplification plan 2026-03-29
**Depends on:** None
**Domain:** config

Remove domain mapping entirely. The custom mapping feature (`domains.conf`, `loadDomainMappings()`) is dead code -- never called in production. The `normalizeDomain()` function's `domainMappings` parameter is never passed by production callers. Keep only auto-slugification.

**Test plan:**
- Verify `normalizeDomain()` still works without the mapping parameter (existing tests cover this)
- Update `test/config.test.ts`: delete `loadDomainMappings` describe block and custom-mapping tests
- Update `test/parser.test.ts`: remove tests passing domainMappings (~lines 831-856)
- Update `test/init.test.ts`: remove domains.conf assertions (~lines 731, 806-825, 1960-1977)
- Update `test/smoke/init.test.ts`: remove domains.conf assertion (line 40)
- Update `test/daemon.test.ts`: remove domains.conf file operations (~lines 634, 641)
- Run `bun test test/` -- full suite passes

Acceptance: `loadDomainMappings()` is deleted from `core/config.ts`. The `domainMappings` parameter is removed from `normalizeDomain()` in `core/work-item-files.ts`. `.ninthwave/domains.conf` is deleted. `scaffold()` in `core/commands/init.ts` no longer creates domains.conf. All tests pass. `grep -r "loadDomainMappings\|domains\.conf" core/ test/` returns no hits (except this work item file).

Key files: `core/config.ts`, `core/work-item-files.ts`, `core/parser.ts`, `core/commands/init.ts`, `.ninthwave/domains.conf`, `test/config.test.ts`, `test/parser.test.ts`, `test/init.test.ts`, `test/smoke/init.test.ts`, `test/daemon.test.ts`
