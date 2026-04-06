// Tests for stateToPollingPriority and parallel buildSnapshotAsync via RequestQueue.
// Uses dependency injection -- no vi.mock (snapshot.ts is imported by many test files).

import { describe, it, expect, vi } from "vitest";
import { stateToPollingPriority, buildSnapshotAsync } from "../core/commands/orchestrate.ts";
import { RequestQueue } from "../core/request-queue.ts";
import { Orchestrator } from "../core/orchestrator.ts";
import type { WorkItem } from "../core/types.ts";
import type { Multiplexer } from "../core/mux.ts";

// ── Helpers ─────────────────────────────────────────────────────────

function makeWorkItem(id: string, deps: string[] = []): WorkItem {
  return {
    id,
    priority: "high",
    title: `Item ${id}`,
    domain: "test",
    dependencies: deps,
    bundleWith: [],
    status: "open",
    filePath: "",
    rawText: `## ${id}\nTest item`,
    filePaths: [],
    testPlan: "",
  };
}

const fakeMux: Multiplexer = {
  type: "cmux" as const,
  isAvailable: () => false,
  diagnoseUnavailable: () => "not available",
  launchWorkspace: () => null,
  splitPane: () => null,
  readScreen: () => "",
  listWorkspaces: () => "",
  closeWorkspace: () => true,
  setStatus: () => true,
  setProgress: () => true,
};

// ── stateToPollingPriority ──────────────────────────────────────────

describe("stateToPollingPriority", () => {
  it("maps merging to critical", () => {
    expect(stateToPollingPriority("merging")).toBe("critical");
  });

  it("maps ci-failed to high", () => {
    expect(stateToPollingPriority("ci-failed")).toBe("high");
  });

  it("maps ci-pending to normal", () => {
    expect(stateToPollingPriority("ci-pending")).toBe("normal");
  });

  it("maps ci-passed to normal", () => {
    expect(stateToPollingPriority("ci-passed")).toBe("normal");
  });

  it("maps review-pending to normal", () => {
    expect(stateToPollingPriority("review-pending")).toBe("normal");
  });

  it("maps reviewing to normal", () => {
    expect(stateToPollingPriority("reviewing")).toBe("normal");
  });

  it("maps rebasing to normal", () => {
    expect(stateToPollingPriority("rebasing")).toBe("normal");
  });

  it("maps forward-fix-pending to normal", () => {
    expect(stateToPollingPriority("forward-fix-pending")).toBe("normal");
  });

  it("maps fix-forward-failed to normal", () => {
    expect(stateToPollingPriority("fix-forward-failed")).toBe("normal");
  });

  it("maps fixing-forward to normal", () => {
    expect(stateToPollingPriority("fixing-forward")).toBe("normal");
  });

  it("maps implementing to low", () => {
    expect(stateToPollingPriority("implementing")).toBe("low");
  });

  it("maps launching to low", () => {
    expect(stateToPollingPriority("launching")).toBe("low");
  });
});

// ── buildSnapshotAsync with RequestQueue ─────────────────────────────

describe("buildSnapshotAsync with queue", () => {
  it("dispatches all items through the queue in parallel", async () => {
    const orch = new Orchestrator();
    orch.addItem(makeWorkItem("Q-1"));
    orch.addItem(makeWorkItem("Q-2"));
    orch.addItem(makeWorkItem("Q-3"));
    orch.getItem("Q-1")!.reviewCompleted = true;
    orch.getItem("Q-2")!.reviewCompleted = true;
    orch.getItem("Q-3")!.reviewCompleted = true;
    orch.hydrateState("Q-1", "implementing");
    orch.hydrateState("Q-2", "ci-pending");
    orch.hydrateState("Q-3", "merging");

    const enqueueLog: { category: string; priority: string; itemId: string }[] = [];
    const queue = new RequestQueue({ maxConcurrency: 10, burstSize: 100 });
    const originalEnqueue = queue.enqueue.bind(queue);
    queue.enqueue = async <T>(opts: any): Promise<T> => {
      enqueueLog.push({ category: opts.category, priority: opts.priority, itemId: opts.itemId });
      return originalEnqueue(opts);
    };

    const checkPr = async (id: string) => `${id}\t10\tci-passed\tMERGEABLE\t2026-01-01T00:00:00Z`;

    const snapshot = await buildSnapshotAsync(
      orch, "/project", "/project/.ninthwave/.worktrees",
      fakeMux, () => null, checkPr,
      undefined, undefined, undefined, undefined,
      queue,
    );

    expect(snapshot.items).toHaveLength(3);
    expect(enqueueLog).toHaveLength(3);

    // Verify each item was enqueued with correct category and priority
    const byItem = Object.fromEntries(enqueueLog.map((e) => [e.itemId, e]));
    expect(byItem["Q-1"]!.priority).toBe("low"); // implementing
    expect(byItem["Q-2"]!.priority).toBe("normal"); // ci-pending
    expect(byItem["Q-3"]!.priority).toBe("critical"); // merging
    for (const entry of enqueueLog) {
      expect(entry.category).toBe("snapshot-poll");
    }
  });

  it("dispatches items in parallel not sequentially", async () => {
    const orch = new Orchestrator();
    orch.addItem(makeWorkItem("P-1"));
    orch.addItem(makeWorkItem("P-2"));
    orch.getItem("P-1")!.reviewCompleted = true;
    orch.getItem("P-2")!.reviewCompleted = true;
    orch.hydrateState("P-1", "implementing");
    orch.hydrateState("P-2", "implementing");

    // Track the order of execution starts and completions
    const events: string[] = [];
    const checkPr = async (id: string) => {
      events.push(`start:${id}`);
      await new Promise((r) => setTimeout(r, 10));
      events.push(`end:${id}`);
      return `${id}\t10\tci-passed\tMERGEABLE\t2026-01-01T00:00:00Z`;
    };

    const queue = new RequestQueue({ maxConcurrency: 10, burstSize: 100 });

    await buildSnapshotAsync(
      orch, "/project", "/project/.ninthwave/.worktrees",
      fakeMux, () => null, checkPr,
      undefined, undefined, undefined, undefined,
      queue,
    );

    // With parallel execution, both starts should happen before any end
    expect(events[0]).toBe("start:P-1");
    expect(events[1]).toBe("start:P-2");
  });

  it("preserves per-item error isolation", async () => {
    const orch = new Orchestrator();
    orch.addItem(makeWorkItem("E-1"));
    orch.addItem(makeWorkItem("E-2"));
    orch.getItem("E-1")!.reviewCompleted = true;
    orch.getItem("E-2")!.reviewCompleted = true;
    orch.hydrateState("E-1", "ci-pending");
    orch.hydrateState("E-2", "ci-pending");

    let callCount = 0;
    const checkPr = async (id: string) => {
      callCount++;
      if (id === "E-1") {
        return {
          statusLine: "",
          failure: { kind: "network" as const, stage: "prList-open" as const, error: "timeout" },
        };
      }
      return `E-2\t20\tci-passed\tMERGEABLE\t2026-01-01T00:00:00Z`;
    };

    const queue = new RequestQueue({ maxConcurrency: 10, burstSize: 100 });

    const snapshot = await buildSnapshotAsync(
      orch, "/project", "/project/.ninthwave/.worktrees",
      fakeMux, () => null, checkPr,
      undefined, undefined, undefined, undefined,
      queue,
    );

    // Both items should be in the snapshot
    expect(snapshot.items).toHaveLength(2);
    // The successful item should have PR data
    const e2 = snapshot.items.find((i) => i.id === "E-2")!;
    expect(e2.prNumber).toBe(20);
    expect(e2.ciStatus).toBe("pass");
    // Only one API error (from E-1)
    expect(snapshot.apiErrorCount).toBe(1);
    expect(snapshot.apiErrorSummary!.byKind).toEqual({ network: 1 });
  });

  it("respects queue concurrency limit", async () => {
    const orch = new Orchestrator();
    for (let i = 1; i <= 4; i++) {
      orch.addItem(makeWorkItem(`C-${i}`));
      orch.getItem(`C-${i}`)!.reviewCompleted = true;
      orch.hydrateState(`C-${i}`, "implementing");
    }

    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const checkPr = async (id: string) => {
      currentConcurrent++;
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
      await new Promise((r) => setTimeout(r, 20));
      currentConcurrent--;
      return `${id}\t10\tci-passed\tMERGEABLE\t2026-01-01T00:00:00Z`;
    };

    // Queue with max concurrency of 2
    const queue = new RequestQueue({ maxConcurrency: 2, burstSize: 100 });

    await buildSnapshotAsync(
      orch, "/project", "/project/.ninthwave/.worktrees",
      fakeMux, () => null, checkPr,
      undefined, undefined, undefined, undefined,
      queue,
    );

    // Concurrency should be capped at 2 (the queue's limit)
    expect(maxConcurrent).toBeLessThanOrEqual(2);
    expect(maxConcurrent).toBeGreaterThan(1); // should actually use parallelism
  });

  it("works without queue (sequential fallback)", async () => {
    const orch = new Orchestrator();
    orch.addItem(makeWorkItem("S-1"));
    orch.addItem(makeWorkItem("S-2"));
    orch.getItem("S-1")!.reviewCompleted = true;
    orch.getItem("S-2")!.reviewCompleted = true;
    orch.hydrateState("S-1", "implementing");
    orch.hydrateState("S-2", "ci-pending");

    const checkPr = async (id: string) => `${id}\t10\tci-passed\tMERGEABLE\t2026-01-01T00:00:00Z`;

    // No queue -- should still work (sequential)
    const snapshot = await buildSnapshotAsync(
      orch, "/project", "/project/.ninthwave/.worktrees",
      fakeMux, () => null, checkPr,
    );

    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.items[0]!.prNumber).toBe(10);
    expect(snapshot.items[1]!.prNumber).toBe(10);
  });
});
