# Fix: GitHub API error result types (H-ER-6)

**Priority:** High
**Source:** Engineering review R4-F1, R7-B2
**Depends on:** H-ER-2
**Domain:** github

Add a `GhResult<T>` discriminated union type to `core/gh.ts` and update the core GitHub API functions to distinguish "API returned zero results" from "API call failed":

```typescript
type GhResult<T> = { ok: true; data: T } | { ok: false; error: string };
```

Update these functions to return `GhResult<T>` instead of silently returning empty arrays/objects on failure:
- `prList()` (line ~25): return `{ ok: false, error: result.stderr }` instead of `[]`
- `prView()` (line ~51): return `{ ok: false, error: result.stderr }` instead of `{}`
- `prChecks()` (line ~72): return `{ ok: false, error: result.stderr }` instead of `[]`
- `prListAsync()` (line ~113): same pattern, async
- `prViewAsync()` (line ~139): same pattern, async
- `prChecksAsync()` (line ~160): same pattern, async

Update callers in `core/commands/pr-monitor.ts` (`checkPrStatus` and `checkPrStatusAsync`) to handle `{ ok: false }` by keeping the item in its current state (hold stale data) rather than misinterpreting the failure as "no data." When all API calls in a poll cycle return `{ ok: false }`, emit a log warning like "GitHub API unreachable, holding state."

Update callers in `core/commands/orchestrate.ts` (`buildSnapshot` and `buildSnapshotAsync`) to propagate the hold-state behavior -- when the API is down, return the previous snapshot's data for affected items rather than empty/stale data.

**Test plan:**
- Add tests for each updated gh.ts function: verify `{ ok: false }` on exit code != 0
- Add tests for `checkPrStatus`: verify items stay in current state when API returns `{ ok: false }`
- Add test for `buildSnapshotAsync`: verify snapshot uses stale data when API is unreachable
- Verify existing gh.test.ts, watch.test.ts, and contract tests pass with updated types
- Run `bun test test/` to confirm no regressions

Acceptance: `prList`, `prView`, `prChecks` (sync + async) return `GhResult<T>`. Callers hold state during API outages instead of misinterpreting empty results. CI-pending items no longer stall indefinitely during GitHub outages. `bun test test/` passes.

Key files: `core/gh.ts:25`, `core/gh.ts:51`, `core/gh.ts:72`, `core/commands/pr-monitor.ts:157`, `core/commands/orchestrate.ts:514`
