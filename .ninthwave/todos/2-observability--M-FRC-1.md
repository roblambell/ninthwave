# Feat: Auto-commit friction entries alongside analytics (M-FRC-1)

**Priority:** Medium
**Source:** Friction #19 — friction log entries accumulate but never committed during orchestration
**Depends on:** None
**Domain:** observability

## Problem

Worker agents write friction entries to `.ninthwave/friction/` during orchestration, but these files are never committed. The analytics auto-commit step (`commitAnalyticsFiles`) already commits `.ninthwave/analytics/` at orchestration shutdown, but friction entries are ignored. This means friction signal is lost unless manually committed.

The existing `commitAnalyticsFiles` function in `core/analytics.ts` is a clean, injectable pattern that handles staging safety (only commits analytics files, aborts if index is dirty). The same pattern should be applied to friction entries.

## Fix

### 1. Add `commitFrictionFiles` to `core/analytics.ts`

Reuse the same pattern as `commitAnalyticsFiles`:

```typescript
export function commitFrictionFiles(
  projectRoot: string,
  frictionRelPath: string,
  deps: AnalyticsCommitDeps,
): CommitAnalyticsResult {
  if (!deps.hasChanges(projectRoot, frictionRelPath)) {
    return { committed: false, reason: "no_changes" };
  }
  deps.gitAdd(projectRoot, [frictionRelPath]);
  const staged = deps.getStagedFiles(projectRoot);
  const nonFriction = staged.filter((f) => !f.startsWith(frictionRelPath));
  if (nonFriction.length > 0) {
    deps.gitReset(projectRoot, [frictionRelPath]);
    return { committed: false, reason: "dirty_index" };
  }
  deps.gitCommit(projectRoot, "chore: commit friction entries");
  return { committed: true, reason: "committed" };
}
```

### 2. Wire into orchestrate shutdown

In `core/commands/orchestrate.ts`, after the analytics commit block (~line 960), add the same pattern for friction:

```typescript
if (deps.analyticsCommit) {
  const frictionRelPath = ".ninthwave/friction";
  const result = commitFrictionFiles(ctx.projectRoot, frictionRelPath, deps.analyticsCommit);
  // ... logging same as analytics
}
```

## Test plan

- Unit test: `commitFrictionFiles` commits when friction files have changes
- Unit test: `commitFrictionFiles` skips when no changes
- Unit test: `commitFrictionFiles` aborts when index is dirty (non-friction files staged)
- Verify friction entries appear in git log after orchestration shutdown

Acceptance: `.ninthwave/friction/*.md` files written by workers are auto-committed at orchestration shutdown. The commit is atomic (only friction files). Dirty index is handled safely. Friction signal is preserved in git history.

Key files: `core/analytics.ts` (add `commitFrictionFiles`), `core/commands/orchestrate.ts` (~line 960, wire friction commit)
