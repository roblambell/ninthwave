// Tests for the status command formatting functions.
// Uses dependency injection (pure functions) to avoid vi.mock.

import { describe, it, expect, vi } from "vitest";
import {
  stateColor,
  stateLabel,
  truncateTitle,
  formatAge,
  formatItemRow,
  formatBatchProgress,
  formatSummary,
  formatStatusTable,
  cmdStatusWatch,
  cmdStatus,
  getTerminalWidth,
  pad,
  type StatusItem,
  type ItemState,
} from "../core/commands/status.ts";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Strip ANSI escape codes for content assertions
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("stateColor", () => {
  it("returns green for merged", () => {
    // In non-TTY test env, color codes are empty strings
    // Just verify the function doesn't throw and returns a string
    expect(typeof stateColor("merged")).toBe("string");
  });

  it("returns a string for every valid state", () => {
    const states: ItemState[] = [
      "merged",
      "implementing",
      "ci-failed",
      "ci-pending",
      "review",
      "pr-open",
      "in-progress",
    ];
    for (const state of states) {
      expect(typeof stateColor(state)).toBe("string");
    }
  });
});

describe("stateLabel", () => {
  it("returns human-readable labels for each state", () => {
    expect(stateLabel("merged")).toBe("Merged");
    expect(stateLabel("implementing")).toBe("Implementing");
    expect(stateLabel("ci-failed")).toBe("CI Failed");
    expect(stateLabel("ci-pending")).toBe("CI Pending");
    expect(stateLabel("review")).toBe("In Review");
    expect(stateLabel("pr-open")).toBe("PR Open");
    expect(stateLabel("in-progress")).toBe("In Progress");
  });
});

describe("truncateTitle", () => {
  it("returns title unchanged if within limit", () => {
    expect(truncateTitle("Short title", 20)).toBe("Short title");
  });

  it("truncates long titles with ellipsis", () => {
    const long = "This is a very long title that exceeds the limit";
    const result = truncateTitle(long, 20);
    expect(result.length).toBe(20);
    expect(result.endsWith("...")).toBe(true);
  });

  it("returns exact-length title unchanged", () => {
    expect(truncateTitle("12345", 5)).toBe("12345");
  });

  it("handles very small maxWidth", () => {
    const result = truncateTitle("Hello World", 3);
    expect(result.length).toBe(3);
  });

  it("handles empty title", () => {
    expect(truncateTitle("", 10)).toBe("");
  });
});

describe("formatAge", () => {
  it("formats days and hours", () => {
    const ms = 2 * 86400000 + 3 * 3600000; // 2d 3h
    expect(formatAge(ms)).toBe("2d 3h");
  });

  it("formats days only when no remaining hours", () => {
    expect(formatAge(86400000)).toBe("1d");
  });

  it("formats hours and minutes", () => {
    const ms = 2 * 3600000 + 15 * 60000; // 2h 15m
    expect(formatAge(ms)).toBe("2h 15m");
  });

  it("formats hours only when no remaining minutes", () => {
    expect(formatAge(3600000)).toBe("1h");
  });

  it("formats minutes", () => {
    expect(formatAge(5 * 60000)).toBe("5m");
  });

  it("formats less than a minute", () => {
    expect(formatAge(30000)).toBe("<1m");
  });

  it("handles zero", () => {
    expect(formatAge(0)).toBe("<1m");
  });

  it("handles negative values gracefully", () => {
    expect(formatAge(-1000)).toBe("<1m");
  });
});

describe("pad", () => {
  it("pads shorter strings", () => {
    expect(pad("abc", 6)).toBe("abc   ");
  });

  it("returns string unchanged if at target width", () => {
    expect(pad("abcdef", 6)).toBe("abcdef");
  });

  it("returns string unchanged if longer than target", () => {
    expect(pad("abcdefgh", 6)).toBe("abcdefgh");
  });
});

describe("formatItemRow", () => {
  const baseItem: StatusItem = {
    id: "H-STU-1",
    title: "Rewrite status command",
    state: "implementing",
    prNumber: 42,
    ageMs: 2 * 3600000 + 15 * 60000,
    repoLabel: "",
  };

  it("includes the item ID", () => {
    const row = formatItemRow(baseItem, 30);
    expect(stripAnsi(row)).toContain("H-STU-1");
  });

  it("includes the state label", () => {
    const row = formatItemRow(baseItem, 30);
    expect(stripAnsi(row)).toContain("Implementing");
  });

  it("includes the PR number with #", () => {
    const row = formatItemRow(baseItem, 30);
    expect(stripAnsi(row)).toContain("#42");
  });

  it("shows dash when no PR number", () => {
    const item = { ...baseItem, prNumber: null };
    const row = formatItemRow(item, 30);
    expect(stripAnsi(row)).toContain("-");
    expect(stripAnsi(row)).not.toContain("#");
  });

  it("includes the age", () => {
    const row = formatItemRow(baseItem, 30);
    expect(stripAnsi(row)).toContain("2h 15m");
  });

  it("includes the title", () => {
    const row = formatItemRow(baseItem, 30);
    expect(stripAnsi(row)).toContain("Rewrite status command");
  });

  it("truncates long titles", () => {
    const item = {
      ...baseItem,
      title: "A very long title that should be truncated at the width limit",
    };
    const row = formatItemRow(item, 15);
    expect(stripAnsi(row)).toContain("...");
  });

  it("shows repo label for cross-repo items", () => {
    const item = { ...baseItem, repoLabel: "target-repo" };
    const row = formatItemRow(item, 30);
    expect(stripAnsi(row)).toContain("[target-repo]");
  });

  it("uses item ID as fallback when title is empty", () => {
    const item = { ...baseItem, title: "" };
    const row = formatItemRow(item, 30);
    expect(stripAnsi(row)).toContain("H-STU-1");
  });
});

describe("formatBatchProgress", () => {
  it("shows counts per state", () => {
    const items: StatusItem[] = [
      makeItem("A-1", "merged"),
      makeItem("A-2", "merged"),
      makeItem("A-3", "implementing"),
      makeItem("A-4", "ci-failed"),
    ];
    const line = stripAnsi(formatBatchProgress(items));
    expect(line).toContain("2 merged");
    expect(line).toContain("1 implementing");
    expect(line).toContain("1 ci failed");
  });

  it("returns empty string for zero items", () => {
    expect(formatBatchProgress([])).toBe("");
  });

  it("handles all items in same state", () => {
    const items = [makeItem("A-1", "review"), makeItem("A-2", "review")];
    const line = stripAnsi(formatBatchProgress(items));
    expect(line).toContain("2 in review");
  });

  it("orders states: merged first, ci-failed last", () => {
    const items: StatusItem[] = [
      makeItem("A-1", "ci-failed"),
      makeItem("A-2", "merged"),
      makeItem("A-3", "implementing"),
    ];
    const line = stripAnsi(formatBatchProgress(items));
    const mergedIdx = line.indexOf("merged");
    const implIdx = line.indexOf("implementing");
    const failIdx = line.indexOf("ci failed");
    expect(mergedIdx).toBeLessThan(implIdx);
    expect(implIdx).toBeLessThan(failIdx);
  });
});

describe("formatSummary", () => {
  it("shows total count", () => {
    const items = [makeItem("A-1", "merged"), makeItem("A-2", "implementing")];
    const line = stripAnsi(formatSummary(items));
    expect(line).toContain("2 items");
  });

  it("shows merged and active counts when both exist", () => {
    const items = [
      makeItem("A-1", "merged"),
      makeItem("A-2", "merged"),
      makeItem("A-3", "implementing"),
    ];
    const line = stripAnsi(formatSummary(items));
    expect(line).toContain("3 items");
    expect(line).toContain("2 merged");
    expect(line).toContain("1 active");
  });

  it("handles zero items", () => {
    const line = stripAnsi(formatSummary([]));
    expect(line).toContain("No active items");
  });

  it("handles singular item", () => {
    const items = [makeItem("A-1", "implementing")];
    const line = stripAnsi(formatSummary(items));
    expect(line).toContain("1 item");
    expect(line).not.toContain("1 items");
  });
});

describe("formatStatusTable", () => {
  it("shows header and items", () => {
    const items = [
      makeItem("H-STU-1", "implementing", "Rewrite status", 42),
      makeItem("H-MUX-2", "merged", "Add tmux adapter", 41),
    ];
    const output = stripAnsi(formatStatusTable(items));
    expect(output).toContain("ninthwave status");
    expect(output).toContain("ID");
    expect(output).toContain("STATE");
    expect(output).toContain("PR");
    expect(output).toContain("AGE");
    expect(output).toContain("TITLE");
    expect(output).toContain("H-STU-1");
    expect(output).toContain("H-MUX-2");
    expect(output).toContain("Implementing");
    expect(output).toContain("Merged");
    expect(output).toContain("#42");
    expect(output).toContain("#41");
  });

  it("shows no active items message when empty", () => {
    const output = stripAnsi(formatStatusTable([]));
    expect(output).toContain("ninthwave status");
    expect(output).toContain("No active items");
  });

  it("shows getting-started hints when empty", () => {
    const output = stripAnsi(formatStatusTable([]));
    expect(output).toContain("To get started:");
    expect(output).toContain("ninthwave list --ready");
    expect(output).toContain("ninthwave start <ID>");
  });

  it("includes batch progress line", () => {
    const items = [
      makeItem("A-1", "merged"),
      makeItem("A-2", "implementing"),
    ];
    const output = stripAnsi(formatStatusTable(items));
    expect(output).toContain("Progress:");
    expect(output).toContain("merged");
    expect(output).toContain("implementing");
  });

  it("includes summary line", () => {
    const items = [
      makeItem("A-1", "merged"),
      makeItem("A-2", "implementing"),
      makeItem("A-3", "ci-failed"),
    ];
    const output = stripAnsi(formatStatusTable(items));
    expect(output).toContain("Total:");
    expect(output).toContain("3 items");
  });

  it("respects terminal width for title truncation", () => {
    const items = [
      makeItem(
        "A-1",
        "merged",
        "This is a very long title that should be truncated on narrow terminals",
        10,
      ),
    ];
    // Force narrow 60-column terminal
    const output = stripAnsi(formatStatusTable(items, 60));
    // Title should be truncated - original is 71 chars, with 60 col width
    // titleWidth = max(10, 60 - 46) = 14
    const lines = output.split("\n");
    const itemLine = lines.find((l) => l.includes("A-1"));
    expect(itemLine).toBeDefined();
    // The full title should NOT appear
    expect(itemLine).not.toContain(
      "This is a very long title that should be truncated on narrow terminals",
    );
    expect(itemLine).toContain("...");
  });

  it("is readable on standard 80-column terminal", () => {
    const items = [
      makeItem("H-STU-1", "implementing", "Rewrite status command", 42),
      makeItem("H-MUX-2", "merged", "Add tmux adapter", 41),
      makeItem("M-CI-3", "ci-failed", "Fix CI timeout", 40),
    ];
    const output = formatStatusTable(items, 80);
    const lines = output.split("\n");
    for (const line of lines) {
      // Strip ANSI codes for width check
      const plain = stripAnsi(line);
      expect(plain.length).toBeLessThanOrEqual(80);
    }
  });

  it("produces parseable output with separators", () => {
    const items = [makeItem("A-1", "merged", "Test item", 10)];
    const output = stripAnsi(formatStatusTable(items));
    // Should have separator lines (using ─)
    const sepLines = output.split("\n").filter((l) => l.includes("─"));
    expect(sepLines.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── getTerminalWidth ────────────────────────────────────────────────────────

describe("getTerminalWidth", () => {
  it("returns a positive number", () => {
    const width = getTerminalWidth();
    expect(width).toBeGreaterThan(0);
  });

  it("returns 80 when process.stdout.columns is undefined", () => {
    const original = Object.getOwnPropertyDescriptor(
      process.stdout,
      "columns",
    );
    Object.defineProperty(process.stdout, "columns", {
      value: undefined,
      configurable: true,
    });
    try {
      expect(getTerminalWidth()).toBe(80);
    } finally {
      if (original) {
        Object.defineProperty(process.stdout, "columns", original);
      } else {
        delete (process.stdout as Record<string, unknown>)["columns"];
      }
    }
  });

  it("returns 80 when process.stdout.columns is 0", () => {
    const original = Object.getOwnPropertyDescriptor(
      process.stdout,
      "columns",
    );
    Object.defineProperty(process.stdout, "columns", {
      value: 0,
      configurable: true,
    });
    try {
      expect(getTerminalWidth()).toBe(80);
    } finally {
      if (original) {
        Object.defineProperty(process.stdout, "columns", original);
      } else {
        delete (process.stdout as Record<string, unknown>)["columns"];
      }
    }
  });

  it("returns actual column count when available", () => {
    const original = Object.getOwnPropertyDescriptor(
      process.stdout,
      "columns",
    );
    Object.defineProperty(process.stdout, "columns", {
      value: 120,
      configurable: true,
    });
    try {
      expect(getTerminalWidth()).toBe(120);
    } finally {
      if (original) {
        Object.defineProperty(process.stdout, "columns", original);
      } else {
        delete (process.stdout as Record<string, unknown>)["columns"];
      }
    }
  });
});

// ─── cmdStatus (integration) ────────────────────────────────────────────────

describe("cmdStatus", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let logOutput: string[];

  function setupLogSpy() {
    logOutput = [];
    logSpy = vi
      .spyOn(console, "log")
      .mockImplementation((...args: unknown[]) => {
        logOutput.push(args.map(String).join(" "));
      });
  }

  function teardownLogSpy() {
    logSpy.mockRestore();
  }

  function allOutput(): string {
    return stripAnsi(logOutput.join("\n"));
  }

  it("shows 'No active items' when worktreeDir does not exist", () => {
    setupLogSpy();
    try {
      cmdStatus("/nonexistent/path/.worktrees", "/nonexistent/path");
      const output = allOutput();
      expect(output).toContain("No active items");
      expect(output).toContain("ninthwave status");
    } finally {
      teardownLogSpy();
    }
  });

  it("shows worktreeDir path when it does not exist", () => {
    setupLogSpy();
    try {
      cmdStatus(
        "/nonexistent/path/.worktrees",
        "/nonexistent/path",
      );
      const output = allOutput();
      expect(output).toContain("/nonexistent/path/.worktrees");
      expect(output).toContain("not found");
    } finally {
      teardownLogSpy();
    }
  });

  it("shows getting-started hints when worktreeDir does not exist", () => {
    setupLogSpy();
    try {
      cmdStatus("/nonexistent/path/.worktrees", "/nonexistent/path");
      const output = allOutput();
      expect(output).toContain("To get started:");
      expect(output).toContain("ninthwave list --ready");
    } finally {
      teardownLogSpy();
    }
  });

  it("shows 'No active items' when worktreeDir exists but has no todo-* entries", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "nw-status-test-"));
    const worktreeDir = join(tmpDir, ".worktrees");
    mkdirSync(worktreeDir);
    // Add a non-todo file to ensure it's not picked up
    writeFileSync(join(worktreeDir, "some-other-file"), "");

    setupLogSpy();
    try {
      cmdStatus(worktreeDir, tmpDir);
      const output = allOutput();
      expect(output).toContain("No active items");
      expect(output).toContain("ninthwave status");
    } finally {
      teardownLogSpy();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("shows getting-started hints when worktreeDir exists but is empty", () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "nw-status-test-"));
    const worktreeDir = join(tmpDir, ".worktrees");
    mkdirSync(worktreeDir);

    setupLogSpy();
    try {
      cmdStatus(worktreeDir, tmpDir);
      const output = allOutput();
      expect(output).toContain("To get started:");
    } finally {
      teardownLogSpy();
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ─── cmdStatusWatch ──────────────────────────────────────────────────────────

describe("cmdStatusWatch", () => {
  it("--watch triggers a polling refresh loop that stops on abort", async () => {
    const controller = new AbortController();
    let iterations = 0;

    // Spy on stdout.write to count screen clears
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    // Spy on console.log to suppress output
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Abort after 2 iterations using a very short interval
    const watchPromise = cmdStatusWatch(
      "/nonexistent",
      "/nonexistent",
      10, // 10ms interval for fast testing
      controller.signal,
    );

    // Wait a bit for a few iterations, then abort
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    controller.abort();
    await watchPromise;

    // Screen clear sequence should have been written multiple times
    const clearCalls = writeSpy.mock.calls.filter(
      (call) => typeof call[0] === "string" && (call[0] as string).includes("\x1B[2J"),
    );
    expect(clearCalls.length).toBeGreaterThanOrEqual(1);

    writeSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("resolves immediately when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const start = Date.now();
    await cmdStatusWatch("/nonexistent", "/nonexistent", 5000, controller.signal);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(100);

    writeSpy.mockRestore();
    logSpy.mockRestore();
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeItem(
  id: string,
  state: ItemState,
  title: string = "",
  prNumber: number | null = null,
  ageMs: number = 3600000,
): StatusItem {
  return { id, title, state, prNumber, ageMs, repoLabel: "" };
}
