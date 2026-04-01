// Tests for async gh functions: prListAsync, prViewAsync, prChecksAsync.
// Uses vi.spyOn on runAsync to avoid real network calls.

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import * as shell from "../core/shell.ts";
import { prListAsync, prViewAsync, prChecksAsync } from "../core/gh.ts";

const runAsyncSpy = vi.spyOn(shell, "runAsync");

beforeEach(() => runAsyncSpy.mockReset());
afterAll(() => runAsyncSpy.mockRestore());

// Helper to create a resolved RunResult promise
function ok(stdout: string) {
  return Promise.resolve({ stdout, stderr: "", exitCode: 0 });
}
function fail(stderr = "error") {
  return Promise.resolve({ stdout: "", stderr, exitCode: 1 });
}

describe("prListAsync", () => {
  it("parses JSON response with PR list", async () => {
    runAsyncSpy.mockReturnValue(ok(JSON.stringify([{ number: 42, title: "Fix bug", body: "" }])));

    const result = await prListAsync("/repo", "ninthwave/T-1-1", "open");

    expect(result).toEqual({ ok: true, data: [{ number: 42, title: "Fix bug", body: "" }] });
    expect(runAsyncSpy).toHaveBeenCalledWith(
      "gh",
      ["pr", "list", "--head", "ninthwave/T-1-1", "--state", "open", "--json", "number,title,body", "--limit", "100"],
      { cwd: "/repo" },
    );
  });

  it("returns ok:false on gh failure", async () => {
    runAsyncSpy.mockReturnValue(fail("api error"));
    const result = await prListAsync("/repo", "ninthwave/T-1-1", "open");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("api error");
      expect(result.kind).toBe("unknown");
    }
  });

  it("returns ok:false on invalid JSON", async () => {
    runAsyncSpy.mockReturnValue(ok("not json"));
    const result = await prListAsync("/repo", "ninthwave/T-1-1", "open");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("parse");
  });

  it("returns ok:true with empty array on empty stdout", async () => {
    runAsyncSpy.mockReturnValue(ok(""));
    const result = await prListAsync("/repo", "ninthwave/T-1-1", "open");
    expect(result).toEqual({ ok: true, data: [] });
  });
});

describe("prViewAsync", () => {
  it("parses JSON response with PR fields", async () => {
    const data = { reviewDecision: "APPROVED", mergeable: "MERGEABLE" };
    runAsyncSpy.mockReturnValue(ok(JSON.stringify(data)));

    const result = await prViewAsync("/repo", 42, ["reviewDecision", "mergeable"]);

    expect(result).toEqual({ ok: true, data });
    expect(runAsyncSpy).toHaveBeenCalledWith(
      "gh",
      ["pr", "view", "42", "--json", "reviewDecision,mergeable"],
      { cwd: "/repo" },
    );
  });

  it("returns ok:false on gh failure", async () => {
    runAsyncSpy.mockReturnValue(fail("repository not found"));
    const result = await prViewAsync("/repo", 42, ["state"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not found");
      expect(result.kind).toBe("repo-access");
    }
  });

  it("returns ok:false on invalid JSON", async () => {
    runAsyncSpy.mockReturnValue(ok("bad json"));
    const result = await prViewAsync("/repo", 42, ["state"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("parse");
  });
});

describe("prChecksAsync", () => {
  it("parses check results and maps link to url", async () => {
    const raw = [
      { state: "SUCCESS", name: "test", link: "https://ci/1", completedAt: "2026-01-01T00:00:00Z" },
      { state: "PENDING", name: "lint", link: "https://ci/2" },
    ];
    runAsyncSpy.mockReturnValue(ok(JSON.stringify(raw)));

    const result = await prChecksAsync("/repo", 42);

    expect(result).toEqual({ ok: true, data: [
      { state: "SUCCESS", name: "test", url: "https://ci/1", completedAt: "2026-01-01T00:00:00Z" },
      { state: "PENDING", name: "lint", url: "https://ci/2", completedAt: undefined },
    ] });
  });

  it("returns ok:false on gh failure", async () => {
    runAsyncSpy.mockReturnValue(fail("network timeout"));
    const result = await prChecksAsync("/repo", 42);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("timeout");
      expect(result.kind).toBe("network");
    }
  });

  it("returns ok:false on invalid JSON", async () => {
    runAsyncSpy.mockReturnValue(ok("invalid"));
    const result = await prChecksAsync("/repo", 42);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe("parse");
  });

  it("returns ok:true with empty array on empty stdout", async () => {
    runAsyncSpy.mockReturnValue(ok(""));
    const result = await prChecksAsync("/repo", 42);
    expect(result).toEqual({ ok: true, data: [] });
  });
});
