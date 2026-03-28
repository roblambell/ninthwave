// Tests for operator identity resolution (resolveOperatorId) in core/crew.ts.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  resolveOperatorId,
  operatorIdPath,
  type OperatorIdDeps,
} from "../core/crew.ts";
import { userStateDir } from "../core/daemon.ts";

// ── Helpers ──────────────────────────────────────────────────────────

function makeTempProject(): string {
  return mkdtempSync(join(tmpdir(), "operator-id-test-"));
}

function makeDeps(gitEmail: string | null): OperatorIdDeps {
  return {
    exec: () => {
      if (gitEmail === null) throw new Error("git config user.email not set");
      return gitEmail;
    },
    existsSync,
    readFileSync,
    writeFileSync,
    mkdirSync,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("resolveOperatorId", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempProject();
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
      // Clean up user state dir
      const stateDir = userStateDir(tempDir);
      rmSync(stateDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  });

  it("resolves git config user.email on first call", () => {
    const id = resolveOperatorId(tempDir, makeDeps("dev@example.com"));
    expect(id).toBe("dev@example.com");
  });

  it("persists the resolved email to operator-id file", () => {
    resolveOperatorId(tempDir, makeDeps("dev@example.com"));
    const filePath = operatorIdPath(tempDir);
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, "utf-8").trim()).toBe("dev@example.com");
  });

  it("reads from persisted file on subsequent calls (survives restart)", () => {
    // First call resolves and persists
    resolveOperatorId(tempDir, makeDeps("first@example.com"));

    // Second call with different git config should still return persisted value
    const id = resolveOperatorId(tempDir, makeDeps("second@example.com"));
    expect(id).toBe("first@example.com");
  });

  it("falls back to empty string when git config user.email is not set", () => {
    const id = resolveOperatorId(tempDir, makeDeps(null));
    expect(id).toBe("");
  });

  it("persists empty string fallback (does not re-resolve on restart)", () => {
    // First call: git config fails, persists empty string
    resolveOperatorId(tempDir, makeDeps(null));
    const filePath = operatorIdPath(tempDir);
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, "utf-8")).toBe("");
  });

  it("reuses a pre-existing operator-id file", () => {
    const filePath = operatorIdPath(tempDir);
    const dir = join(filePath, "..");
    mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, "pre-existing@example.com", "utf-8");

    const id = resolveOperatorId(tempDir, makeDeps("different@example.com"));
    expect(id).toBe("pre-existing@example.com");
  });
});

describe("operatorIdPath", () => {
  it("returns a path under the user state directory", () => {
    const path = operatorIdPath("/some/project");
    expect(path).toContain("operator-id");
    expect(path).toContain(".ninthwave");
  });
});
