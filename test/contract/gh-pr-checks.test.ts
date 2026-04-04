// Contract tests for prChecks parsing and CI_FAILURE_STATES classification.
// Pins the CI check state parsing in core/gh.ts and the downstream
// classification logic in checkPrStatus (core/commands/pr-monitor.ts).
//
// Avoids vi.spyOn(shell, "run") which leaks across files (gh.test.ts also
// spies on it). Instead, spies on gh-module sync functions per project
// conventions (see async-snapshot.test.ts for the async equivalent).

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import * as gh from "../../core/gh.ts";
import { prChecks } from "../../core/gh.ts";
import { CI_FAILURE_STATES, checkPrStatus } from "../../core/commands/pr-monitor.ts";
import { checkPrStatusDetailed } from "../../core/commands/pr-monitor.ts";
import * as workflowDetect from "../../core/workflow-detect.ts";

// ── Spies on gh-module sync functions ──────────────────────────────
// These are unique to this test file (no other file spies on sync gh fns).

const isAvailableSpy = vi.spyOn(gh, "isAvailable");
const prListSpy = vi.spyOn(gh, "prList");
const prViewSpy = vi.spyOn(gh, "prView");
const prChecksSpy = vi.spyOn(gh, "prChecks");
const detectWorkflowSpy = vi.spyOn(workflowDetect, "detectWorkflowPresence");

beforeEach(() => {
  isAvailableSpy.mockReset();
  prListSpy.mockReset();
  prViewSpy.mockReset();
  prChecksSpy.mockReset();
  detectWorkflowSpy.mockReset();
  // Default: gh is available
  isAvailableSpy.mockReturnValue(true);
  // Default: no workflows detected (relevant for zero-checks path)
  detectWorkflowSpy.mockReturnValue({ hasPrWorkflows: false, hasPushWorkflows: false });
});

afterEach(() => {
  isAvailableSpy.mockReset();
  prListSpy.mockReset();
  prViewSpy.mockReset();
  prChecksSpy.mockReset();
  detectWorkflowSpy.mockReset();
});

afterAll(() => {
  isAvailableSpy.mockRestore();
  prListSpy.mockRestore();
  prViewSpy.mockRestore();
  prChecksSpy.mockRestore();
  detectWorkflowSpy.mockRestore();
});

// ── Helper: stub all gh calls for checkPrStatus ────────────────────

function stubCheckPrStatus(opts: {
  checks: { state: string; name: string; url?: string; completedAt?: string }[];
  reviewDecision?: string;
  mergeable?: string;
  createdAt?: string;
}): void {
  prListSpy.mockImplementation((_root: string, _branch: string, state: string) => {
    if (state === "open") return { ok: true, data: [{ number: 100, title: "Test PR" }] };
    return { ok: true, data: [] };
  });
  prViewSpy.mockReturnValue({ ok: true, data: {
    reviewDecision: opts.reviewDecision ?? "",
    mergeable: opts.mergeable ?? "UNKNOWN",
    updatedAt: "2026-03-29T12:00:00Z",
    ...(opts.createdAt !== undefined ? { createdAt: opts.createdAt } : {}),
  } });
  prChecksSpy.mockReturnValue({ ok: true, data:
    opts.checks.map((c) => ({
      state: c.state,
      name: c.name,
      url: c.url ?? `https://github.com/runs/${c.name}`,
      completedAt: c.completedAt,
    })),
  });
}

// ── 1. prChecks output contract ─────────────────────────────────────
// Pins the shape and field names of prChecks return values for every
// CI state value returned by gh pr checks.

describe("prChecks output contract", () => {
  const ALL_STATES = [
    "SUCCESS",
    "FAILURE",
    "PENDING",
    "STARTUP_FAILURE",
    "STALE",
    "EXPECTED",
    "CANCELLED",
    "SKIPPED",
    "TIMED_OUT",
    "ACTION_REQUIRED",
    "ERROR",
  ];

  for (const state of ALL_STATES) {
    it(`returns correct state/name/url/completedAt for ${state}`, () => {
      prChecksSpy.mockReturnValue({ ok: true, data: [
        {
          state,
          name: `ci-${state.toLowerCase()}`,
          url: `https://github.com/runs/${state}`,
          completedAt: "2026-03-29T12:34:56Z",
        },
      ] });

      const result = prChecks("/repo", 1);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(1);
        expect(result.data[0]).toEqual({
          state,
          name: `ci-${state.toLowerCase()}`,
          url: `https://github.com/runs/${state}`,
          completedAt: "2026-03-29T12:34:56Z",
        });
      }
    });
  }

  it("preserves all fields for multiple checks in a single response", () => {
    prChecksSpy.mockReturnValue({ ok: true, data: [
      { state: "SUCCESS", name: "build", url: "https://ci/1", completedAt: "2026-03-29T10:00:00Z" },
      { state: "FAILURE", name: "lint", url: "https://ci/2", completedAt: "2026-03-29T10:01:00Z" },
      { state: "PENDING", name: "deploy", url: "https://ci/3", completedAt: undefined },
    ] });

    const result = prChecks("/repo", 1);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(3);
      expect(result.data.map((c) => c.state)).toEqual(["SUCCESS", "FAILURE", "PENDING"]);
      expect(result.data.map((c) => c.name)).toEqual(["build", "lint", "deploy"]);
      expect(result.data[0]!.completedAt).toBe("2026-03-29T10:00:00Z");
      expect(result.data[2]!.completedAt).toBeUndefined();
    }
  });

  it("returns empty array when no checks exist", () => {
    prChecksSpy.mockReturnValue({ ok: true, data: [] });

    const result = prChecks("/repo", 1);
    expect(result).toEqual({ ok: true, data: [] });
  });
});

// ── 2. CI_FAILURE_STATES set ────────────────────────────────────────

describe("CI_FAILURE_STATES", () => {
  const EXPECTED_FAILURE_STATES = [
    "FAILURE",
    "ERROR",
    "CANCELLED",
    "TIMED_OUT",
    "STARTUP_FAILURE",
    "ACTION_REQUIRED",
  ];

  for (const state of EXPECTED_FAILURE_STATES) {
    it(`contains ${state}`, () => {
      expect(CI_FAILURE_STATES.has(state)).toBe(true);
    });
  }

  it("contains exactly 6 failure states", () => {
    expect(CI_FAILURE_STATES.size).toBe(6);
  });

  const NON_FAILURE_STATES = ["SUCCESS", "PENDING", "SKIPPED", "STALE", "EXPECTED"];

  for (const state of NON_FAILURE_STATES) {
    it(`does not contain ${state}`, () => {
      expect(CI_FAILURE_STATES.has(state)).toBe(false);
    });
  }
});

// ── 3. checkPrStatus downstream classification ─────────────────────
// Uses gh-module spies to control what checkPrStatus sees, verifying
// the classification logic that maps CI states to PR status values.

describe("checkPrStatus classification", () => {
  function parseStatus(line: string) {
    const parts = line.split("\t");
    return {
      id: parts[0],
      prNumber: parts[1],
      status: parts[2],
      mergeable: parts[3],
      eventTime: parts[4],
    };
  }

  // Every CI_FAILURE_STATES member should produce "failing"
  const FAILURE_STATES = [
    "FAILURE",
    "ERROR",
    "CANCELLED",
    "TIMED_OUT",
    "ACTION_REQUIRED",
    "STARTUP_FAILURE",
  ];

  for (const state of FAILURE_STATES) {
    it(`classifies single ${state} check as "failing"`, () => {
      stubCheckPrStatus({
        checks: [{ state, name: `check-${state.toLowerCase()}` }],
      });

      const result = parseStatus(checkPrStatus("TEST-1", "/repo"));
      expect(result.status).toBe("failing");
    });
  }

  it('classifies all SUCCESS checks as "ci-passed" (not APPROVED)', () => {
    stubCheckPrStatus({
      checks: [
        { state: "SUCCESS", name: "build" },
        { state: "SUCCESS", name: "test" },
      ],
    });

    const result = parseStatus(checkPrStatus("TEST-1", "/repo"));
    expect(result.status).toBe("ci-passed");
  });

  it('classifies all SUCCESS + APPROVED + MERGEABLE as "ready"', () => {
    stubCheckPrStatus({
      checks: [
        { state: "SUCCESS", name: "build" },
        { state: "SUCCESS", name: "test" },
      ],
      reviewDecision: "APPROVED",
      mergeable: "MERGEABLE",
    });

    const result = parseStatus(checkPrStatus("TEST-1", "/repo"));
    expect(result.status).toBe("ready");
  });

  it('classifies PENDING-only checks as "pending"', () => {
    stubCheckPrStatus({
      checks: [{ state: "PENDING", name: "build" }],
    });

    const result = parseStatus(checkPrStatus("TEST-1", "/repo"));
    expect(result.status).toBe("pending");
  });

  // ── Mixed-result scenarios ──────────────────────────────────────

  it("mixed: some SUCCESS + some FAILURE = failing", () => {
    stubCheckPrStatus({
      checks: [
        { state: "SUCCESS", name: "build" },
        { state: "FAILURE", name: "lint" },
      ],
    });

    const result = parseStatus(checkPrStatus("TEST-1", "/repo"));
    expect(result.status).toBe("failing");
  });

  it("mixed: some SUCCESS + some ERROR = failing", () => {
    stubCheckPrStatus({
      checks: [
        { state: "SUCCESS", name: "build" },
        { state: "ERROR", name: "deploy" },
      ],
    });

    const result = parseStatus(checkPrStatus("TEST-1", "/repo"));
    expect(result.status).toBe("failing");
  });

  it("mixed: some SUCCESS + some CANCELLED = failing", () => {
    stubCheckPrStatus({
      checks: [
        { state: "SUCCESS", name: "build" },
        { state: "CANCELLED", name: "deploy" },
      ],
    });

    const result = parseStatus(checkPrStatus("TEST-1", "/repo"));
    expect(result.status).toBe("failing");
  });

  it("mixed: some PENDING + no FAILURE = pending", () => {
    stubCheckPrStatus({
      checks: [
        { state: "SUCCESS", name: "build" },
        { state: "PENDING", name: "deploy" },
      ],
    });

    const result = parseStatus(checkPrStatus("TEST-1", "/repo"));
    expect(result.status).toBe("pending");
  });

  it("mixed: PENDING + FAILURE = failing (failure takes precedence)", () => {
    stubCheckPrStatus({
      checks: [
        { state: "PENDING", name: "build" },
        { state: "FAILURE", name: "lint" },
      ],
    });

    const result = parseStatus(checkPrStatus("TEST-1", "/repo"));
    expect(result.status).toBe("failing");
  });

  it("mixed: PENDING + TIMED_OUT = failing (failure takes precedence)", () => {
    stubCheckPrStatus({
      checks: [
        { state: "PENDING", name: "build" },
        { state: "TIMED_OUT", name: "integration" },
      ],
    });

    const result = parseStatus(checkPrStatus("TEST-1", "/repo"));
    expect(result.status).toBe("failing");
  });

  // ── SKIPPED checks exclusion ────────────────────────────────────

  it("SKIPPED checks are excluded: only SKIPPED with no createdAt = ci-passed (no CI configured)", () => {
    stubCheckPrStatus({
      checks: [{ state: "SKIPPED", name: "optional-check" }],
    });

    const result = parseStatus(checkPrStatus("TEST-1", "/repo"));
    // nonSkipped is empty, no createdAt grace period → treat as no CI → ci-passed
    expect(result.status).toBe("ci-passed");
  });

  it("SKIPPED checks are excluded: only SKIPPED with recent createdAt = pending (CI not yet registered)", () => {
    stubCheckPrStatus({
      checks: [{ state: "SKIPPED", name: "optional-check" }],
      createdAt: new Date(Date.now() - 30_000).toISOString(),
    });

    const result = parseStatus(checkPrStatus("TEST-1", "/repo"));
    // nonSkipped is empty, within grace period → wait for CI to register
    expect(result.status).toBe("pending");
  });

  it("SKIPPED + SUCCESS = ci-passed", () => {
    stubCheckPrStatus({
      checks: [
        { state: "SUCCESS", name: "build" },
        { state: "SKIPPED", name: "optional-check" },
      ],
    });

    const result = parseStatus(checkPrStatus("TEST-1", "/repo"));
    expect(result.status).toBe("ci-passed");
  });

  it("SKIPPED + FAILURE = failing", () => {
    stubCheckPrStatus({
      checks: [
        { state: "FAILURE", name: "lint" },
        { state: "SKIPPED", name: "optional-check" },
      ],
    });

    const result = parseStatus(checkPrStatus("TEST-1", "/repo"));
    expect(result.status).toBe("failing");
  });

  it("SKIPPED + PENDING = pending", () => {
    stubCheckPrStatus({
      checks: [
        { state: "PENDING", name: "build" },
        { state: "SKIPPED", name: "optional-check" },
      ],
    });

    const result = parseStatus(checkPrStatus("TEST-1", "/repo"));
    expect(result.status).toBe("pending");
  });

  // ── All-pass with many checks ───────────────────────────────────

  it("all pass: many SUCCESS checks = ci-passed", () => {
    stubCheckPrStatus({
      checks: [
        { state: "SUCCESS", name: "build" },
        { state: "SUCCESS", name: "lint" },
        { state: "SUCCESS", name: "test-unit" },
        { state: "SUCCESS", name: "test-integration" },
        { state: "SUCCESS", name: "deploy-preview" },
      ],
    });

    const result = parseStatus(checkPrStatus("TEST-1", "/repo"));
    expect(result.status).toBe("ci-passed");
  });

  // ── Realistic mixed scenarios ───────────────────────────────────

  it("realistic: SUCCESS + SKIPPED + FAILURE across many checks = failing", () => {
    stubCheckPrStatus({
      checks: [
        { state: "SUCCESS", name: "build" },
        { state: "SUCCESS", name: "lint" },
        { state: "SKIPPED", name: "deploy-preview" },
        { state: "FAILURE", name: "test-integration" },
        { state: "SUCCESS", name: "test-unit" },
      ],
    });

    const result = parseStatus(checkPrStatus("TEST-1", "/repo"));
    expect(result.status).toBe("failing");
  });

  it("realistic: SUCCESS + SKIPPED + PENDING across many checks = pending", () => {
    stubCheckPrStatus({
      checks: [
        { state: "SUCCESS", name: "build" },
        { state: "SUCCESS", name: "lint" },
        { state: "SKIPPED", name: "deploy-preview" },
        { state: "PENDING", name: "test-integration" },
        { state: "SUCCESS", name: "test-unit" },
      ],
    });

    const result = parseStatus(checkPrStatus("TEST-1", "/repo"));
    expect(result.status).toBe("pending");
  });
});

// ── 4. prChecks failure handling (no CI workflows) ────────────────────
// When gh pr checks returns an error (e.g., exit code 1 for repos with
// no check runs), the status should fall through to processChecks with
// empty data instead of losing CI status entirely.

describe("checkPrStatus with prChecks failure (repos with no CI)", () => {
  function parseStatus(line: string) {
    const parts = line.split("\t");
    return {
      id: parts[0],
      prNumber: parts[1],
      status: parts[2],
      mergeable: parts[3],
      eventTime: parts[4],
    };
  }

  function stubOpenPr(createdAt: string): void {
    prListSpy.mockImplementation((_root: string, _branch: string, state: string) => {
      if (state === "open") return { ok: true as const, data: [{ number: 100, title: "Test PR" }] };
      return { ok: true as const, data: [] };
    });
    prViewSpy.mockReturnValue({ ok: true as const, data: {
      reviewDecision: "",
      mergeable: "UNKNOWN",
      updatedAt: "2026-03-29T12:00:00Z",
      createdAt,
    } });
  }

  it("treats prChecks failure as ci-passed when past grace period and no PR workflows", () => {
    stubOpenPr(new Date(Date.now() - 3 * 60_000).toISOString()); // 3 min ago
    prChecksSpy.mockReturnValue({ ok: false as const, kind: "command-error" as const, error: "gh pr checks exited with code 1" });
    detectWorkflowSpy.mockReturnValue({ hasPrWorkflows: false, hasPushWorkflows: false });

    const result = parseStatus(checkPrStatus("TEST-1", "/repo"));
    expect(result.status).toBe("ci-passed");
  });

  it("treats prChecks failure as pending when within short grace period (no PR workflows)", () => {
    stubOpenPr(new Date(Date.now() - 5_000).toISOString()); // 5s ago -- within 15s grace
    prChecksSpy.mockReturnValue({ ok: false as const, kind: "command-error" as const, error: "gh pr checks exited with code 1" });
    detectWorkflowSpy.mockReturnValue({ hasPrWorkflows: false, hasPushWorkflows: false });

    const result = parseStatus(checkPrStatus("TEST-1", "/repo"));
    expect(result.status).toBe("pending");
  });

  it("treats prChecks failure as ci-passed when past standard grace period (has PR workflows)", () => {
    stubOpenPr(new Date(Date.now() - 3 * 60_000).toISOString()); // 3 min ago -- past 2 min grace
    prChecksSpy.mockReturnValue({ ok: false as const, kind: "command-error" as const, error: "gh pr checks exited with code 1" });
    detectWorkflowSpy.mockReturnValue({ hasPrWorkflows: true, hasPushWorkflows: true });

    const result = parseStatus(checkPrStatus("TEST-1", "/repo"));
    expect(result.status).toBe("ci-passed");
  });

  it("treats prChecks failure as pending when within standard grace period (has PR workflows)", () => {
    stubOpenPr(new Date(Date.now() - 30_000).toISOString()); // 30s ago -- within 2 min grace
    prChecksSpy.mockReturnValue({ ok: false as const, kind: "command-error" as const, error: "gh pr checks exited with code 1" });
    detectWorkflowSpy.mockReturnValue({ hasPrWorkflows: true, hasPushWorkflows: true });

    const result = parseStatus(checkPrStatus("TEST-1", "/repo"));
    expect(result.status).toBe("pending");
  });

  it("preserves failure info on the PrStatusPollResult when prChecks fails", () => {
    stubOpenPr(new Date(Date.now() - 3 * 60_000).toISOString());
    prChecksSpy.mockReturnValue({ ok: false as const, kind: "command-error" as const, error: "gh pr checks exited with code 1" });
    detectWorkflowSpy.mockReturnValue({ hasPrWorkflows: false, hasPushWorkflows: false });

    const result = checkPrStatusDetailed("TEST-1", "/repo");
    expect(result.failure).toBeDefined();
    expect(result.failure!.kind).toBe("command-error");
    expect(result.failure!.stage).toBe("prChecks");
    // Status line should still contain valid CI status
    expect(result.statusLine).toContain("ci-passed");
  });
});
