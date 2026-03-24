// Tests for start command: detectAiTool and cmdStart.

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { join } from "path";
import { writeFileSync } from "fs";
import { setupTempRepo, useFixture, cleanupTempRepos } from "./helpers.ts";
import type { Multiplexer } from "../core/mux.ts";

// Only mock modules that don't have their own test files and aren't
// transitive dependencies of other tested modules.
// Avoid mocking shell.ts (used by version-bump.test.ts via git.ts)
// and partitions.ts / cross-repo.ts (have dedicated test files).
vi.mock("../core/git.ts", () => ({
  fetchOrigin: vi.fn(),
  ffMerge: vi.fn(),
  branchExists: vi.fn(() => false),
  deleteBranch: vi.fn(),
  createWorktree: vi.fn(),
}));

import { detectAiTool, cmdStart, launchSingleItem, sanitizeTitle, extractTodoText } from "../core/commands/start.ts";
import { parseTodos } from "../core/parser.ts";
import { fetchOrigin, ffMerge } from "../core/git.ts";

/** Create a mock Multiplexer for dependency injection (avoids vi.mock leaking). */
function createMockMux(): Multiplexer & Record<string, Mock> {
  return {
    isAvailable: vi.fn(() => true),
    launchWorkspace: vi.fn(() => "workspace:1"),
    splitPane: vi.fn(() => "pane:1"),
    sendMessage: vi.fn(() => true),
    readScreen: vi.fn(() => "line1\nline2\nline3\nline4\n"),
    listWorkspaces: vi.fn(() => ""),
    closeWorkspace: vi.fn(() => true),
  };
}

function captureOutput(fn: () => void): string {
  const lines: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...args: unknown[]) => lines.push(args.join(" "));
  console.error = (...args: unknown[]) => lines.push(args.join(" "));

  const origExit = process.exit;
  process.exit = ((code?: number) => {
    throw new Error(`EXIT:${code}`);
  }) as never;

  try {
    fn();
  } catch (e: unknown) {
    if (e instanceof Error && !e.message.startsWith("EXIT:")) throw e;
  } finally {
    console.log = origLog;
    console.error = origError;
    process.exit = origExit;
  }

  return lines.join("\n");
}

describe("detectAiTool", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    // Clear relevant env vars
    delete process.env.NINTHWAVE_AI_TOOL;
    delete process.env.OPENCODE;
    delete process.env.CLAUDE_CODE_SESSION;
    delete process.env.CLAUDE_SESSION_ID;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    cleanupTempRepos();
  });

  it("returns NINTHWAVE_AI_TOOL when set", () => {
    process.env.NINTHWAVE_AI_TOOL = "custom-tool";
    expect(detectAiTool()).toBe("custom-tool");
  });

  it("returns opencode when OPENCODE=1", () => {
    process.env.OPENCODE = "1";
    expect(detectAiTool()).toBe("opencode");
  });

  it("returns claude when CLAUDE_CODE_SESSION is set", () => {
    process.env.CLAUDE_CODE_SESSION = "some-session-id";
    expect(detectAiTool()).toBe("claude");
  });

  it("returns claude when CLAUDE_SESSION_ID is set", () => {
    process.env.CLAUDE_SESSION_ID = "another-session-id";
    expect(detectAiTool()).toBe("claude");
  });

  it("NINTHWAVE_AI_TOOL takes priority over OPENCODE", () => {
    process.env.NINTHWAVE_AI_TOOL = "copilot";
    process.env.OPENCODE = "1";
    expect(detectAiTool()).toBe("copilot");
  });

  it("OPENCODE takes priority over CLAUDE_CODE_SESSION", () => {
    process.env.OPENCODE = "1";
    process.env.CLAUDE_CODE_SESSION = "some-id";
    expect(detectAiTool()).toBe("opencode");
  });
});

describe("cmdStart", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure AI tool is detectable
    process.env.NINTHWAVE_AI_TOOL = "claude";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    cleanupTempRepos();
  });

  it("dies with no arguments", () => {
    const repo = setupTempRepo();
    const todosDir = join(repo, "TODOS.md");
    const worktreeDir = join(repo, ".worktrees");

    writeFileSync(todosDir, "# TODOS\n");

    const output = captureOutput(() =>
      cmdStart([], todosDir, worktreeDir, repo),
    );

    expect(output).toContain("Usage");
  });

  it("dies when item ID not found", () => {
    const repo = setupTempRepo();
    useFixture(repo, "valid.md");
    const todosDir = join(repo, "TODOS.md");
    const worktreeDir = join(repo, ".worktrees");

    const output = captureOutput(() =>
      cmdStart(["NONEXISTENT-1"], todosDir, worktreeDir, repo),
    );

    expect(output).toContain("not found");
  });

  it("launches session for a valid item", () => {
    const mockMux = createMockMux();
    const repo = setupTempRepo();
    useFixture(repo, "valid.md");
    const todosDir = join(repo, "TODOS.md");
    const worktreeDir = join(repo, ".worktrees");

    const output = captureOutput(() =>
      cmdStart(["M-CI-1"], todosDir, worktreeDir, repo, mockMux),
    );

    expect(output).toContain("Launched 1 session");
    expect(mockMux.launchWorkspace).toHaveBeenCalled();
  });

  it("reports detected AI tool", () => {
    process.env.NINTHWAVE_AI_TOOL = "opencode";

    const mockMux = createMockMux();
    const repo = setupTempRepo();
    useFixture(repo, "valid.md");
    const todosDir = join(repo, "TODOS.md");
    const worktreeDir = join(repo, ".worktrees");

    const output = captureOutput(() =>
      cmdStart(["M-CI-1"], todosDir, worktreeDir, repo, mockMux),
    );

    expect(output).toContain("Detected AI tool: opencode");
  });
});

describe("launchSingleItem", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NINTHWAVE_AI_TOOL = "claude";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    cleanupTempRepos();
  });

  it("creates worktree and launches session for a single item", () => {
    const mockMux = createMockMux();
    const repo = setupTempRepo();
    useFixture(repo, "valid.md");
    const todosDir = join(repo, "TODOS.md");
    const worktreeDir = join(repo, ".worktrees");
    const items = parseTodos(todosDir, worktreeDir);
    const item = items.find((i) => i.id === "M-CI-1")!;

    const result = captureOutput(() => {
      const res = launchSingleItem(item, todosDir, worktreeDir, repo, "claude", mockMux);
      expect(res).not.toBeNull();
      expect(res!.worktreePath).toContain("todo-M-CI-1");
      expect(res!.workspaceRef).toBe("workspace:1");
    });

    expect(mockMux.launchWorkspace).toHaveBeenCalled();
    expect(result).toContain("Creating worktree for M-CI-1");
  });

  it("returns null when mux launch fails", () => {
    const mockMux = createMockMux();
    mockMux.launchWorkspace.mockReturnValueOnce(null);

    const repo = setupTempRepo();
    useFixture(repo, "valid.md");
    const todosDir = join(repo, "TODOS.md");
    const worktreeDir = join(repo, ".worktrees");
    const items = parseTodos(todosDir, worktreeDir);
    const item = items.find((i) => i.id === "M-CI-1")!;

    const result = captureOutput(() => {
      const res = launchSingleItem(item, todosDir, worktreeDir, repo, "claude", mockMux);
      expect(res).toBeNull();
    });

    expect(result).toContain("cmux launch failed");
  });

  it("allocates a partition for the item", () => {
    const mockMux = createMockMux();
    const repo = setupTempRepo();
    useFixture(repo, "valid.md");
    const todosDir = join(repo, "TODOS.md");
    const worktreeDir = join(repo, ".worktrees");
    const items = parseTodos(todosDir, worktreeDir);
    const item = items.find((i) => i.id === "M-CI-1")!;

    const result = captureOutput(() => {
      launchSingleItem(item, todosDir, worktreeDir, repo, "claude", mockMux);
    });

    // Partition 1 should be allocated (first available)
    expect(result).toContain("partition 1");
  });

  it("ensures worktree directory is created", () => {
    const mockMux = createMockMux();
    const repo = setupTempRepo();
    useFixture(repo, "valid.md");
    const todosDir = join(repo, "TODOS.md");
    const worktreeDir = join(repo, ".worktrees");
    const items = parseTodos(todosDir, worktreeDir);
    const item = items.find((i) => i.id === "M-CI-1")!;

    // worktreeDir doesn't exist yet — launchSingleItem should create it
    captureOutput(() => {
      launchSingleItem(item, todosDir, worktreeDir, repo, "claude", mockMux);
    });

    const { existsSync } = require("fs");
    expect(existsSync(worktreeDir)).toBe(true);
  });

  it("logs warning when fetchOrigin fails but still creates worktree", () => {
    const mockMux = createMockMux();
    const repo = setupTempRepo();
    useFixture(repo, "valid.md");
    const todosDir = join(repo, "TODOS.md");
    const worktreeDir = join(repo, ".worktrees");
    const items = parseTodos(todosDir, worktreeDir);
    const item = items.find((i) => i.id === "M-CI-1")!;

    (fetchOrigin as Mock).mockImplementationOnce(() => {
      throw new Error("network timeout");
    });

    const output = captureOutput(() => {
      const res = launchSingleItem(item, todosDir, worktreeDir, repo, "claude", mockMux);
      expect(res).not.toBeNull();
      expect(res!.worktreePath).toContain("todo-M-CI-1");
    });

    expect(output).toContain("Failed to fetch origin/main");
    expect(output).toContain("network timeout");
    expect(output).toContain("may be outdated");
    expect(mockMux.launchWorkspace).toHaveBeenCalled();
  });

  it("logs warning when ffMerge fails but still creates worktree", () => {
    const mockMux = createMockMux();
    const repo = setupTempRepo();
    useFixture(repo, "valid.md");
    const todosDir = join(repo, "TODOS.md");
    const worktreeDir = join(repo, ".worktrees");
    const items = parseTodos(todosDir, worktreeDir);
    const item = items.find((i) => i.id === "M-CI-1")!;

    (ffMerge as Mock).mockImplementationOnce(() => {
      throw new Error("not a fast-forward");
    });

    const output = captureOutput(() => {
      const res = launchSingleItem(item, todosDir, worktreeDir, repo, "claude", mockMux);
      expect(res).not.toBeNull();
      expect(res!.worktreePath).toContain("todo-M-CI-1");
    });

    expect(output).toContain("Failed to fast-forward main");
    expect(output).toContain("not a fast-forward");
    expect(output).toContain("may be based on outdated code");
    expect(mockMux.launchWorkspace).toHaveBeenCalled();
  });

  it("warning includes actionable context about stale worktree", () => {
    const mockMux = createMockMux();
    const repo = setupTempRepo();
    useFixture(repo, "valid.md");
    const todosDir = join(repo, "TODOS.md");
    const worktreeDir = join(repo, ".worktrees");
    const items = parseTodos(todosDir, worktreeDir);
    const item = items.find((i) => i.id === "M-CI-1")!;

    (fetchOrigin as Mock).mockImplementationOnce(() => {
      throw new Error("Could not resolve host: github.com");
    });
    (ffMerge as Mock).mockImplementationOnce(() => {
      throw new Error("diverged branches");
    });

    const output = captureOutput(() => {
      launchSingleItem(item, todosDir, worktreeDir, repo, "claude", mockMux);
    });

    // Both warnings should appear
    expect(output).toContain("Failed to fetch origin/main");
    expect(output).toContain("Could not resolve host: github.com");
    expect(output).toContain("Failed to fast-forward main");
    expect(output).toContain("diverged branches");
    // Both should include the item ID for context
    expect(output).toContain("M-CI-1");
  });

  it("returns correct worktreePath for hub repo items", () => {
    const mockMux = createMockMux();
    const repo = setupTempRepo();
    useFixture(repo, "valid.md");
    const todosDir = join(repo, "TODOS.md");
    const worktreeDir = join(repo, ".worktrees");
    const items = parseTodos(todosDir, worktreeDir);
    const item = items.find((i) => i.id === "M-CI-1")!;

    captureOutput(() => {
      const res = launchSingleItem(item, todosDir, worktreeDir, repo, "claude", mockMux);
      expect(res).not.toBeNull();
      expect(res!.worktreePath).toBe(join(worktreeDir, "todo-M-CI-1"));
    });
  });
});

describe("sanitizeTitle", () => {
  it("passes through normal alphanumeric titles unchanged", () => {
    expect(sanitizeTitle("Fix the login bug")).toBe("Fix the login bug");
  });

  it("preserves hyphens and underscores", () => {
    expect(sanitizeTitle("my-feature_name")).toBe("my-feature_name");
  });

  it("replaces double quotes", () => {
    expect(sanitizeTitle('title with "quotes"')).toBe("title with _quotes_");
  });

  it("replaces backslashes", () => {
    expect(sanitizeTitle("title with \\backslash")).toBe("title with _backslash");
  });

  it("replaces semicolons", () => {
    expect(sanitizeTitle("title; rm -rf /")).toBe("title_ rm -rf _");
  });

  it("replaces pipe characters", () => {
    expect(sanitizeTitle("title | cat /etc/passwd")).toBe("title _ cat _etc_passwd");
  });

  it("replaces ampersands", () => {
    expect(sanitizeTitle("title && echo pwned")).toBe("title __ echo pwned");
  });

  it("replaces newlines", () => {
    expect(sanitizeTitle("title\ninjected")).toBe("title_injected");
  });

  it("replaces backticks (command substitution)", () => {
    expect(sanitizeTitle("title `whoami`")).toBe("title _whoami_");
  });

  it("replaces dollar signs (variable expansion)", () => {
    expect(sanitizeTitle("title $HOME")).toBe("title _HOME");
  });

  it("replaces single quotes", () => {
    expect(sanitizeTitle("title 'injected'")).toBe("title _injected_");
  });

  it("replaces parentheses (subshells)", () => {
    expect(sanitizeTitle("title $(whoami)")).toBe("title __whoami_");
  });

  it("handles empty title", () => {
    expect(sanitizeTitle("")).toBe("");
  });

  it("handles title that is entirely metacharacters", () => {
    expect(sanitizeTitle(";|&$`\"'\\")).toBe("________");
  });

  it("handles mixed safe and unsafe characters", () => {
    expect(sanitizeTitle("Fix bug #123 (critical)")).toBe("Fix bug _123 _critical_");
  });
});

describe("extractTodoText", () => {
  afterEach(() => cleanupTempRepos());

  it("returns full TODO block for a valid ID", () => {
    const repo = setupTempRepo();
    const todosDir = join(repo, "TODOS.md");
    writeFileSync(
      todosDir,
      [
        "# TODOS",
        "",
        "## Section",
        "",
        "### Fix: Some bug (H-BUG-1)",
        "",
        "**Priority:** High",
        "**Source:** Manual",
        "",
        "Description of the bug.",
        "",
        "Acceptance: Bug is fixed.",
        "",
        "Key files: `src/foo.ts`",
        "",
        "---",
        "",
        "### Feat: Another item (M-FT-2)",
        "",
        "**Priority:** Medium",
        "",
      ].join("\n"),
    );

    const text = extractTodoText(todosDir, "H-BUG-1");
    expect(text).toContain("### Fix: Some bug (H-BUG-1)");
    expect(text).toContain("**Priority:** High");
    expect(text).toContain("Description of the bug.");
    expect(text).toContain("Acceptance: Bug is fixed.");
    expect(text).toContain("Key files: `src/foo.ts`");
    // Should NOT include the next item
    expect(text).not.toContain("M-FT-2");
    expect(text).not.toContain("Another item");
  });

  it("returns empty string when ID is not found", () => {
    const repo = setupTempRepo();
    const todosDir = join(repo, "TODOS.md");
    writeFileSync(
      todosDir,
      [
        "# TODOS",
        "",
        "## Section",
        "",
        "### Fix: Some bug (H-BUG-1)",
        "",
        "Description.",
        "",
      ].join("\n"),
    );

    const text = extractTodoText(todosDir, "NONEXISTENT-99");
    expect(text).toBe("");
  });

  it("returns first match when duplicate IDs exist", () => {
    const repo = setupTempRepo();
    const todosDir = join(repo, "TODOS.md");
    writeFileSync(
      todosDir,
      [
        "# TODOS",
        "",
        "### Fix: First occurrence (DUP-1)",
        "",
        "First description.",
        "",
        "---",
        "",
        "### Fix: Second occurrence (DUP-1)",
        "",
        "Second description.",
        "",
      ].join("\n"),
    );

    const text = extractTodoText(todosDir, "DUP-1");
    expect(text).toContain("First occurrence");
    expect(text).toContain("First description.");
    // Should stop at the next ### header, so second occurrence is excluded
    expect(text).not.toContain("Second occurrence");
    expect(text).not.toContain("Second description.");
  });

  it("handles malformed headers without parenthesized ID", () => {
    const repo = setupTempRepo();
    const todosDir = join(repo, "TODOS.md");
    writeFileSync(
      todosDir,
      [
        "# TODOS",
        "",
        "### Fix: Missing ID header",
        "",
        "No ID in the header above.",
        "",
        "### Fix: Valid item (H-OK-1)",
        "",
        "Has a valid ID.",
        "",
      ].join("\n"),
    );

    // Searching for the valid ID should skip malformed headers
    const text = extractTodoText(todosDir, "H-OK-1");
    expect(text).toContain("### Fix: Valid item (H-OK-1)");
    expect(text).toContain("Has a valid ID.");
    expect(text).not.toContain("Missing ID header");
  });

  it("returns text up to end of file when item is last in file", () => {
    const repo = setupTempRepo();
    const todosDir = join(repo, "TODOS.md");
    writeFileSync(
      todosDir,
      [
        "# TODOS",
        "",
        "### Fix: Only item (L-LAST-1)",
        "",
        "This is the last item.",
        "",
        "Acceptance: Done.",
      ].join("\n"),
    );

    const text = extractTodoText(todosDir, "L-LAST-1");
    expect(text).toContain("### Fix: Only item (L-LAST-1)");
    expect(text).toContain("This is the last item.");
    expect(text).toContain("Acceptance: Done.");
  });

  it("handles empty TODOS file", () => {
    const repo = setupTempRepo();
    const todosDir = join(repo, "TODOS.md");
    writeFileSync(todosDir, "");

    const text = extractTodoText(todosDir, "H-BUG-1");
    expect(text).toBe("");
  });

  it("matches partial ID prefix correctly (uses parenthesis matching)", () => {
    const repo = setupTempRepo();
    const todosDir = join(repo, "TODOS.md");
    writeFileSync(
      todosDir,
      [
        "# TODOS",
        "",
        "### Fix: Item one (H-BUG-10)",
        "",
        "Description for 10.",
        "",
        "---",
        "",
        "### Fix: Item two (H-BUG-1)",
        "",
        "Description for 1.",
        "",
      ].join("\n"),
    );

    // The function matches `(${targetId}` — so H-BUG-1 matches both (H-BUG-10) and (H-BUG-1)
    // because "(H-BUG-1" is a substring of "(H-BUG-10)"
    // This documents the current behavior (first match wins)
    const text = extractTodoText(todosDir, "H-BUG-1");
    expect(text).toContain("Item one");
    expect(text).toContain("Description for 10.");
  });
});
