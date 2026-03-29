// Tests for ci-failures command.

import { describe, it, expect, vi, afterEach } from "vitest";
import { setupTempRepo, cleanupTempRepos, captureOutput } from "./helpers.ts";
import { type CiDeps, cmdCiFailures } from "../core/commands/ci.ts";

/** Create mock CiDeps for dependency injection. */
function createMockCiDeps(): CiDeps & Record<string, ReturnType<typeof vi.fn>> {
  return {
    prChecks: vi.fn(() => ({ ok: true as const, data: [] as Array<{ state: string; name: string; url: string; completedAt?: string }> })),
  };
}

describe("cmdCiFailures", () => {
  afterEach(() => cleanupTempRepos());

  it("dies without PR number argument", () => {
    const deps = createMockCiDeps();
    const repo = setupTempRepo();

    const output = captureOutput(() =>
      cmdCiFailures([], repo, deps),
    );

    expect(output).toContain("Usage");
  });

  it("reports no failing checks when all pass", () => {
    const deps = createMockCiDeps();
    const repo = setupTempRepo();

    deps.prChecks.mockReturnValue({ ok: true, data: [
      { state: "SUCCESS", name: "build", url: "https://example.com/1" },
      { state: "SUCCESS", name: "lint", url: "https://example.com/2" },
    ] });

    const output = captureOutput(() =>
      cmdCiFailures(["42"], repo, deps),
    );

    expect(output).toContain("No failing checks");
  });

  it("lists failing checks with name and URL", () => {
    const deps = createMockCiDeps();
    const repo = setupTempRepo();

    deps.prChecks.mockReturnValue({ ok: true, data: [
      { state: "FAILURE", name: "test-suite", url: "https://ci.example.com/run/1" },
      { state: "SUCCESS", name: "lint", url: "https://ci.example.com/run/2" },
      { state: "FAILURE", name: "type-check", url: "https://ci.example.com/run/3" },
    ] });

    const output = captureOutput(() =>
      cmdCiFailures(["99"], repo, deps),
    );

    expect(output).toContain("test-suite");
    expect(output).toContain("https://ci.example.com/run/1");
    expect(output).toContain("type-check");
    expect(output).toContain("https://ci.example.com/run/3");
    // Should not contain passing checks
    expect(output).not.toContain("lint");
  });

  it("handles empty checks list", () => {
    const deps = createMockCiDeps();
    const repo = setupTempRepo();

    deps.prChecks.mockReturnValue({ ok: true, data: [] });

    const output = captureOutput(() =>
      cmdCiFailures(["10"], repo, deps),
    );

    expect(output).toContain("No failing checks");
  });
});
