# Feat: Token/cost tracking in worker analytics (L-CST-1)

**Priority:** Low
**Source:** Friction #14 — no model/token/cost tracking in analytics
**Depends on:** None
**Domain:** analytics

## Problem

Analytics capture timing and item throughput but not which model each worker used, token counts, or estimated cost. This data is available from AI tool exit output (Claude Code prints token usage on exit, OpenCode logs usage) but is not currently captured. Without cost visibility, users can't evaluate the ROI of parallel execution or identify expensive work items.

## Fix

### 1. Define cost tracking fields

Add to `core/types.ts` (or `core/analytics.ts`):

```typescript
interface WorkerCostData {
  model?: string;       // e.g., "claude-sonnet-4-20250514", "gpt-4o"
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
  source: "heartbeat" | "exit-output" | "manual";
}
```

### 2. Capture cost data from heartbeat files

Workers already write heartbeat files via `nw heartbeat`. Extend the heartbeat format to optionally include cost data:

```bash
nw heartbeat --progress 1.0 --label "PR created" --tokens-in 45000 --tokens-out 12000 --model "claude-sonnet-4-20250514"
```

The worker agent prompt already calls `nw heartbeat` at milestones. Add guidance to include token data at the final heartbeat (when the AI tool provides it).

### 3. Aggregate in analytics

In `core/analytics.ts`, extend the per-item analytics record to include `WorkerCostData`. When writing the run summary, compute:
- Total tokens across all workers
- Estimated total cost (using a simple pricing lookup table)
- Cost per merged PR
- Cost per LOC changed

### 4. Display in `nw analytics`

Add a "Cost" section to the analytics display:
```
Cost Summary
  Total tokens: 1.2M (890K in / 310K out)
  Estimated cost: $4.20
  Cost per PR: $0.60 (7 PRs)
  Model breakdown: claude-sonnet-4-20250514 (5), gpt-4o (2)
```

### 5. Update worker agent prompt

Add guidance in `agents/todo-worker.md` to include token data in the final heartbeat when available. Claude Code surfaces usage on exit; the worker can capture it.

## Test plan

- Unit test: heartbeat file with cost data is parsed correctly
- Unit test: cost aggregation across multiple workers computes correct totals
- Unit test: analytics display includes cost section when data is available
- Unit test: analytics display gracefully handles missing cost data
- Unit test: pricing lookup table returns reasonable estimates for known models

Acceptance: `nw analytics` shows token counts and estimated cost when workers provide the data. Heartbeat format supports optional `--tokens-in`, `--tokens-out`, `--model` flags. Workers without cost data are displayed as `-` (no cost). Cost-per-PR metric is computed. The worker agent prompt guides workers to report cost data.

Key files: `core/commands/heartbeat.ts` (extend flags), `core/analytics.ts` (aggregation), `core/commands/analytics.ts` (display), `core/types.ts` (WorkerCostData type), `agents/todo-worker.md` (prompt guidance)
