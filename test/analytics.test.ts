// Tests for core/analytics.ts — Structured metrics emitted on orchestrate_complete.
// Uses dependency injection (no vi.mock) per project conventions.

import { describe, it, expect, vi } from "vitest";
import {
  collectRunMetrics,
  writeRunMetrics,
  type RunMetrics,
  type AnalyticsIO,
} from "../core/analytics.ts";
import {
  orchestrateLoop,
  type LogEntry,
  type OrchestrateLoopDeps,
  type OrchestrateLoopConfig,
} from "../core/commands/orchestrate.ts";
import {
  Orchestrator,
  type PollSnapshot,
  type ExecutionContext,
  type OrchestratorDeps,
  type OrchestratorConfig,
  type OrchestratorItem,
} from "../core/orchestrator.ts";
import type { TodoItem } from "../core/types.ts";

// ── Helpers ──────────────────────────────────────────────────────────

function makeTodo(id: string, deps: string[] = []): TodoItem {
  return {
    id,
    priority: "high",
    title: `TODO ${id}`,
    domain: "test",
    dependencies: deps,
    bundleWith: [],
    status: "open",
    lineNumber: 1,
    lineEndNumber: 5,
    repoAlias: "",
    rawText: `## ${id}\nTest todo`,
    filePaths: [],
    testPlan: "",
  };
}

function mockActionDeps(overrides?: Partial<OrchestratorDeps>): OrchestratorDeps {
  return {
    launchSingleItem: vi.fn(() => ({
      worktreePath: "/tmp/test/todo-test",
      workspaceRef: "workspace:1",
    })),
    cleanSingleWorktree: vi.fn(() => true),
    prMerge: vi.fn(() => true),
    prComment: vi.fn(() => true),
    sendMessage: vi.fn(() => true),
    closeWorkspace: vi.fn(() => true),
    fetchOrigin: vi.fn(),
    ffMerge: vi.fn(),
    ...overrides,
  };
}

function mockAnalyticsIO(): AnalyticsIO & {
  mkdirSync: ReturnType<typeof vi.fn>;
  writeFileSync: ReturnType<typeof vi.fn>;
} {
  return {
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
}

const defaultCtx: ExecutionContext = {
  projectRoot: "/tmp/test-project",
  worktreeDir: "/tmp/test-project/.worktrees",
  todosFile: "/tmp/test-project/TODOS.md",
  aiTool: "claude",
};

// ── collectRunMetrics ────────────────────────────────────────────────

describe("collectRunMetrics", () => {
  it("computes wall-clock duration and item counts", () => {
    const items: OrchestratorItem[] = [
      {
        id: "T-1-1",
        todo: makeTodo("T-1-1"),
        state: "done",
        ciFailCount: 0,
        lastTransition: new Date().toISOString(),
      },
      {
        id: "T-1-2",
        todo: makeTodo("T-1-2"),
        state: "stuck",
        ciFailCount: 2,
        lastTransition: new Date().toISOString(),
      },
    ];

    const config: OrchestratorConfig = {
      wipLimit: 4,
      mergeStrategy: "asap",
      maxCiRetries: 2,
    };

    const start = "2026-03-24T10:00:00.000Z";
    const end = "2026-03-24T10:05:30.000Z";

    const metrics = collectRunMetrics(items, config, start, end, "claude");

    expect(metrics.runTimestamp).toBe(start);
    expect(metrics.wallClockMs).toBe(330_000); // 5min 30sec
    expect(metrics.itemsAttempted).toBe(2);
    expect(metrics.itemsCompleted).toBe(1);
    expect(metrics.itemsFailed).toBe(1);
    expect(metrics.mergeStrategy).toBe("asap");
  });

  it("tracks CI retry count per item", () => {
    const items: OrchestratorItem[] = [
      {
        id: "T-1-1",
        todo: makeTodo("T-1-1"),
        state: "done",
        ciFailCount: 0,
        lastTransition: new Date().toISOString(),
      },
      {
        id: "T-1-2",
        todo: makeTodo("T-1-2"),
        state: "done",
        ciFailCount: 3,
        prNumber: 42,
        lastTransition: new Date().toISOString(),
      },
    ];

    const config: OrchestratorConfig = {
      wipLimit: 4,
      mergeStrategy: "approved",
      maxCiRetries: 3,
    };

    const metrics = collectRunMetrics(
      items,
      config,
      "2026-03-24T10:00:00.000Z",
      "2026-03-24T10:01:00.000Z",
      "cursor",
    );

    expect(metrics.items).toHaveLength(2);
    expect(metrics.items[0]).toEqual({
      id: "T-1-1",
      state: "done",
      ciRetryCount: 0,
      tool: "cursor",
    });
    expect(metrics.items[1]).toEqual({
      id: "T-1-2",
      state: "done",
      ciRetryCount: 3,
      tool: "cursor",
      prNumber: 42,
    });
  });

  it("handles zero-item run gracefully", () => {
    const config: OrchestratorConfig = {
      wipLimit: 4,
      mergeStrategy: "asap",
      maxCiRetries: 2,
    };

    const metrics = collectRunMetrics(
      [],
      config,
      "2026-03-24T10:00:00.000Z",
      "2026-03-24T10:00:01.000Z",
      "claude",
    );

    expect(metrics.itemsAttempted).toBe(0);
    expect(metrics.itemsCompleted).toBe(0);
    expect(metrics.itemsFailed).toBe(0);
    expect(metrics.items).toEqual([]);
    expect(metrics.wallClockMs).toBe(1000);
    expect(metrics.mergeStrategy).toBe("asap");
  });
});

// ── writeRunMetrics ──────────────────────────────────────────────────

describe("writeRunMetrics", () => {
  it("creates the analytics directory and writes a JSON file", () => {
    const io = mockAnalyticsIO();
    const metrics: RunMetrics = {
      runTimestamp: "2026-03-24T10:05:30.123Z",
      wallClockMs: 5000,
      itemsAttempted: 1,
      itemsCompleted: 1,
      itemsFailed: 0,
      mergeStrategy: "asap",
      items: [{ id: "T-1-1", state: "done", ciRetryCount: 0, tool: "claude" }],
    };

    const path = writeRunMetrics(metrics, "/tmp/.ninthwave/analytics", io);

    expect(io.mkdirSync).toHaveBeenCalledWith("/tmp/.ninthwave/analytics", { recursive: true });
    expect(io.writeFileSync).toHaveBeenCalledTimes(1);

    const writtenPath = io.writeFileSync.mock.calls[0][0];
    expect(writtenPath).toContain("2026-03-24T10-05-30-123Z.json");
    expect(path).toBe(writtenPath);

    const writtenContent = JSON.parse(io.writeFileSync.mock.calls[0][1]);
    expect(writtenContent.runTimestamp).toBe("2026-03-24T10:05:30.123Z");
    expect(writtenContent.wallClockMs).toBe(5000);
    expect(writtenContent.items).toHaveLength(1);
  });

  it("names file by timestamp in filesystem-safe format", () => {
    const io = mockAnalyticsIO();
    const metrics: RunMetrics = {
      runTimestamp: "2026-01-15T23:59:59.999Z",
      wallClockMs: 0,
      itemsAttempted: 0,
      itemsCompleted: 0,
      itemsFailed: 0,
      mergeStrategy: "asap",
      items: [],
    };

    writeRunMetrics(metrics, "/analytics", io);

    const writtenPath = io.writeFileSync.mock.calls[0][0];
    expect(writtenPath).toBe("/analytics/2026-01-15T23-59-59-999Z.json");
    // No colons or dots in the filename
    const filename = writtenPath.split("/").pop()!;
    expect(filename).not.toContain(":");
    expect(filename.replace(".json", "")).not.toContain(".");
  });
});

// ── Integration: orchestrateLoop writes metrics ──────────────────────

describe("orchestrateLoop analytics integration", () => {
  it("writes metrics file on orchestrate_complete", async () => {
    const orch = new Orchestrator({ wipLimit: 2, mergeStrategy: "asap" });
    orch.addItem(makeTodo("T-1-1"));

    let cycle = 0;
    const logs: LogEntry[] = [];
    const io = mockAnalyticsIO();

    const buildSnapshot = (): PollSnapshot => {
      cycle++;
      switch (cycle) {
        case 1:
          return { items: [], readyIds: ["T-1-1"] };
        case 2:
          return { items: [{ id: "T-1-1", workerAlive: true }], readyIds: [] };
        case 3:
          return {
            items: [{ id: "T-1-1", prNumber: 1, prState: "open", ciStatus: "pass" }],
            readyIds: [],
          };
        default:
          return { items: [], readyIds: [] };
      }
    };

    const deps: OrchestrateLoopDeps = {
      buildSnapshot,
      sleep: () => Promise.resolve(),
      log: (entry) => logs.push(entry),
      actionDeps: mockActionDeps(),
      analyticsIO: io,
    };

    const config: OrchestrateLoopConfig = {
      analyticsDir: "/tmp/.ninthwave/analytics",
      aiTool: "claude",
    };

    await orchestrateLoop(orch, defaultCtx, deps, config);

    // Metrics file was written
    expect(io.mkdirSync).toHaveBeenCalledWith("/tmp/.ninthwave/analytics", { recursive: true });
    expect(io.writeFileSync).toHaveBeenCalledTimes(1);

    // Parse and validate written metrics
    const written = JSON.parse(io.writeFileSync.mock.calls[0][1]) as RunMetrics;
    expect(written.itemsAttempted).toBe(1);
    expect(written.itemsCompleted).toBe(1);
    expect(written.itemsFailed).toBe(0);
    expect(written.mergeStrategy).toBe("asap");
    expect(written.wallClockMs).toBeGreaterThanOrEqual(0);
    expect(written.items).toHaveLength(1);
    expect(written.items[0].id).toBe("T-1-1");
    expect(written.items[0].tool).toBe("claude");

    // analytics_written log event was emitted
    expect(logs.some((l) => l.event === "analytics_written")).toBe(true);
  });

  it("includes CI retry count in metrics for items with failures", async () => {
    const orch = new Orchestrator({ wipLimit: 2, mergeStrategy: "asap" });
    orch.addItem(makeTodo("T-1-1"));

    let cycle = 0;
    const io = mockAnalyticsIO();

    const buildSnapshot = (): PollSnapshot => {
      cycle++;
      switch (cycle) {
        case 1:
          return { items: [], readyIds: ["T-1-1"] };
        case 2:
          return { items: [{ id: "T-1-1", workerAlive: true }], readyIds: [] };
        case 3: // PR opened, CI fails
          return {
            items: [{ id: "T-1-1", prNumber: 1, prState: "open", ciStatus: "fail" }],
            readyIds: [],
          };
        case 4: // CI recovers
          return {
            items: [{ id: "T-1-1", prNumber: 1, prState: "open", ciStatus: "pass" }],
            readyIds: [],
          };
        default:
          return { items: [], readyIds: [] };
      }
    };

    const deps: OrchestrateLoopDeps = {
      buildSnapshot,
      sleep: () => Promise.resolve(),
      log: () => {},
      actionDeps: mockActionDeps(),
      analyticsIO: io,
    };

    const config: OrchestrateLoopConfig = {
      analyticsDir: "/tmp/.ninthwave/analytics",
      aiTool: "claude",
    };

    await orchestrateLoop(orch, defaultCtx, deps, config);

    const written = JSON.parse(io.writeFileSync.mock.calls[0][1]) as RunMetrics;
    expect(written.items[0].ciRetryCount).toBe(1);
  });

  it("skips analytics when analyticsDir is not configured", async () => {
    const orch = new Orchestrator({ wipLimit: 2, mergeStrategy: "asap" });
    orch.addItem(makeTodo("T-1-1"));

    let cycle = 0;
    const logs: LogEntry[] = [];

    const buildSnapshot = (): PollSnapshot => {
      cycle++;
      switch (cycle) {
        case 1:
          return { items: [], readyIds: ["T-1-1"] };
        case 2:
          return { items: [{ id: "T-1-1", workerAlive: true }], readyIds: [] };
        case 3:
          return {
            items: [{ id: "T-1-1", prNumber: 1, prState: "open", ciStatus: "pass" }],
            readyIds: [],
          };
        default:
          return { items: [], readyIds: [] };
      }
    };

    const deps: OrchestrateLoopDeps = {
      buildSnapshot,
      sleep: () => Promise.resolve(),
      log: (entry) => logs.push(entry),
      actionDeps: mockActionDeps(),
      // No analyticsIO provided
    };

    await orchestrateLoop(orch, defaultCtx, deps);

    // No analytics events
    expect(logs.some((l) => l.event === "analytics_written")).toBe(false);
    expect(logs.some((l) => l.event === "analytics_error")).toBe(false);
  });

  it("handles analytics write failure gracefully", async () => {
    const orch = new Orchestrator({ wipLimit: 2, mergeStrategy: "asap" });
    orch.addItem(makeTodo("T-1-1"));

    let cycle = 0;
    const logs: LogEntry[] = [];
    const io: AnalyticsIO = {
      mkdirSync: vi.fn(() => {
        throw new Error("permission denied");
      }),
      writeFileSync: vi.fn(),
    };

    const buildSnapshot = (): PollSnapshot => {
      cycle++;
      switch (cycle) {
        case 1:
          return { items: [], readyIds: ["T-1-1"] };
        case 2:
          return { items: [{ id: "T-1-1", workerAlive: true }], readyIds: [] };
        case 3:
          return {
            items: [{ id: "T-1-1", prNumber: 1, prState: "open", ciStatus: "pass" }],
            readyIds: [],
          };
        default:
          return { items: [], readyIds: [] };
      }
    };

    const deps: OrchestrateLoopDeps = {
      buildSnapshot,
      sleep: () => Promise.resolve(),
      log: (entry) => logs.push(entry),
      actionDeps: mockActionDeps(),
      analyticsIO: io,
    };

    const config: OrchestrateLoopConfig = {
      analyticsDir: "/tmp/.ninthwave/analytics",
      aiTool: "claude",
    };

    // Should not throw — analytics failure is non-fatal
    await orchestrateLoop(orch, defaultCtx, deps, config);

    // Item still completes
    expect(orch.getItem("T-1-1")!.state).toBe("done");

    // Error was logged
    const errorLog = logs.find((l) => l.event === "analytics_error");
    expect(errorLog).toBeDefined();
    expect(errorLog!.error).toContain("permission denied");
  });

  it("handles zero-item run gracefully in the loop", async () => {
    // Create orchestrator with no items — all terminal immediately
    const orch = new Orchestrator({ wipLimit: 2, mergeStrategy: "asap" });

    const io = mockAnalyticsIO();
    const logs: LogEntry[] = [];

    const deps: OrchestrateLoopDeps = {
      buildSnapshot: () => ({ items: [], readyIds: [] }),
      sleep: () => Promise.resolve(),
      log: (entry) => logs.push(entry),
      actionDeps: mockActionDeps(),
      analyticsIO: io,
    };

    const config: OrchestrateLoopConfig = {
      analyticsDir: "/tmp/.ninthwave/analytics",
      aiTool: "claude",
    };

    await orchestrateLoop(orch, defaultCtx, deps, config);

    // Metrics written even for zero items
    expect(io.writeFileSync).toHaveBeenCalledTimes(1);
    const written = JSON.parse(io.writeFileSync.mock.calls[0][1]) as RunMetrics;
    expect(written.itemsAttempted).toBe(0);
    expect(written.itemsCompleted).toBe(0);
    expect(written.itemsFailed).toBe(0);
    expect(written.items).toEqual([]);
    expect(written.mergeStrategy).toBe("asap");
  });
});
