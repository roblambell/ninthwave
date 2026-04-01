// Contract tests for checkPrStatus -- pins the tab-separated format contract
// between the orchestrator's state machine and the gh CLI output.
//
// Each status path (no-pr, merged, pending, failing, ci-passed, ready) has
// fixture-driven assertions that verify exact field layout and content.
// When GitHub changes their gh CLI output format, these tests break first.
//
// Uses vi.spyOn on gh module functions (not vi.mock) per project conventions.
// Spies target the sync gh functions (prList, prView, prChecks, isAvailable),
// which are unique to this file -- no other test file spies on these.

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import * as gh from "../../core/gh.ts";
import { checkPrStatus } from "../../core/commands/pr-monitor.ts";

// ── Spies ──────────────────────────────────────────────────────────

const isAvailableSpy = vi.spyOn(gh, "isAvailable");
const prListSpy = vi.spyOn(gh, "prList");
const prViewSpy = vi.spyOn(gh, "prView");
const prChecksSpy = vi.spyOn(gh, "prChecks");

beforeEach(() => {
  isAvailableSpy.mockReset();
  prListSpy.mockReset();
  prViewSpy.mockReset();
  prChecksSpy.mockReset();
  // Default: gh is available
  isAvailableSpy.mockReturnValue(true);
});

afterAll(() => {
  isAvailableSpy.mockRestore();
  prListSpy.mockRestore();
  prViewSpy.mockRestore();
  prChecksSpy.mockRestore();
});

// ── Fixtures: realistic gh CLI JSON responses ──────────────────────
// These mirror the JSON shapes returned by `gh pr list`, `gh pr view`,
// and `gh pr checks` after parsing in core/gh.ts.

const MERGED_LINEAGE = "8d641d84-5065-4e72-8b72-c087812ef2cb";

/** gh pr list --json number,title,body --state merged */
const MERGED_PR = { ok: true as const, data: [
  {
    number: 42,
    title: "fix: resolve race condition in worker health (H-RC-1)",
    body: [
      "## Work Item Reference",
      "ID: H-RC-1",
      `Lineage: ${MERGED_LINEAGE}`,
      "Priority: High",
      "Source: Test",
    ].join("\n"),
  },
] };

/** gh pr list --json number,title,body --state open */
const OPEN_PR = { ok: true as const, data: [
  { number: 123, title: "feat: add retry logic for failed CI (H-CI-2)", body: "" },
] };

/** gh pr view --json reviewDecision,mergeable,updatedAt -- pending review */
const VIEW_PENDING = { ok: true as const, data: {
  reviewDecision: "",
  mergeable: "UNKNOWN",
  updatedAt: "2026-03-29T10:30:00Z",
} as Record<string, unknown> };

/** gh pr view -- approved and mergeable */
const VIEW_APPROVED_MERGEABLE = { ok: true as const, data: {
  reviewDecision: "APPROVED",
  mergeable: "MERGEABLE",
  updatedAt: "2026-03-29T11:00:00Z",
} as Record<string, unknown> };

/** gh pr view -- review required, mergeable */
const VIEW_NOT_APPROVED = { ok: true as const, data: {
  reviewDecision: "REVIEW_REQUIRED",
  mergeable: "MERGEABLE",
  updatedAt: "2026-03-29T11:15:00Z",
} as Record<string, unknown> };

/** gh pr view -- approved but has merge conflicts */
const VIEW_APPROVED_CONFLICTING = { ok: true as const, data: {
  reviewDecision: "APPROVED",
  mergeable: "CONFLICTING",
  updatedAt: "2026-03-29T11:20:00Z",
} as Record<string, unknown> };

/** gh pr checks -- two checks still pending */
const CHECKS_PENDING = { ok: true as const, data: [
  { state: "PENDING", name: "CI / test", url: "https://github.com/runs/1" },
  { state: "PENDING", name: "CI / lint", url: "https://github.com/runs/2" },
] };

/** gh pr checks -- one failure, one success */
const CHECKS_FAILING = { ok: true as const, data: [
  { state: "FAILURE", name: "CI / test", url: "https://github.com/runs/1", completedAt: "2026-03-29T10:45:00Z" },
  { state: "SUCCESS", name: "CI / lint", url: "https://github.com/runs/2", completedAt: "2026-03-29T10:44:00Z" },
] };

/** gh pr checks -- all passing */
const CHECKS_PASSING = { ok: true as const, data: [
  { state: "SUCCESS", name: "CI / test", url: "https://github.com/runs/1", completedAt: "2026-03-29T10:50:00Z" },
  { state: "SUCCESS", name: "CI / lint", url: "https://github.com/runs/2", completedAt: "2026-03-29T10:51:00Z" },
] };

/** gh pr checks -- all skipped (no real CI) */
const CHECKS_ALL_SKIPPED = { ok: true as const, data: [
  { state: "SKIPPED", name: "CI / deploy", url: "https://github.com/runs/3" },
] };

/** gh pr checks -- one success, one skipped */
const CHECKS_WITH_SKIPPED = { ok: true as const, data: [
  { state: "SUCCESS", name: "CI / test", url: "https://github.com/runs/1", completedAt: "2026-03-29T10:50:00Z" },
  { state: "SKIPPED", name: "CI / deploy", url: "https://github.com/runs/3" },
] };

// ── Helpers ────────────────────────────────────────────────────────

/** Split tab-separated output into named fields for readable assertions. */
function parseFields(output: string) {
  const f = output.split("\t");
  return {
    id: f[0],
    prNumber: f[1],
    status: f[2],
    mergeable: f[3],
    eventTime: f[4],
    prTitle: f[5],
    lineageToken: f[6],
    fieldCount: f.length,
  };
}

/** Configure spies for an open-PR scenario. */
function setupOpenPr(
  view: { ok: true; data: Record<string, unknown> },
  checks: { ok: true; data: { state: string; name: string; url: string; completedAt?: string }[] },
) {
  prListSpy.mockImplementation(
    (_root: string, _branch: string, state: string) => {
      if (state === "open") return OPEN_PR;
      return { ok: true, data: [] };
    },
  );
  prViewSpy.mockReturnValue(view);
  prChecksSpy.mockReturnValue(checks);
}

// ── Contract tests ─────────────────────────────────────────────────

describe("checkPrStatus format contract", () => {
  // ── no-pr ──────────────────────────────────────────────────────

  describe("no-pr: no open or merged PRs", () => {
    beforeEach(() => {
      prListSpy.mockReturnValue({ ok: true, data: [] });
    });

    it("produces exactly 3 tab-separated fields", () => {
      const parsed = parseFields(checkPrStatus("C-1-1", "/repo"));

      expect(parsed.fieldCount).toBe(3);
      expect(parsed.id).toBe("C-1-1");
      expect(parsed.prNumber).toBe("");
      expect(parsed.status).toBe("no-pr");
    });

    it("exact format: ID\\t\\tno-pr", () => {
      expect(checkPrStatus("H-99", "/repo")).toBe("H-99\t\tno-pr");
    });
  });

  // ── merged ─────────────────────────────────────────────────────

  describe("merged: PR exists in merged state", () => {
    beforeEach(() => {
      prListSpy.mockImplementation(
        (_root: string, _branch: string, state: string) => {
          if (state === "open") return { ok: true, data: [] };
          if (state === "merged") return MERGED_PR;
          return { ok: true, data: [] };
        },
      );
    });

    it("produces exactly 7 tab-separated fields", () => {
      const parsed = parseFields(checkPrStatus("H-RC-1", "/repo"));

      expect(parsed.fieldCount).toBe(7);
      expect(parsed.id).toBe("H-RC-1");
      expect(parsed.prNumber).toBe("42");
      expect(parsed.status).toBe("merged");
      expect(parsed.mergeable).toBe("");
      expect(parsed.eventTime).toBe("");
    });

    it("includes PR title and lineage token for collision recovery", () => {
      const parsed = parseFields(checkPrStatus("H-RC-1", "/repo"));
      expect(parsed.prTitle).toBe(MERGED_PR.data[0]!.title);
      expect(parsed.lineageToken).toBe(MERGED_LINEAGE);
    });

    it("exact format: ID\\tNUMBER\\tmerged\\t\\t\\tTITLE\\tLINEAGE", () => {
      expect(checkPrStatus("H-RC-1", "/repo")).toBe(
        `H-RC-1\t42\tmerged\t\t\tfix: resolve race condition in worker health (H-RC-1)\t${MERGED_LINEAGE}`,
      );
    });
  });

  // ── pending ────────────────────────────────────────────────────

  describe("pending: CI checks still running", () => {
    it("produces 5 tab-separated fields with pending status", () => {
      setupOpenPr(VIEW_PENDING, CHECKS_PENDING);

      const parsed = parseFields(checkPrStatus("H-CI-2", "/repo"));

      expect(parsed.fieldCount).toBe(5);
      expect(parsed.id).toBe("H-CI-2");
      expect(parsed.prNumber).toBe("123");
      expect(parsed.status).toBe("pending");
      expect(parsed.mergeable).toBe("UNKNOWN");
    });

    it("uses prUpdatedAt as eventTime for pending CI", () => {
      setupOpenPr(VIEW_PENDING, CHECKS_PENDING);

      const parsed = parseFields(checkPrStatus("T-1", "/repo"));
      expect(parsed.eventTime).toBe("2026-03-29T10:30:00Z");
    });
  });

  // ── failing ────────────────────────────────────────────────────

  describe("failing: CI check failed", () => {
    it("produces 5 tab-separated fields with failing status", () => {
      setupOpenPr(VIEW_PENDING, CHECKS_FAILING);

      const parsed = parseFields(checkPrStatus("H-CI-3", "/repo"));

      expect(parsed.fieldCount).toBe(5);
      expect(parsed.id).toBe("H-CI-3");
      expect(parsed.prNumber).toBe("123");
      expect(parsed.status).toBe("failing");
      expect(parsed.mergeable).toBe("UNKNOWN");
    });

    it("uses latest CI completedAt as eventTime", () => {
      setupOpenPr(VIEW_PENDING, CHECKS_FAILING);

      const parsed = parseFields(checkPrStatus("T-2", "/repo"));
      // FAILURE at 10:45, SUCCESS at 10:44 -- latest is 10:45
      expect(parsed.eventTime).toBe("2026-03-29T10:45:00Z");
    });

    it("picks latest completedAt across multiple completed checks", () => {
      setupOpenPr(VIEW_PENDING, { ok: true, data: [
        { state: "SUCCESS", name: "lint", url: "", completedAt: "2026-03-29T10:00:00Z" },
        { state: "FAILURE", name: "test", url: "", completedAt: "2026-03-29T10:05:00Z" },
        { state: "ERROR", name: "build", url: "", completedAt: "2026-03-29T10:03:00Z" },
      ] });

      const parsed = parseFields(checkPrStatus("T-2b", "/repo"));
      expect(parsed.eventTime).toBe("2026-03-29T10:05:00Z");
    });

    it("detects every CI_FAILURE_STATES value as failing", () => {
      const failStates = [
        "FAILURE",
        "ERROR",
        "CANCELLED",
        "TIMED_OUT",
        "STARTUP_FAILURE",
        "ACTION_REQUIRED",
      ];

      for (const state of failStates) {
        setupOpenPr(VIEW_PENDING, { ok: true, data: [
          { state, name: "CI", url: "", completedAt: "2026-03-29T10:00:00Z" },
        ] });
        const parsed = parseFields(checkPrStatus(`F-${state}`, "/repo"));
        expect(parsed.status).toBe("failing");
      }
    });
  });

  // ── ci-passed ──────────────────────────────────────────────────

  describe("ci-passed: CI green but not ready to merge", () => {
    it("returns ci-passed when CI passes but review not approved", () => {
      setupOpenPr(VIEW_NOT_APPROVED, CHECKS_PASSING);

      const parsed = parseFields(checkPrStatus("H-CI-4", "/repo"));

      expect(parsed.status).toBe("ci-passed");
      expect(parsed.mergeable).toBe("MERGEABLE");
    });

    it("returns ci-passed when CI passes but has merge conflicts", () => {
      setupOpenPr(VIEW_APPROVED_CONFLICTING, CHECKS_PASSING);

      const parsed = parseFields(checkPrStatus("T-3", "/repo"));

      expect(parsed.status).toBe("ci-passed");
      expect(parsed.mergeable).toBe("CONFLICTING");
    });

    it("uses latest CI completedAt as eventTime", () => {
      setupOpenPr(VIEW_NOT_APPROVED, CHECKS_PASSING);

      const parsed = parseFields(checkPrStatus("T-4", "/repo"));
      // Both completed: 10:50 and 10:51 -- latest is 10:51
      expect(parsed.eventTime).toBe("2026-03-29T10:51:00Z");
    });
  });

  // ── ready ──────────────────────────────────────────────────────

  describe("ready: CI passes + approved + mergeable", () => {
    it("produces 5 tab-separated fields with ready status", () => {
      setupOpenPr(VIEW_APPROVED_MERGEABLE, CHECKS_PASSING);

      const parsed = parseFields(checkPrStatus("H-CI-5", "/repo"));

      expect(parsed.fieldCount).toBe(5);
      expect(parsed.id).toBe("H-CI-5");
      expect(parsed.prNumber).toBe("123");
      expect(parsed.status).toBe("ready");
      expect(parsed.mergeable).toBe("MERGEABLE");
    });

    it("requires both APPROVED review and MERGEABLE status", () => {
      // APPROVED + UNKNOWN --> ci-passed (not ready)
      setupOpenPr(
        { ok: true, data: { reviewDecision: "APPROVED", mergeable: "UNKNOWN", updatedAt: "" } },
        CHECKS_PASSING,
      );
      expect(parseFields(checkPrStatus("T-5a", "/repo")).status).toBe("ci-passed");

      // empty review + MERGEABLE --> ci-passed (not ready)
      setupOpenPr(
        { ok: true, data: { reviewDecision: "", mergeable: "MERGEABLE", updatedAt: "" } },
        CHECKS_PASSING,
      );
      expect(parseFields(checkPrStatus("T-5b", "/repo")).status).toBe("ci-passed");
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────

  describe("edge cases", () => {
    it("returns empty string when gh CLI is not available", () => {
      isAvailableSpy.mockReturnValue(false);
      expect(checkPrStatus("T-6", "/repo")).toBe("");
    });

    it("empty checks array with no createdAt produces ci-passed (no CI configured)", () => {
      // No createdAt → no grace period → treat as no CI configured → ci-passed
      setupOpenPr(VIEW_PENDING, { ok: true, data: [] });

      const parsed = parseFields(checkPrStatus("T-7", "/repo"));
      expect(parsed.status).toBe("ci-passed");
    });

    it("empty checks array with recent createdAt produces pending (CI not yet registered)", () => {
      // PR just opened within grace period → CI may not have registered yet
      const recentView = { ok: true as const, data: {
        ...VIEW_PENDING.data,
        createdAt: new Date(Date.now() - 30_000).toISOString(),
      } };
      setupOpenPr(recentView, { ok: true, data: [] });

      const parsed = parseFields(checkPrStatus("T-7b", "/repo"));
      expect(parsed.status).toBe("pending");
    });

    it("all-SKIPPED checks with no createdAt produce ci-passed (no CI configured)", () => {
      // SKIPPED checks are filtered out -- 0 non-skipped + no createdAt → ci-passed
      setupOpenPr(VIEW_PENDING, CHECKS_ALL_SKIPPED);

      const parsed = parseFields(checkPrStatus("T-8", "/repo"));
      expect(parsed.status).toBe("ci-passed");
    });

    it("all-SKIPPED checks with recent createdAt produce pending (CI not yet registered)", () => {
      const recentView = { ok: true as const, data: {
        ...VIEW_PENDING.data,
        createdAt: new Date(Date.now() - 30_000).toISOString(),
      } };
      setupOpenPr(recentView, CHECKS_ALL_SKIPPED);

      const parsed = parseFields(checkPrStatus("T-8b", "/repo"));
      expect(parsed.status).toBe("pending");
    });

    it("SKIPPED checks are excluded from CI evaluation", () => {
      setupOpenPr(VIEW_APPROVED_MERGEABLE, CHECKS_WITH_SKIPPED);

      const parsed = parseFields(checkPrStatus("T-9", "/repo"));
      // Only non-skipped check is SUCCESS --> CI pass --> ready
      expect(parsed.status).toBe("ready");
    });

    it("defaults mergeable to UNKNOWN when field is empty string", () => {
      setupOpenPr(
        { ok: true, data: { reviewDecision: "", mergeable: "", updatedAt: "" } },
        CHECKS_PENDING,
      );

      const parsed = parseFields(checkPrStatus("T-10", "/repo"));
      expect(parsed.mergeable).toBe("UNKNOWN");
    });

    it("first field is always the ID argument passed in", () => {
      prListSpy.mockReturnValue({ ok: true, data: [] });
      expect(parseFields(checkPrStatus("ANY-ID-99", "/repo")).id).toBe("ANY-ID-99");
    });
  });

  // ── API error hold-state (H-ER-6) ──────────────────────────────

  describe("API error: hold state instead of misinterpreting", () => {
    it("returns empty string when prList('open') fails (API error)", () => {
      prListSpy.mockReturnValue({ ok: false, error: "API timeout", kind: "network" });

      const result = checkPrStatus("T-ERR-1", "/repo");
      expect(result).toBe("");
    });

    it("returns empty string when prList('merged') fails after no open PRs", () => {
      prListSpy.mockImplementation(
        (_root: string, _branch: string, state: string) => {
          if (state === "open") return { ok: true, data: [] };
          return { ok: false, error: "rate limited", kind: "network" };
        },
      );

      const result = checkPrStatus("T-ERR-2", "/repo");
      expect(result).toBe("");
    });

    it("preserves open PR state when prView fails for an open PR", () => {
      prListSpy.mockImplementation(
        (_root: string, _branch: string, state: string) => {
          if (state === "open") return OPEN_PR;
          return { ok: true, data: [] };
        },
      );
      prViewSpy.mockReturnValue({ ok: false, error: "server error", kind: "unknown" });

      const parsed = parseFields(checkPrStatus("T-ERR-3", "/repo"));
      expect(parsed.fieldCount).toBe(5);
      expect(parsed.prNumber).toBe("123");
      expect(parsed.status).toBe("open");
      expect(parsed.mergeable).toBe("");
      expect(parsed.eventTime).toBe("");
    });

    it("preserves open PR state when prChecks fails for an open PR", () => {
      prListSpy.mockImplementation(
        (_root: string, _branch: string, state: string) => {
          if (state === "open") return OPEN_PR;
          return { ok: true, data: [] };
        },
      );
      prViewSpy.mockReturnValue(VIEW_PENDING);
      prChecksSpy.mockReturnValue({ ok: false, error: "network error", kind: "network" });

      const parsed = parseFields(checkPrStatus("T-ERR-4", "/repo"));
      expect(parsed.fieldCount).toBe(5);
      expect(parsed.prNumber).toBe("123");
      expect(parsed.status).toBe("open");
      expect(parsed.mergeable).toBe("UNKNOWN");
      expect(parsed.eventTime).toBe("2026-03-29T10:30:00Z");
    });
  });
});
