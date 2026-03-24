// Tests for start command: detectAiTool and cmdStart.

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { join } from "path";
import { writeFileSync } from "fs";
import { setupTempRepo, useFixture, cleanupTempRepos } from "./helpers.ts";

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

vi.mock("../core/cmux.ts", () => ({
  launchWorkspace: vi.fn(() => "workspace:1"),
  splitPane: vi.fn(() => "pane:1"),
  sendMessage: vi.fn(() => true),
  readScreen: vi.fn(() => "line1\nline2\nline3\nline4\n"),
}));

// Import mocked modules for assertions
import * as cmux from "../core/cmux.ts";
import { detectAiTool, cmdStart, launchSingleItem } from "../core/commands/start.ts";
import { parseTodos } from "../core/parser.ts";


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
    const todosFile = join(repo, "TODOS.md");
    const worktreeDir = join(repo, ".worktrees");

    writeFileSync(todosFile, "# TODOS\n");

    const output = captureOutput(() =>
      cmdStart([], todosFile, worktreeDir, repo),
    );

    expect(output).toContain("Usage");
  });

  it("dies when item ID not found", () => {
    const repo = setupTempRepo();
    useFixture(repo, "valid.md");
    const todosFile = join(repo, "TODOS.md");
    const worktreeDir = join(repo, ".worktrees");

    const output = captureOutput(() =>
      cmdStart(["NONEXISTENT-1"], todosFile, worktreeDir, repo),
    );

    expect(output).toContain("not found");
  });

  it("launches session for a valid item", () => {
    const repo = setupTempRepo();
    useFixture(repo, "valid.md");
    const todosFile = join(repo, "TODOS.md");
    const worktreeDir = join(repo, ".worktrees");

    const output = captureOutput(() =>
      cmdStart(["M-CI-1"], todosFile, worktreeDir, repo),
    );

    expect(output).toContain("Launched 1 session");
    expect(cmux.launchWorkspace as Mock).toHaveBeenCalled();
  });

  it("reports detected AI tool", () => {
    process.env.NINTHWAVE_AI_TOOL = "opencode";

    const repo = setupTempRepo();
    useFixture(repo, "valid.md");
    const todosFile = join(repo, "TODOS.md");
    const worktreeDir = join(repo, ".worktrees");

    const output = captureOutput(() =>
      cmdStart(["M-CI-1"], todosFile, worktreeDir, repo),
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
    const repo = setupTempRepo();
    useFixture(repo, "valid.md");
    const todosFile = join(repo, "TODOS.md");
    const worktreeDir = join(repo, ".worktrees");
    const items = parseTodos(todosFile, worktreeDir);
    const item = items.find((i) => i.id === "M-CI-1")!;

    const result = captureOutput(() => {
      const res = launchSingleItem(item, todosFile, worktreeDir, repo, "claude");
      expect(res).not.toBeNull();
      expect(res!.worktreePath).toContain("todo-M-CI-1");
      expect(res!.workspaceRef).toBe("workspace:1");
    });

    expect(cmux.launchWorkspace as Mock).toHaveBeenCalled();
    expect(result).toContain("Creating worktree for M-CI-1");
  });

  it("returns null when cmux launch fails", () => {
    (cmux.launchWorkspace as Mock).mockReturnValueOnce(null);

    const repo = setupTempRepo();
    useFixture(repo, "valid.md");
    const todosFile = join(repo, "TODOS.md");
    const worktreeDir = join(repo, ".worktrees");
    const items = parseTodos(todosFile, worktreeDir);
    const item = items.find((i) => i.id === "M-CI-1")!;

    const result = captureOutput(() => {
      const res = launchSingleItem(item, todosFile, worktreeDir, repo, "claude");
      expect(res).toBeNull();
    });

    expect(result).toContain("cmux launch failed");
  });

  it("allocates a partition for the item", () => {
    const repo = setupTempRepo();
    useFixture(repo, "valid.md");
    const todosFile = join(repo, "TODOS.md");
    const worktreeDir = join(repo, ".worktrees");
    const items = parseTodos(todosFile, worktreeDir);
    const item = items.find((i) => i.id === "M-CI-1")!;

    const result = captureOutput(() => {
      launchSingleItem(item, todosFile, worktreeDir, repo, "claude");
    });

    // Partition 1 should be allocated (first available)
    expect(result).toContain("partition 1");
  });

  it("ensures worktree directory is created", () => {
    const repo = setupTempRepo();
    useFixture(repo, "valid.md");
    const todosFile = join(repo, "TODOS.md");
    const worktreeDir = join(repo, ".worktrees");
    const items = parseTodos(todosFile, worktreeDir);
    const item = items.find((i) => i.id === "M-CI-1")!;

    // worktreeDir doesn't exist yet — launchSingleItem should create it
    captureOutput(() => {
      launchSingleItem(item, todosFile, worktreeDir, repo, "claude");
    });

    const { existsSync } = require("fs");
    expect(existsSync(worktreeDir)).toBe(true);
  });

  it("returns correct worktreePath for hub repo items", () => {
    const repo = setupTempRepo();
    useFixture(repo, "valid.md");
    const todosFile = join(repo, "TODOS.md");
    const worktreeDir = join(repo, ".worktrees");
    const items = parseTodos(todosFile, worktreeDir);
    const item = items.find((i) => i.id === "M-CI-1")!;

    captureOutput(() => {
      const res = launchSingleItem(item, todosFile, worktreeDir, repo, "claude");
      expect(res).not.toBeNull();
      expect(res!.worktreePath).toBe(join(worktreeDir, "todo-M-CI-1"));
    });
  });
});
