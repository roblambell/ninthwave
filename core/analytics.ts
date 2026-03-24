// Structured metrics emitter for orchestrator runs.
// Writes a JSON file per run to .ninthwave/analytics/ with timing,
// item counts, CI retry counts, merge strategy, and tool info.

import type { OrchestratorItem, OrchestratorConfig } from "./orchestrator.ts";

// ── Metrics schema ────────────────────────────────────────────────────

export interface ItemMetric {
  id: string;
  state: string;
  ciRetryCount: number;
  tool: string;
  prNumber?: number;
}

export interface RunMetrics {
  /** ISO 8601 timestamp of when the run started. */
  runTimestamp: string;
  /** Wall-clock duration in milliseconds. */
  wallClockMs: number;
  /** Total items tracked by this run. */
  itemsAttempted: number;
  /** Items that reached the "done" state. */
  itemsCompleted: number;
  /** Items that reached the "stuck" state. */
  itemsFailed: number;
  /** Merge strategy used for this run. */
  mergeStrategy: string;
  /** Per-item metrics. */
  items: ItemMetric[];
}

// ── Metrics collection ────────────────────────────────────────────────

/**
 * Collect run metrics from orchestrator state at completion.
 *
 * @param allItems - All orchestrator items at run completion
 * @param config - Orchestrator config (for merge strategy)
 * @param startTime - ISO timestamp when the run started
 * @param endTime - ISO timestamp when the run ended
 * @param aiTool - The AI tool used for this run (e.g., "claude", "cursor")
 */
export function collectRunMetrics(
  allItems: OrchestratorItem[],
  config: OrchestratorConfig,
  startTime: string,
  endTime: string,
  aiTool: string,
): RunMetrics {
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  const wallClockMs = Math.max(0, end - start);

  const items: ItemMetric[] = allItems.map((item) => ({
    id: item.id,
    state: item.state,
    ciRetryCount: item.ciFailCount,
    tool: aiTool,
    ...(item.prNumber != null ? { prNumber: item.prNumber } : {}),
  }));

  return {
    runTimestamp: startTime,
    wallClockMs,
    itemsAttempted: allItems.length,
    itemsCompleted: allItems.filter((i) => i.state === "done").length,
    itemsFailed: allItems.filter((i) => i.state === "stuck").length,
    mergeStrategy: config.mergeStrategy,
    items,
  };
}

// ── File I/O dependencies (injectable for testing) ────────────────────

export interface AnalyticsIO {
  mkdirSync: (path: string, opts: { recursive: boolean }) => void;
  writeFileSync: (path: string, data: string) => void;
}

// ── Metrics persistence ───────────────────────────────────────────────

/**
 * Write a run metrics file to the analytics directory.
 * Creates the directory if it doesn't exist.
 * File is named by timestamp: `YYYY-MM-DDTHH-MM-SS-MMMZ.json`
 *
 * @param metrics - The run metrics to persist
 * @param analyticsDir - Path to `.ninthwave/analytics/`
 * @param io - Injectable file system operations
 * @returns The path of the written file
 */
export function writeRunMetrics(
  metrics: RunMetrics,
  analyticsDir: string,
  io: AnalyticsIO,
): string {
  io.mkdirSync(analyticsDir, { recursive: true });

  // Convert ISO timestamp to a filesystem-safe name
  const safeName = metrics.runTimestamp
    .replace(/:/g, "-")
    .replace(/\./g, "-");
  const filePath = `${analyticsDir}/${safeName}.json`;

  io.writeFileSync(filePath, JSON.stringify(metrics, null, 2) + "\n");

  return filePath;
}
