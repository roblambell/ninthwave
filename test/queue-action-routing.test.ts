import { describe, it, expect } from "vitest";
import {
  GH_API_ACTIONS,
  formatQueueThrottleDescription,
} from "../core/orchestrate-event-loop.ts";
import { RequestQueue, type RequestQueueStats } from "../core/request-queue.ts";

describe("GH_API_ACTIONS routing through RequestQueue", () => {
  it("GH_API_ACTIONS contains the expected action types", () => {
    expect(GH_API_ACTIONS.has("merge")).toBe(true);
    expect(GH_API_ACTIONS.has("set-commit-status")).toBe(true);
    expect(GH_API_ACTIONS.has("post-review")).toBe(true);
    expect(GH_API_ACTIONS.has("sync-stack-comments")).toBe(true);
  });

  it("non-API actions are not in GH_API_ACTIONS", () => {
    expect(GH_API_ACTIONS.has("launch")).toBe(false);
    expect(GH_API_ACTIONS.has("clean")).toBe(false);
    expect(GH_API_ACTIONS.has("workspace-close")).toBe(false);
  });

  it("enqueues GH API action through the queue with correct priority", async () => {
    const executed: { category: string; priority: string }[] = [];
    const queue = new RequestQueue({ burstSize: 100, log: () => {} });

    // Enqueue a merge action (critical priority)
    await queue.enqueue({
      category: "merge",
      priority: "critical",
      itemId: "test-1",
      execute: async () => {
        executed.push({ category: "merge", priority: "critical" });
      },
    });

    // Enqueue a set-commit-status action (high priority)
    await queue.enqueue({
      category: "set-commit-status",
      priority: "high",
      itemId: "test-2",
      execute: async () => {
        executed.push({ category: "set-commit-status", priority: "high" });
      },
    });

    expect(executed).toHaveLength(2);
    expect(executed[0]!.category).toBe("merge");
    expect(executed[0]!.priority).toBe("critical");
    expect(executed[1]!.category).toBe("set-commit-status");
  });

  it("queue stats reflect completed requests", async () => {
    const queue = new RequestQueue({ burstSize: 100, log: () => {} });

    await queue.enqueue({
      category: "merge",
      priority: "critical",
      execute: async () => {},
    });

    const stats = queue.getStats();
    expect(stats.totalRequests).toBe(1);
    expect(stats.categories["merge"]!.count).toBe(1);
    expect(stats.categories["merge"]!.failureCount).toBe(0);
  });

  it("updateBudget syncs with queue for rate limit handling", () => {
    const queue = new RequestQueue({ burstSize: 20, log: () => {} });

    // Simulate rate limit: 0 remaining, reset in 60s
    const resetAt = Math.floor(Date.now() / 1000) + 60;
    queue.updateBudget(0, resetAt);

    expect(queue.isThrottled()).toBe(true);
  });

  it("updateBudget with remaining budget unthrottles the queue", () => {
    const queue = new RequestQueue({ burstSize: 20, log: () => {} });

    // Budget available
    const resetAt = Math.floor(Date.now() / 1000) + 3600;
    queue.updateBudget(4000, resetAt);

    expect(queue.isThrottled()).toBe(false);
  });
});

describe("formatQueueThrottleDescription", () => {
  it("formats basic throttle description", () => {
    const stats: RequestQueueStats = {
      totalRequests: 100,
      inFlight: 0,
      queued: 0,
      categories: {},
      budgetUtilization: 0.95,
    };
    const desc = formatQueueThrottleDescription(stats);
    expect(desc).toContain("Rate limited");
    expect(desc).toContain("95% used");
  });

  it("includes in-flight and queued counts when non-zero", () => {
    const stats: RequestQueueStats = {
      totalRequests: 50,
      inFlight: 3,
      queued: 5,
      categories: {},
      budgetUtilization: 0.8,
    };
    const desc = formatQueueThrottleDescription(stats);
    expect(desc).toContain("3 in-flight");
    expect(desc).toContain("5 queued");
  });

  it("omits in-flight/queued parenthetical when both are zero", () => {
    const stats: RequestQueueStats = {
      totalRequests: 10,
      inFlight: 0,
      queued: 0,
      categories: {},
      budgetUtilization: 1.0,
    };
    const desc = formatQueueThrottleDescription(stats);
    expect(desc).not.toContain("in-flight");
    expect(desc).not.toContain("queued");
  });

  it("rounds budget utilization percentage", () => {
    const stats: RequestQueueStats = {
      totalRequests: 10,
      inFlight: 0,
      queued: 0,
      categories: {},
      budgetUtilization: 0.333,
    };
    const desc = formatQueueThrottleDescription(stats);
    expect(desc).toContain("33% used");
  });
});
