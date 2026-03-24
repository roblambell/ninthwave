// Tests for status sync integration between orchestrator and external trackers.
// Uses dependency injection — no vi.mock needed.

import { describe, it, expect } from "vitest";
import { syncStatusLabels } from "../core/commands/orchestrate.ts";
import type { StatusSync } from "../core/types.ts";
import type { LogEntry } from "../core/commands/orchestrate.ts";

/** Create a mock StatusSync that records all calls. */
function mockStatusSync(): StatusSync & {
  calls: Array<{ method: string; args: unknown[] }>;
} {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  return {
    calls,
    addStatusLabel(id: string, label: string): boolean {
      calls.push({ method: "addStatusLabel", args: [id, label] });
      return true;
    },
    removeStatusLabel(id: string, label: string): boolean {
      calls.push({ method: "removeStatusLabel", args: [id, label] });
      return true;
    },
    markDone(id: string): boolean {
      calls.push({ method: "markDone", args: [id] });
      return true;
    },
  };
}

// ---------------------------------------------------------------------------
// syncStatusLabels
// ---------------------------------------------------------------------------
describe("syncStatusLabels", () => {
  it("adds status:in-progress when transitioning to launching", () => {
    const sync = mockStatusSync();
    syncStatusLabels(sync, "GHI-1", "ready", "launching");

    expect(sync.calls).toEqual([
      { method: "addStatusLabel", args: ["GHI-1", "status:in-progress"] },
    ]);
  });

  it("adds status:in-progress when transitioning to implementing", () => {
    const sync = mockStatusSync();
    syncStatusLabels(sync, "GHI-2", "launching", "implementing");

    expect(sync.calls).toEqual([
      { method: "addStatusLabel", args: ["GHI-2", "status:in-progress"] },
    ]);
  });

  it("swaps to status:pr-open when transitioning to pr-open", () => {
    const sync = mockStatusSync();
    syncStatusLabels(sync, "GHI-3", "implementing", "pr-open");

    expect(sync.calls).toEqual([
      { method: "removeStatusLabel", args: ["GHI-3", "status:in-progress"] },
      { method: "addStatusLabel", args: ["GHI-3", "status:pr-open"] },
    ]);
  });

  it("keeps status:pr-open when transitioning to ci-pending", () => {
    const sync = mockStatusSync();
    syncStatusLabels(sync, "GHI-4", "pr-open", "ci-pending");

    expect(sync.calls).toEqual([
      { method: "removeStatusLabel", args: ["GHI-4", "status:in-progress"] },
      { method: "addStatusLabel", args: ["GHI-4", "status:pr-open"] },
    ]);
  });

  it("keeps status:pr-open when transitioning to ci-passed", () => {
    const sync = mockStatusSync();
    syncStatusLabels(sync, "GHI-5", "ci-pending", "ci-passed");

    expect(sync.calls).toEqual([
      { method: "removeStatusLabel", args: ["GHI-5", "status:in-progress"] },
      { method: "addStatusLabel", args: ["GHI-5", "status:pr-open"] },
    ]);
  });

  it("keeps status:pr-open when transitioning to ci-failed", () => {
    const sync = mockStatusSync();
    syncStatusLabels(sync, "GHI-6", "ci-passed", "ci-failed");

    expect(sync.calls).toEqual([
      { method: "removeStatusLabel", args: ["GHI-6", "status:in-progress"] },
      { method: "addStatusLabel", args: ["GHI-6", "status:pr-open"] },
    ]);
  });

  it("removes all labels and closes issue when transitioning to merged", () => {
    const sync = mockStatusSync();
    syncStatusLabels(sync, "GHI-7", "merging", "merged");

    expect(sync.calls).toEqual([
      { method: "removeStatusLabel", args: ["GHI-7", "status:in-progress"] },
      { method: "removeStatusLabel", args: ["GHI-7", "status:pr-open"] },
      { method: "markDone", args: ["GHI-7"] },
    ]);
  });

  it("removes all labels when transitioning to done (no markDone since issue already closed at merged)", () => {
    const sync = mockStatusSync();
    syncStatusLabels(sync, "GHI-8", "merged", "done");

    // markDone should NOT be called for done — it was already called at merged
    expect(sync.calls).toEqual([
      { method: "removeStatusLabel", args: ["GHI-8", "status:in-progress"] },
      { method: "removeStatusLabel", args: ["GHI-8", "status:pr-open"] },
    ]);
  });

  it("logs close event when transitioning to merged", () => {
    const sync = mockStatusSync();
    const logs: LogEntry[] = [];
    const log = (entry: LogEntry) => logs.push(entry);

    syncStatusLabels(sync, "GHI-9", "merging", "merged", log);

    expect(logs).toHaveLength(1);
    expect(logs[0].event).toBe("status_sync_close");
    expect(logs[0].itemId).toBe("GHI-9");
  });

  it("does nothing for untracked transitions like queued→ready", () => {
    const sync = mockStatusSync();
    syncStatusLabels(sync, "GHI-10", "queued", "ready");

    expect(sync.calls).toEqual([]);
  });

  it("does nothing for stuck transition", () => {
    const sync = mockStatusSync();
    syncStatusLabels(sync, "GHI-11", "launching", "stuck");

    expect(sync.calls).toEqual([]);
  });
});
