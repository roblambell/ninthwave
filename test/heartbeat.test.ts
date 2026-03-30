// Tests for core/commands/heartbeat.ts and heartbeat I/O in core/daemon.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  cmdHeartbeat,
  extractItemId,
  parseHeartbeatArgs,
  type HeartbeatDeps,
} from "../core/commands/heartbeat.ts";
import {
  writeHeartbeat,
  readHeartbeat,
  heartbeatDir,
  heartbeatFilePath,
  userStateDir,
  type DaemonIO,
  type WorkerProgress,
} from "../core/daemon.ts";

// ── Helpers ──────────────────────────────────────────────────────────

function createMockIO(): DaemonIO & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    writeFileSync: vi.fn((path, content) => {
      files.set(String(path), String(content));
    }) as DaemonIO["writeFileSync"],
    readFileSync: vi.fn((path) => {
      const content = files.get(String(path));
      if (content === undefined) throw new Error(`ENOENT: ${String(path)}`);
      return content;
    }) as unknown as DaemonIO["readFileSync"],
    unlinkSync: vi.fn((path) => {
      files.delete(String(path));
    }) as DaemonIO["unlinkSync"],
    existsSync: vi.fn((path) => files.has(String(path))) as DaemonIO["existsSync"],
    mkdirSync: vi.fn() as DaemonIO["mkdirSync"],
    renameSync: vi.fn((from, to) => {
      const fromPath = String(from);
      const toPath = String(to);
      const content = files.get(fromPath);
      if (content !== undefined) {
        files.set(toPath, content);
        files.delete(fromPath);
      }
    }) as DaemonIO["renameSync"],
  };
}

function createDeps(
  io: DaemonIO & { files: Map<string, string> },
  branch: string | null = "ninthwave/H-FOO-1",
): HeartbeatDeps {
  return {
    io,
    getBranch: () => branch,
  };
}

// ── extractItemId ───────────────────────────────────────────────────

describe("extractItemId", () => {
  it("extracts ID from item branch", () => {
    expect(extractItemId("ninthwave/H-FOO-1")).toBe("H-FOO-1");
  });

  it("extracts complex IDs", () => {
    expect(extractItemId("ninthwave/M-ORC-3")).toBe("M-ORC-3");
    expect(extractItemId("ninthwave/L-VIS-12")).toBe("L-VIS-12");
  });

  it("returns null for non-item branches", () => {
    expect(extractItemId("main")).toBeNull();
    expect(extractItemId("feature/something")).toBeNull();
    expect(extractItemId("ninthwave-H-FOO-1")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractItemId("")).toBeNull();
  });
});

// ── parseHeartbeatArgs ──────────────────────────────────────────────

describe("parseHeartbeatArgs", () => {
  it("parses --progress and --label", () => {
    const result = parseHeartbeatArgs([
      "--progress",
      "0.5",
      "--label",
      "Writing tests",
    ]);
    expect(result).toEqual({ progress: 0.5, label: "Writing tests" });
  });

  it("accepts 0.0 as progress", () => {
    const result = parseHeartbeatArgs([
      "--progress",
      "0",
      "--label",
      "Starting",
    ]);
    expect(result).toEqual({ progress: 0, label: "Starting" });
  });

  it("accepts 1.0 as progress", () => {
    const result = parseHeartbeatArgs([
      "--progress",
      "1.0",
      "--label",
      "Done",
    ]);
    expect(result).toEqual({ progress: 1.0, label: "Done" });
  });

  it("exits on missing --progress", () => {
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    parseHeartbeatArgs(["--label", "test"]);
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it("exits on missing --label", () => {
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    parseHeartbeatArgs(["--progress", "0.5"]);
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it("exits on progress < 0", () => {
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    parseHeartbeatArgs(["--progress", "-0.1", "--label", "test"]);
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it("exits on progress > 1", () => {
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    parseHeartbeatArgs(["--progress", "1.1", "--label", "test"]);
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it("exits on NaN progress", () => {
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    parseHeartbeatArgs(["--progress", "abc", "--label", "test"]);
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});

// ── writeHeartbeat / readHeartbeat ──────────────────────────────────

describe("writeHeartbeat", () => {
  it("creates file with correct JSON structure", () => {
    const io = createMockIO();
    writeHeartbeat("/project", "H-FOO-1", 0.5, "Writing tests", io);

    const filePath = heartbeatFilePath("/project", "H-FOO-1");
    expect(io.files.has(filePath)).toBe(true);

    const data = JSON.parse(io.files.get(filePath)!) as WorkerProgress;
    expect(data.id).toBe("H-FOO-1");
    expect(data.progress).toBe(0.5);
    expect(data.label).toBe("Writing tests");
    expect(data.ts).toBeDefined();
    // ts should be a valid ISO string
    expect(new Date(data.ts).toISOString()).toBe(data.ts);
  });

  it("creates directory if it does not exist", () => {
    const io = createMockIO();
    writeHeartbeat("/project", "H-FOO-1", 0.3, "test", io);
    expect(io.mkdirSync).toHaveBeenCalledWith(
      heartbeatDir("/project"),
      { recursive: true },
    );
  });
});

describe("readHeartbeat", () => {
  it("returns parsed data from existing file", () => {
    const io = createMockIO();
    writeHeartbeat("/project", "H-FOO-1", 0.7, "Almost done", io);

    const result = readHeartbeat("/project", "H-FOO-1", io);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("H-FOO-1");
    expect(result!.progress).toBe(0.7);
    expect(result!.label).toBe("Almost done");
  });

  it("returns null for missing file", () => {
    const io = createMockIO();
    const result = readHeartbeat("/project", "NONEXISTENT", io);
    expect(result).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    const io = createMockIO();
    const filePath = heartbeatFilePath("/project", "H-FOO-1");
    io.files.set(filePath, "not-json");
    const result = readHeartbeat("/project", "H-FOO-1", io);
    expect(result).toBeNull();
  });
});

// ── Path helpers ────────────────────────────────────────────────────

describe("heartbeat path helpers", () => {
  it("heartbeatDir returns correct path", () => {
    const dir = heartbeatDir("/project");
    expect(dir).toBe(`${userStateDir("/project")}/heartbeats`);
  });

  it("heartbeatFilePath returns correct path", () => {
    const path = heartbeatFilePath("/project", "H-FOO-1");
    expect(path).toBe(`${userStateDir("/project")}/heartbeats/H-FOO-1.json`);
  });
});

// ── cmdHeartbeat ────────────────────────────────────────────────────

describe("cmdHeartbeat", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("writes heartbeat file and returns success message", () => {
    const io = createMockIO();
    const deps = createDeps(io, "ninthwave/H-FOO-1");
    const msg = cmdHeartbeat(
      ["--progress", "0.5", "--label", "test"],
      "/project",
      deps,
    );
    expect(msg).toContain("H-FOO-1");
    expect(msg).toContain("50%");
    expect(msg).toContain("test");

    // File should exist
    const filePath = heartbeatFilePath("/project", "H-FOO-1");
    expect(io.files.has(filePath)).toBe(true);
  });

  it("exits on non-item branch", () => {
    const io = createMockIO();
    const deps = createDeps(io, "main");
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    vi.spyOn(console, "error").mockImplementation(() => {});

    cmdHeartbeat(
      ["--progress", "0.5", "--label", "test"],
      "/project",
      deps,
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it("exits when branch detection fails", () => {
    const io = createMockIO();
    const deps = createDeps(io, null);
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
    vi.spyOn(console, "error").mockImplementation(() => {});

    cmdHeartbeat(
      ["--progress", "0.5", "--label", "test"],
      "/project",
      deps,
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it("parses --progress and --label flags correctly", () => {
    const io = createMockIO();
    const deps = createDeps(io, "ninthwave/M-ORC-3");
    cmdHeartbeat(
      ["--progress", "0.3", "--label", "Writing tests"],
      "/project",
      deps,
    );

    const filePath = heartbeatFilePath("/project", "M-ORC-3");
    const data = JSON.parse(io.files.get(filePath)!) as WorkerProgress;
    expect(data.progress).toBe(0.3);
    expect(data.label).toBe("Writing tests");
  });
  it.each(["--model", "--tokens-in", "--tokens-out"])(
    "exits on unsupported %s flag",
    (flag) => {
      const exitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation(() => undefined as never);
      vi.spyOn(console, "error").mockImplementation(() => {});
      parseHeartbeatArgs(["--progress", "1.0", "--label", "test", flag, "value"]);
      expect(exitSpy).toHaveBeenCalledWith(1);
      exitSpy.mockRestore();
    },
  );
});
