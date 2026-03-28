// Tests for core/git-author.ts — git author resolution utility and cache.

import { describe, it, expect } from "vitest";
import { resolveGitAuthor, AuthorCache, type GitAuthorDeps } from "../core/git-author.ts";

// ── Helpers ──────────────────────────────────────────────────────────

function mockDeps(output: string): GitAuthorDeps {
  return {
    exec: () => output,
  };
}

function failingDeps(): GitAuthorDeps {
  return {
    exec: () => { throw new Error("git not found"); },
  };
}

function trackingDeps(output: string): { deps: GitAuthorDeps; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      exec: (cmd: string) => {
        calls.push(cmd);
        return output;
      },
    },
  };
}

// ── resolveGitAuthor ─────────────────────────────────────────────────

describe("resolveGitAuthor", () => {
  it("extracts email from git log output", () => {
    const email = resolveGitAuthor(
      ".ninthwave/work/1-test--H-1.md",
      "/project",
      mockDeps("user@example.com"),
    );
    expect(email).toBe("user@example.com");
  });

  it("returns empty string when git log returns empty output", () => {
    const email = resolveGitAuthor(
      ".ninthwave/work/untracked.md",
      "/project",
      mockDeps(""),
    );
    expect(email).toBe("");
  });

  it("returns empty string when git command fails", () => {
    const email = resolveGitAuthor(
      ".ninthwave/work/bad.md",
      "/project",
      failingDeps(),
    );
    expect(email).toBe("");
  });

  it("passes the correct file path to git log command", () => {
    const { deps, calls } = trackingDeps("dev@test.com");
    resolveGitAuthor(".ninthwave/work/1-core--H-2.md", "/project", deps);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(".ninthwave/work/1-core--H-2.md");
  });
});

// ── AuthorCache ──────────────────────────────────────────────────────

describe("AuthorCache", () => {
  it("caches results to avoid repeated git calls", () => {
    const { deps, calls } = trackingDeps("cached@example.com");
    const cache = new AuthorCache(deps);

    const first = cache.resolve("file.md", "/project");
    const second = cache.resolve("file.md", "/project");

    expect(first).toBe("cached@example.com");
    expect(second).toBe("cached@example.com");
    expect(calls).toHaveLength(1); // only one git call
  });

  it("resolves different files independently", () => {
    let callCount = 0;
    const deps: GitAuthorDeps = {
      exec: (cmd: string) => {
        callCount++;
        return cmd.includes("a.md") ? "alice@test.com" : "bob@test.com";
      },
    };
    const cache = new AuthorCache(deps);

    expect(cache.resolve("a.md", "/project")).toBe("alice@test.com");
    expect(cache.resolve("b.md", "/project")).toBe("bob@test.com");
    expect(callCount).toBe(2);
  });

  it("clear() resets the cache so the next call re-resolves", () => {
    const { deps, calls } = trackingDeps("dev@test.com");
    const cache = new AuthorCache(deps);

    cache.resolve("file.md", "/project");
    expect(calls).toHaveLength(1);

    cache.clear();
    cache.resolve("file.md", "/project");
    expect(calls).toHaveLength(2); // re-resolved after clear
  });

  it("size property reflects the number of cached entries", () => {
    const { deps } = trackingDeps("dev@test.com");
    const cache = new AuthorCache(deps);

    expect(cache.size).toBe(0);
    cache.resolve("a.md", "/project");
    expect(cache.size).toBe(1);
    cache.resolve("b.md", "/project");
    expect(cache.size).toBe(2);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("caches empty string results (does not re-resolve failures)", () => {
    const { deps, calls } = trackingDeps("");
    const cache = new AuthorCache(deps);

    const first = cache.resolve("untracked.md", "/project");
    const second = cache.resolve("untracked.md", "/project");

    expect(first).toBe("");
    expect(second).toBe("");
    expect(calls).toHaveLength(1); // cached even for empty result
  });
});
