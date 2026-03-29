// Tests for watch commands: cmdWatchReady, cmdPrWatch.

import { describe, it, expect, vi, afterEach, type Mock } from "vitest";
import { join } from "path";
import { mkdirSync, writeFileSync } from "fs";
import { setupTempRepo, cleanupTempRepos, captureOutput, captureOutputAsync } from "./helpers.ts";
import {
  type PrMonitorDeps,
  cmdWatchReady,
  cmdPrWatch,
  cmdPrActivity,
  checkPrStatus,
  processChecks,
  findTransitions,
  findGoneItems,
  TRUSTED_ASSOC,
  CI_FAILURE_STATES,
} from "../core/commands/pr-monitor.ts";

/** Create mock PrMonitorDeps for dependency injection. */
function createMockPrMonitorDeps(): PrMonitorDeps & Record<string, Mock> {
  return {
    prList: vi.fn(() => ({ ok: true as const, data: [] as Array<{ number: number; title: string }> })),
    prView: vi.fn(() => ({ ok: true as const, data: {} as Record<string, unknown> })),
    prChecks: vi.fn(() => ({ ok: true as const, data: [] as Array<{ state: string; name: string; url: string; completedAt?: string }> })),
    isAvailable: vi.fn(() => true),
    getRepoOwner: vi.fn(() => "owner/repo"),
    apiGet: vi.fn(() => "0"),
  };
}

describe("cmdWatchReady", () => {
  afterEach(() => cleanupTempRepos());

  it("reports no active worktrees when directory doesn't exist", () => {
    const deps = createMockPrMonitorDeps();
    const repo = setupTempRepo();
    const worktreeDir = join(repo, ".worktrees");

    const output = captureOutput(() =>
      cmdWatchReady(worktreeDir, repo, true, deps),
    );

    expect(output).toContain("No active worktrees");
  });

  it("classifies merged PRs as merged", () => {
    const deps = createMockPrMonitorDeps();
    const repo = setupTempRepo();
    const worktreeDir = join(repo, ".worktrees");
    mkdirSync(join(worktreeDir, "ninthwave-H-CI-2"), { recursive: true });

    // No open PRs, but has merged PRs
    deps.prList.mockImplementation(
      (_root: string, _branch: string, state: string) => {
        if (state === "open") return { ok: true, data: [] };
        if (state === "merged") return { ok: true, data: [{ number: 42 }] };
        return { ok: true, data: [] };
      },
    );

    const result = cmdWatchReady(worktreeDir, repo, true, deps);
    expect(result).toContain("H-CI-2");
    expect(result).toContain("merged");
  });

  it("classifies items with no PR as no-pr", () => {
    const deps = createMockPrMonitorDeps();
    const repo = setupTempRepo();
    const worktreeDir = join(repo, ".worktrees");
    mkdirSync(join(worktreeDir, "ninthwave-M-CI-1"), { recursive: true });

    deps.prList.mockReturnValue({ ok: true, data: [] });

    const result = cmdWatchReady(worktreeDir, repo, true, deps);
    expect(result).toContain("M-CI-1");
    expect(result).toContain("no-pr");
  });

  it("classifies failing CI as failing", () => {
    const deps = createMockPrMonitorDeps();
    const repo = setupTempRepo();
    const worktreeDir = join(repo, ".worktrees");
    mkdirSync(join(worktreeDir, "ninthwave-H-CI-2"), { recursive: true });

    deps.prList.mockImplementation(
      (_root: string, _branch: string, state: string) => {
        if (state === "open") return { ok: true, data: [{ number: 10 }] };
        return { ok: true, data: [] };
      },
    );
    deps.prView.mockReturnValue({ ok: true, data: {
      reviewDecision: "",
      mergeable: "MERGEABLE",
    } });
    deps.prChecks.mockReturnValue({ ok: true, data: [
      { state: "FAILURE", name: "test", url: "" },
    ] });

    const result = cmdWatchReady(worktreeDir, repo, true, deps);
    expect(result).toContain("failing");
  });

  it("classifies passing CI with approval as ready", () => {
    const deps = createMockPrMonitorDeps();
    const repo = setupTempRepo();
    const worktreeDir = join(repo, ".worktrees");
    mkdirSync(join(worktreeDir, "ninthwave-H-CI-2"), { recursive: true });

    deps.prList.mockImplementation(
      (_root: string, _branch: string, state: string) => {
        if (state === "open") return { ok: true, data: [{ number: 10 }] };
        return { ok: true, data: [] };
      },
    );
    deps.prView.mockReturnValue({ ok: true, data: {
      reviewDecision: "APPROVED",
      mergeable: "MERGEABLE",
    } });
    deps.prChecks.mockReturnValue({ ok: true, data: [
      { state: "SUCCESS", name: "test", url: "" },
    ] });

    const result = cmdWatchReady(worktreeDir, repo, true, deps);
    expect(result).toContain("ready");
    // Ensure it's not ci-passed (which also contains "passed")
    expect(result).not.toContain("ci-passed");
  });

  it("classifies passing CI without approval as ci-passed", () => {
    const deps = createMockPrMonitorDeps();
    const repo = setupTempRepo();
    const worktreeDir = join(repo, ".worktrees");
    mkdirSync(join(worktreeDir, "ninthwave-H-CI-2"), { recursive: true });

    deps.prList.mockImplementation(
      (_root: string, _branch: string, state: string) => {
        if (state === "open") return { ok: true, data: [{ number: 10 }] };
        return { ok: true, data: [] };
      },
    );
    deps.prView.mockReturnValue({ ok: true, data: {
      reviewDecision: "",
      mergeable: "MERGEABLE",
    } });
    deps.prChecks.mockReturnValue({ ok: true, data: [
      { state: "SUCCESS", name: "test", url: "" },
    ] });

    const result = cmdWatchReady(worktreeDir, repo, true, deps);
    expect(result).toContain("ci-passed");
  });

  it("classifies passing CI with non-mergeable as ci-passed", () => {
    const deps = createMockPrMonitorDeps();
    const repo = setupTempRepo();
    const worktreeDir = join(repo, ".worktrees");
    mkdirSync(join(worktreeDir, "ninthwave-H-CI-2"), { recursive: true });

    deps.prList.mockImplementation(
      (_root: string, _branch: string, state: string) => {
        if (state === "open") return { ok: true, data: [{ number: 10 }] };
        return { ok: true, data: [] };
      },
    );
    deps.prView.mockReturnValue({ ok: true, data: {
      reviewDecision: "APPROVED",
      mergeable: "CONFLICTING",
    } });
    deps.prChecks.mockReturnValue({ ok: true, data: [
      { state: "SUCCESS", name: "test", url: "" },
    ] });

    const result = cmdWatchReady(worktreeDir, repo, true, deps);
    expect(result).toContain("ci-passed");
  });

  it("classifies pending CI as pending", () => {
    const deps = createMockPrMonitorDeps();
    const repo = setupTempRepo();
    const worktreeDir = join(repo, ".worktrees");
    mkdirSync(join(worktreeDir, "ninthwave-M-CI-1"), { recursive: true });

    deps.prList.mockImplementation(
      (_root: string, _branch: string, state: string) => {
        if (state === "open") return { ok: true, data: [{ number: 5 }] };
        return { ok: true, data: [] };
      },
    );
    deps.prView.mockReturnValue({ ok: true, data: {
      reviewDecision: "",
      mergeable: "MERGEABLE",
    } });
    deps.prChecks.mockReturnValue({ ok: true, data: [
      { state: "PENDING", name: "build", url: "" },
    ] });

    const result = cmdWatchReady(worktreeDir, repo, true, deps);
    expect(result).toContain("pending");
  });
});

describe("cmdPrWatch", () => {
  afterEach(() => cleanupTempRepos());

  it("dies without --pr argument", async () => {
    const deps = createMockPrMonitorDeps();
    const repo = setupTempRepo();

    const output = await captureOutputAsync(() =>
      cmdPrWatch([], repo, deps),
    );

    expect(output).toContain("Usage");
  });

  it("detects activity on first poll", async () => {
    const deps = createMockPrMonitorDeps();
    const repo = setupTempRepo();

    // Return activity count > 0 on first poll
    deps.apiGet.mockReturnValue("3");

    const output = await captureOutputAsync(() =>
      cmdPrWatch(["--pr", "42", "--interval", "0", "--since", "2026-01-01T00:00:00Z"], repo, deps),
    );

    expect(output).toContain("activity");
    expect(output).toContain("42");
  });
});

// =============================================================================
// Direct tests for exported helper functions
// =============================================================================

describe("checkPrStatus", () => {
  it("returns merged status when PR is merged", () => {
    const deps = createMockPrMonitorDeps();
    deps.prList.mockImplementation(
      (_root: string, _branch: string, state: string) => {
        if (state === "open") return { ok: true, data: [] };
        if (state === "merged") return { ok: true, data: [{ number: 99, title: "fix: some work (H-1-1)" }] };
        return { ok: true, data: [] };
      },
    );

    const result = checkPrStatus("H-1-1", "/fake/repo", deps);
    expect(result).toBe("H-1-1\t99\tmerged\t\t\tfix: some work (H-1-1)");
  });

  it("returns no-pr when no PR exists", () => {
    const deps = createMockPrMonitorDeps();
    deps.prList.mockReturnValue({ ok: true, data: [] });

    const result = checkPrStatus("H-1-1", "/fake/repo", deps);
    expect(result).toBe("H-1-1\t\tno-pr");
  });

  it("returns empty string when gh is not available", () => {
    const deps = createMockPrMonitorDeps();
    deps.isAvailable.mockReturnValue(false);

    const result = checkPrStatus("H-1-1", "/fake/repo", deps);
    expect(result).toBe("");
  });

  it("returns ready when CI passes and PR is approved and mergeable", () => {
    const deps = createMockPrMonitorDeps();
    deps.prList.mockImplementation(
      (_root: string, _branch: string, state: string) => {
        if (state === "open") return { ok: true, data: [{ number: 10 }] };
        return { ok: true, data: [] };
      },
    );
    deps.prView.mockReturnValue({ ok: true, data: {
      reviewDecision: "APPROVED",
      mergeable: "MERGEABLE",
    } });
    deps.prChecks.mockReturnValue({ ok: true, data: [
      { state: "SUCCESS", name: "test", url: "" },
    ] });

    const result = checkPrStatus("H-1-1", "/fake/repo", deps);
    expect(result).toBe("H-1-1\t10\tready\tMERGEABLE\t");
  });

  it("returns ci-passed when CI passes but not approved", () => {
    const deps = createMockPrMonitorDeps();
    deps.prList.mockImplementation(
      (_root: string, _branch: string, state: string) => {
        if (state === "open") return { ok: true, data: [{ number: 10 }] };
        return { ok: true, data: [] };
      },
    );
    deps.prView.mockReturnValue({ ok: true, data: {
      reviewDecision: "",
      mergeable: "MERGEABLE",
    } });
    deps.prChecks.mockReturnValue({ ok: true, data: [
      { state: "SUCCESS", name: "test", url: "" },
    ] });

    const result = checkPrStatus("H-1-1", "/fake/repo", deps);
    expect(result).toBe("H-1-1\t10\tci-passed\tMERGEABLE\t");
  });

  it("returns ci-passed when CI passes but not mergeable", () => {
    const deps = createMockPrMonitorDeps();
    deps.prList.mockImplementation(
      (_root: string, _branch: string, state: string) => {
        if (state === "open") return { ok: true, data: [{ number: 10 }] };
        return { ok: true, data: [] };
      },
    );
    deps.prView.mockReturnValue({ ok: true, data: {
      reviewDecision: "APPROVED",
      mergeable: "CONFLICTING",
    } });
    deps.prChecks.mockReturnValue({ ok: true, data: [
      { state: "SUCCESS", name: "test", url: "" },
    ] });

    const result = checkPrStatus("H-1-1", "/fake/repo", deps);
    expect(result).toBe("H-1-1\t10\tci-passed\tCONFLICTING\t");
  });

  it("returns failing when CI fails", () => {
    const deps = createMockPrMonitorDeps();
    deps.prList.mockImplementation(
      (_root: string, _branch: string, state: string) => {
        if (state === "open") return { ok: true, data: [{ number: 10 }] };
        return { ok: true, data: [] };
      },
    );
    deps.prView.mockReturnValue({ ok: true, data: { reviewDecision: "", mergeable: "MERGEABLE" } });
    deps.prChecks.mockReturnValue({ ok: true, data: [
      { state: "FAILURE", name: "test", url: "" },
    ] });

    const result = checkPrStatus("H-1-1", "/fake/repo", deps);
    expect(result).toBe("H-1-1\t10\tfailing\tMERGEABLE\t");
  });

  it("returns pending when CI is pending", () => {
    const deps = createMockPrMonitorDeps();
    deps.prList.mockImplementation(
      (_root: string, _branch: string, state: string) => {
        if (state === "open") return { ok: true, data: [{ number: 10 }] };
        return { ok: true, data: [] };
      },
    );
    deps.prView.mockReturnValue({ ok: true, data: { reviewDecision: "", mergeable: "MERGEABLE" } });
    deps.prChecks.mockReturnValue({ ok: true, data: [
      { state: "PENDING", name: "build", url: "" },
    ] });

    const result = checkPrStatus("H-1-1", "/fake/repo", deps);
    expect(result).toBe("H-1-1\t10\tpending\tMERGEABLE\t");
  });

  // ── CI failure state detection (H-ORC-1) ─────────────────────

  it("returns failing for ERROR check state (commit status API)", () => {
    const deps = createMockPrMonitorDeps();
    deps.prList.mockImplementation((_root: string, _branch: string, state: string) => {
      if (state === "open") return { ok: true, data: [{ number: 10 }] };
      return { ok: true, data: [] };
    });
    deps.prView.mockReturnValue({ ok: true, data: { reviewDecision: "", mergeable: "MERGEABLE" } });
    deps.prChecks.mockReturnValue({ ok: true, data: [{ state: "ERROR", name: "test", url: "" }] });

    const result = checkPrStatus("H-1-1", "/fake/repo", deps);
    expect(result).toBe("H-1-1\t10\tfailing\tMERGEABLE\t");
  });

  it("returns failing for CANCELLED check state", () => {
    const deps = createMockPrMonitorDeps();
    deps.prList.mockImplementation((_root: string, _branch: string, state: string) => {
      if (state === "open") return { ok: true, data: [{ number: 10 }] };
      return { ok: true, data: [] };
    });
    deps.prView.mockReturnValue({ ok: true, data: { reviewDecision: "", mergeable: "MERGEABLE" } });
    deps.prChecks.mockReturnValue({ ok: true, data: [{ state: "CANCELLED", name: "build", url: "" }] });

    const result = checkPrStatus("H-1-1", "/fake/repo", deps);
    expect(result).toBe("H-1-1\t10\tfailing\tMERGEABLE\t");
  });

  it("returns failing for TIMED_OUT check state", () => {
    const deps = createMockPrMonitorDeps();
    deps.prList.mockImplementation((_root: string, _branch: string, state: string) => {
      if (state === "open") return { ok: true, data: [{ number: 10 }] };
      return { ok: true, data: [] };
    });
    deps.prView.mockReturnValue({ ok: true, data: { reviewDecision: "", mergeable: "MERGEABLE" } });
    deps.prChecks.mockReturnValue({ ok: true, data: [{ state: "TIMED_OUT", name: "build", url: "" }] });

    const result = checkPrStatus("H-1-1", "/fake/repo", deps);
    expect(result).toBe("H-1-1\t10\tfailing\tMERGEABLE\t");
  });

  it("returns failing for STARTUP_FAILURE check state", () => {
    const deps = createMockPrMonitorDeps();
    deps.prList.mockImplementation((_root: string, _branch: string, state: string) => {
      if (state === "open") return { ok: true, data: [{ number: 10 }] };
      return { ok: true, data: [] };
    });
    deps.prView.mockReturnValue({ ok: true, data: { reviewDecision: "", mergeable: "MERGEABLE" } });
    deps.prChecks.mockReturnValue({ ok: true, data: [{ state: "STARTUP_FAILURE", name: "build", url: "" }] });

    const result = checkPrStatus("H-1-1", "/fake/repo", deps);
    expect(result).toBe("H-1-1\t10\tfailing\tMERGEABLE\t");
  });

  it("returns failing when mix of SUCCESS and ERROR checks", () => {
    const deps = createMockPrMonitorDeps();
    deps.prList.mockImplementation((_root: string, _branch: string, state: string) => {
      if (state === "open") return { ok: true, data: [{ number: 10 }] };
      return { ok: true, data: [] };
    });
    deps.prView.mockReturnValue({ ok: true, data: { reviewDecision: "", mergeable: "MERGEABLE" } });
    deps.prChecks.mockReturnValue({ ok: true, data: [
      { state: "SUCCESS", name: "lint", url: "" },
      { state: "ERROR", name: "test", url: "" },
    ] });

    const result = checkPrStatus("H-1-1", "/fake/repo", deps);
    expect(result).toBe("H-1-1\t10\tfailing\tMERGEABLE\t");
  });

  it("includes CONFLICTING mergeable status in 4th field", () => {
    const deps = createMockPrMonitorDeps();
    deps.prList.mockImplementation((_root: string, _branch: string, state: string) => {
      if (state === "open") return { ok: true, data: [{ number: 10 }] };
      return { ok: true, data: [] };
    });
    deps.prView.mockReturnValue({ ok: true, data: { reviewDecision: "", mergeable: "CONFLICTING" } });
    deps.prChecks.mockReturnValue({ ok: true, data: [{ state: "FAILURE", name: "test", url: "" }] });

    const result = checkPrStatus("H-1-1", "/fake/repo", deps);
    expect(result).toBe("H-1-1\t10\tfailing\tCONFLICTING\t");
  });

  it("returns UNKNOWN when mergeable field is empty", () => {
    const deps = createMockPrMonitorDeps();
    deps.prList.mockImplementation((_root: string, _branch: string, state: string) => {
      if (state === "open") return { ok: true, data: [{ number: 10 }] };
      return { ok: true, data: [] };
    });
    deps.prView.mockReturnValue({ ok: true, data: { reviewDecision: "", mergeable: "" } });
    deps.prChecks.mockReturnValue({ ok: true, data: [{ state: "PENDING", name: "build", url: "" }] });

    const result = checkPrStatus("H-1-1", "/fake/repo", deps);
    expect(result).toBe("H-1-1\t10\tpending\tUNKNOWN\t");
  });

  it("includes completedAt from CI checks as eventTime in 5th field", () => {
    const deps = createMockPrMonitorDeps();
    deps.prList.mockImplementation((_root: string, _branch: string, state: string) => {
      if (state === "open") return { ok: true, data: [{ number: 10 }] };
      return { ok: true, data: [] };
    });
    deps.prView.mockReturnValue({ ok: true, data: {
      reviewDecision: "", mergeable: "MERGEABLE", updatedAt: "2026-03-24T10:00:00Z",
    } });
    deps.prChecks.mockReturnValue({ ok: true, data: [
      { state: "SUCCESS", name: "test", url: "", completedAt: "2026-03-24T10:05:00Z" },
    ] });

    const result = checkPrStatus("H-1-1", "/fake/repo", deps);
    expect(result).toBe("H-1-1\t10\tci-passed\tMERGEABLE\t2026-03-24T10:05:00Z");
  });

  it("uses updatedAt as eventTime when CI has no completedAt", () => {
    const deps = createMockPrMonitorDeps();
    deps.prList.mockImplementation((_root: string, _branch: string, state: string) => {
      if (state === "open") return { ok: true, data: [{ number: 10 }] };
      return { ok: true, data: [] };
    });
    deps.prView.mockReturnValue({ ok: true, data: {
      reviewDecision: "", mergeable: "MERGEABLE", updatedAt: "2026-03-24T10:00:00Z",
    } });
    deps.prChecks.mockReturnValue({ ok: true, data: [{ state: "PENDING", name: "build", url: "" }] });

    const result = checkPrStatus("H-1-1", "/fake/repo", deps);
    expect(result).toBe("H-1-1\t10\tpending\tMERGEABLE\t2026-03-24T10:00:00Z");
  });

  it("uses latest completedAt when multiple checks complete", () => {
    const deps = createMockPrMonitorDeps();
    deps.prList.mockImplementation((_root: string, _branch: string, state: string) => {
      if (state === "open") return { ok: true, data: [{ number: 10 }] };
      return { ok: true, data: [] };
    });
    deps.prView.mockReturnValue({ ok: true, data: {
      reviewDecision: "", mergeable: "MERGEABLE", updatedAt: "2026-03-24T10:00:00Z",
    } });
    deps.prChecks.mockReturnValue({ ok: true, data: [
      { state: "SUCCESS", name: "lint", url: "", completedAt: "2026-03-24T10:03:00Z" },
      { state: "SUCCESS", name: "test", url: "", completedAt: "2026-03-24T10:05:00Z" },
    ] });

    const result = checkPrStatus("H-1-1", "/fake/repo", deps);
    expect(result).toBe("H-1-1\t10\tci-passed\tMERGEABLE\t2026-03-24T10:05:00Z");
  });
});

describe("CI_FAILURE_STATES", () => {
  it("includes all expected failure states", () => {
    expect(CI_FAILURE_STATES.has("FAILURE")).toBe(true);
    expect(CI_FAILURE_STATES.has("ERROR")).toBe(true);
    expect(CI_FAILURE_STATES.has("CANCELLED")).toBe(true);
    expect(CI_FAILURE_STATES.has("TIMED_OUT")).toBe(true);
    expect(CI_FAILURE_STATES.has("STARTUP_FAILURE")).toBe(true);
    expect(CI_FAILURE_STATES.has("ACTION_REQUIRED")).toBe(true);
  });

  it("does not include non-failure states", () => {
    expect(CI_FAILURE_STATES.has("SUCCESS")).toBe(false);
    expect(CI_FAILURE_STATES.has("PENDING")).toBe(false);
    expect(CI_FAILURE_STATES.has("SKIPPED")).toBe(false);
    expect(CI_FAILURE_STATES.has("NEUTRAL")).toBe(false);
  });
});

describe("cmdWatchReady cross-repo", () => {
  afterEach(() => cleanupTempRepos());

  it("checks cross-repo worktrees from the cross-repo index", () => {
    const deps = createMockPrMonitorDeps();
    const repo = setupTempRepo();
    const worktreeDir = join(repo, ".worktrees");
    mkdirSync(worktreeDir, { recursive: true });

    // Write cross-repo index with an entry pointing to a different repo
    const indexPath = join(worktreeDir, ".cross-repo-index");
    writeFileSync(indexPath, "X-CR-1\t/target-repo\t/target-repo/.worktrees/ninthwave-X-CR-1\n");

    // Mock prList to return no-pr for this cross-repo item
    deps.prList.mockReturnValue({ ok: true, data: [] });

    const result = cmdWatchReady(worktreeDir, repo, true, deps);
    expect(result).toContain("X-CR-1");
    expect(result).toContain("no-pr");
  });

  it("handles missing cross-repo index gracefully", () => {
    const deps = createMockPrMonitorDeps();
    const repo = setupTempRepo();
    const worktreeDir = join(repo, ".worktrees");
    mkdirSync(worktreeDir, { recursive: true });
    // No .cross-repo-index file -- should not crash

    deps.prList.mockReturnValue({ ok: true, data: [] });

    const result = cmdWatchReady(worktreeDir, repo, true, deps);
    expect(result).toBe("");
  });
});

describe("cmdWatchReady with print=false (replaces getWatchReadyState)", () => {
  afterEach(() => cleanupTempRepos());

  it("returns empty string when worktree dir does not exist", () => {
    const deps = createMockPrMonitorDeps();
    const result = cmdWatchReady("/nonexistent/path", "/fake/repo", false, deps);
    expect(result).toBe("");
  });

  it("returns status lines for worktrees", () => {
    const deps = createMockPrMonitorDeps();
    const repo = setupTempRepo();
    const worktreeDir = join(repo, ".worktrees");
    mkdirSync(join(worktreeDir, "ninthwave-A-1-1"), { recursive: true });
    mkdirSync(join(worktreeDir, "ninthwave-B-2-1"), { recursive: true });

    deps.prList.mockReturnValue({ ok: true, data: [] });

    const result = cmdWatchReady(worktreeDir, repo, false, deps);
    expect(result).toContain("A-1-1");
    expect(result).toContain("B-2-1");
    expect(result).toContain("no-pr");
  });

  it("skips non-item entries", () => {
    const deps = createMockPrMonitorDeps();
    const repo = setupTempRepo();
    const worktreeDir = join(repo, ".worktrees");
    mkdirSync(join(worktreeDir, "ninthwave-A-1-1"), { recursive: true });
    mkdirSync(join(worktreeDir, "other-dir"), { recursive: true });

    deps.prList.mockReturnValue({ ok: true, data: [] });

    const result = cmdWatchReady(worktreeDir, repo, false, deps);
    expect(result).toContain("A-1-1");
    expect(result).not.toContain("other-dir");
  });
});

describe("cmdWatchReady cross-repo with print=false", () => {
  afterEach(() => cleanupTempRepos());

  it("includes cross-repo worktrees in state output", () => {
    const deps = createMockPrMonitorDeps();
    const repo = setupTempRepo();
    const worktreeDir = join(repo, ".worktrees");
    mkdirSync(worktreeDir, { recursive: true });

    // Write cross-repo index
    const indexPath = join(worktreeDir, ".cross-repo-index");
    writeFileSync(indexPath, "X-CR-2\t/other-repo\t/other-repo/.worktrees/ninthwave-X-CR-2\n");

    deps.prList.mockReturnValue({ ok: true, data: [] });

    const result = cmdWatchReady(worktreeDir, repo, false, deps);
    expect(result).toContain("X-CR-2");
    expect(result).toContain("no-pr");
  });
});

describe("processChecks", () => {
  it("returns pass when all checks succeed", () => {
    const result = processChecks([
      { state: "SUCCESS", name: "test", completedAt: "2026-01-01T01:00:00Z" },
      { state: "SUCCESS", name: "lint", completedAt: "2026-01-01T01:05:00Z" },
    ]);
    expect(result.ciStatus).toBe("pass");
    expect(result.eventTime).toBe("2026-01-01T01:05:00Z");
  });

  it("returns fail when any check has a failure state", () => {
    const result = processChecks([
      { state: "SUCCESS", name: "lint", completedAt: "2026-01-01T01:00:00Z" },
      { state: "FAILURE", name: "test", completedAt: "2026-01-01T01:10:00Z" },
    ]);
    expect(result.ciStatus).toBe("fail");
    expect(result.eventTime).toBe("2026-01-01T01:10:00Z");
  });

  it("returns pending when some checks are still running", () => {
    const result = processChecks([
      { state: "SUCCESS", name: "lint", completedAt: "2026-01-01T01:00:00Z" },
      { state: "PENDING", name: "test" },
    ]);
    expect(result.ciStatus).toBe("pending");
    expect(result.eventTime).toBeUndefined();
  });

  it("returns unknown when all checks are skipped", () => {
    const result = processChecks([
      { state: "SKIPPED", name: "optional-check" },
    ]);
    expect(result.ciStatus).toBe("unknown");
    expect(result.eventTime).toBeUndefined();
  });

  it("returns unknown when no checks exist", () => {
    const result = processChecks([]);
    expect(result.ciStatus).toBe("unknown");
    expect(result.eventTime).toBeUndefined();
  });

  it("ignores skipped checks when determining status", () => {
    const result = processChecks([
      { state: "SKIPPED", name: "optional" },
      { state: "SUCCESS", name: "required", completedAt: "2026-01-01T02:00:00Z" },
    ]);
    expect(result.ciStatus).toBe("pass");
    expect(result.eventTime).toBe("2026-01-01T02:00:00Z");
  });

  it("detects all CI failure states", () => {
    for (const failState of ["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "STARTUP_FAILURE", "ACTION_REQUIRED"]) {
      const result = processChecks([
        { state: failState, name: "check", completedAt: "2026-01-01T01:00:00Z" },
      ]);
      expect(result.ciStatus).toBe("fail");
    }
  });

  it("fail takes precedence over pending", () => {
    const result = processChecks([
      { state: "PENDING", name: "lint" },
      { state: "FAILURE", name: "test", completedAt: "2026-01-01T01:00:00Z" },
    ]);
    expect(result.ciStatus).toBe("fail");
  });

  it("returns eventTime from latest completedAt on pass", () => {
    const result = processChecks([
      { state: "SUCCESS", name: "fast", completedAt: "2026-01-01T01:00:00Z" },
      { state: "SUCCESS", name: "slow", completedAt: "2026-01-01T02:00:00Z" },
      { state: "SUCCESS", name: "mid", completedAt: "2026-01-01T01:30:00Z" },
    ]);
    expect(result.eventTime).toBe("2026-01-01T02:00:00Z");
  });

  it("returns undefined eventTime when checks have no completedAt", () => {
    const result = processChecks([
      { state: "SUCCESS", name: "test" },
    ]);
    expect(result.ciStatus).toBe("pass");
    expect(result.eventTime).toBeUndefined();
  });
});

describe("findTransitions", () => {
  it("detects status change from pending to ready", () => {
    const prev = "H-1-1\t10\tpending";
    const curr = "H-1-1\t10\tready";

    const result = findTransitions(curr, prev);
    expect(result).toBe("H-1-1\t10\tpending\tready\n");
  });

  it("detects status change from pending to ci-passed", () => {
    const prev = "H-1-1\t10\tpending";
    const curr = "H-1-1\t10\tci-passed";

    const result = findTransitions(curr, prev);
    expect(result).toBe("H-1-1\t10\tpending\tci-passed\n");
  });

  it("detects status change from ci-passed to ready", () => {
    const prev = "H-1-1\t10\tci-passed";
    const curr = "H-1-1\t10\tready";

    const result = findTransitions(curr, prev);
    expect(result).toBe("H-1-1\t10\tci-passed\tready\n");
  });

  it("returns empty string when no transitions", () => {
    const state = "H-1-1\t10\tpending";
    const result = findTransitions(state, state);
    expect(result).toBe("");
  });

  it("handles new items not in previous state", () => {
    const prev = "";
    const curr = "H-1-1\t10\tpending";

    const result = findTransitions(curr, prev);
    // New item: prevStatus defaults to "no-pr", current is "pending"
    expect(result).toBe("H-1-1\t10\tno-pr\tpending\n");
  });

  it("handles multiple items with mixed transitions", () => {
    const prev = "A-1-1\t10\tpending\nB-2-1\t20\tfailing";
    const curr = "A-1-1\t10\tci-passed\nB-2-1\t20\tfailing";

    const result = findTransitions(curr, prev);
    expect(result).toContain("A-1-1\t10\tpending\tci-passed\n");
    expect(result).not.toContain("B-2-1");
  });
});

describe("findGoneItems", () => {
  it("detects items that disappeared", () => {
    const prev = "H-1-1\t10\tready\nH-2-1\t20\tpending";
    const curr = "H-1-1\t10\tready";

    const result = findGoneItems(curr, prev);
    expect(result).toBe("H-2-1\t20\tpending\tgone\n");
  });

  it("returns empty string when no items disappeared", () => {
    const state = "H-1-1\t10\tready";
    const result = findGoneItems(state, state);
    expect(result).toBe("");
  });

  it("returns empty string when no previous state", () => {
    const result = findGoneItems("H-1-1\t10\tready", "");
    expect(result).toBe("");
  });

  it("detects multiple gone items", () => {
    const prev = "A-1-1\t10\tready\nB-2-1\t20\tpending\nC-3-1\t30\tfailing";
    const curr = "B-2-1\t20\tpending";

    const result = findGoneItems(curr, prev);
    expect(result).toContain("A-1-1\t10\tready\tgone\n");
    expect(result).toContain("C-3-1\t30\tfailing\tgone\n");
    expect(result).not.toContain("B-2-1");
  });
});

// =============================================================================
// Author association filtering tests
// =============================================================================

describe("TRUSTED_ASSOC constant", () => {
  it("includes OWNER, MEMBER, and COLLABORATOR associations", () => {
    expect(TRUSTED_ASSOC).toContain("OWNER");
    expect(TRUSTED_ASSOC).toContain("MEMBER");
    expect(TRUSTED_ASSOC).toContain("COLLABORATOR");
  });

  it("does not include untrusted associations", () => {
    expect(TRUSTED_ASSOC).not.toContain("NONE");
    expect(TRUSTED_ASSOC).not.toContain("FIRST_TIME_CONTRIBUTOR");
    expect(TRUSTED_ASSOC).not.toContain("CONTRIBUTOR");
  });
});

describe("cmdPrActivity author_association filtering", () => {
  afterEach(() => cleanupTempRepos());

  it("passes author_association filter in jq queries", () => {
    const deps = createMockPrMonitorDeps();
    const repo = setupTempRepo();

    // Track all apiGet calls to verify jq filters
    deps.apiGet.mockReturnValue("0");

    captureOutput(() =>
      cmdPrActivity(["42", "--since", "2026-01-01T00:00:00Z"], repo, deps),
    );

    // Every apiGet call should include the trusted association filter
    const calls = deps.apiGet.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const jqFilter = call[2] as string;
      expect(jqFilter).toContain("author_association");
      expect(jqFilter).toContain("OWNER");
      expect(jqFilter).toContain("MEMBER");
      expect(jqFilter).toContain("COLLABORATOR");
    }
  });

  it("reports no activity when only non-collaborator comments exist", () => {
    const deps = createMockPrMonitorDeps();
    const repo = setupTempRepo();

    // apiGet returns "0" for all filtered queries (no trusted comments)
    deps.apiGet.mockReturnValue("0");

    const output = captureOutput(() =>
      cmdPrActivity(["42", "--since", "2026-01-01T00:00:00Z"], repo, deps),
    );

    expect(output).toContain("42\tnone");
  });
});

describe("cmdPrWatch author_association filtering", () => {
  afterEach(() => cleanupTempRepos());

  it("passes author_association filter in jq queries for activity detection", async () => {
    const deps = createMockPrMonitorDeps();
    const repo = setupTempRepo();

    // Return > 0 count to trigger activity detection on first poll
    deps.apiGet.mockReturnValue("3");

    await captureOutputAsync(() =>
      cmdPrWatch(
        ["--pr", "42", "--interval", "0", "--since", "2026-01-01T00:00:00Z"],
        repo,
        deps,
      ),
    );

    // Check that apiGet calls include author_association filtering
    const calls = deps.apiGet.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const jqFilter = call[2] as string;
      if (jqFilter) {
        expect(jqFilter).toContain("author_association");
      }
    }
  });
});
