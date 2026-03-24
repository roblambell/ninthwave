// Tests for core/mux.ts — Multiplexer interface, CmuxAdapter, and getMux factory.

import { describe, it, expect, vi } from "vitest";

vi.mock("../core/cmux.ts", () => ({
  isAvailable: vi.fn(() => true),
  launchWorkspace: vi.fn(() => "workspace:42"),
  sendMessage: vi.fn(() => true),
  listWorkspaces: vi.fn(() => "workspace:1 TODO T-1 test"),
  closeWorkspace: vi.fn(() => true),
}));

import * as cmux from "../core/cmux.ts";
import { CmuxAdapter, getMux, type Multiplexer } from "../core/mux.ts";

describe("CmuxAdapter", () => {
  it("delegates isAvailable to cmux.isAvailable", () => {
    const adapter = new CmuxAdapter();
    const result = adapter.isAvailable();
    expect(result).toBe(true);
    expect(cmux.isAvailable).toHaveBeenCalled();
  });

  it("delegates launchWorkspace to cmux.launchWorkspace", () => {
    const adapter = new CmuxAdapter();
    const result = adapter.launchWorkspace("/tmp/test", "claude --name test");
    expect(result).toBe("workspace:42");
    expect(cmux.launchWorkspace).toHaveBeenCalledWith("/tmp/test", "claude --name test");
  });

  it("delegates sendMessage to cmux.sendMessage", () => {
    const adapter = new CmuxAdapter();
    const result = adapter.sendMessage("workspace:1", "hello");
    expect(result).toBe(true);
    expect(cmux.sendMessage).toHaveBeenCalledWith("workspace:1", "hello");
  });

  it("delegates listWorkspaces to cmux.listWorkspaces", () => {
    const adapter = new CmuxAdapter();
    const result = adapter.listWorkspaces();
    expect(result).toBe("workspace:1 TODO T-1 test");
    expect(cmux.listWorkspaces).toHaveBeenCalled();
  });

  it("delegates closeWorkspace to cmux.closeWorkspace", () => {
    const adapter = new CmuxAdapter();
    const result = adapter.closeWorkspace("workspace:1");
    expect(result).toBe(true);
    expect(cmux.closeWorkspace).toHaveBeenCalledWith("workspace:1");
  });
});

describe("getMux", () => {
  it("returns a CmuxAdapter by default", () => {
    const mux = getMux();
    expect(mux).toBeInstanceOf(CmuxAdapter);
  });

  it("returns an object satisfying the Multiplexer interface", () => {
    const mux: Multiplexer = getMux();
    expect(typeof mux.isAvailable).toBe("function");
    expect(typeof mux.launchWorkspace).toBe("function");
    expect(typeof mux.sendMessage).toBe("function");
    expect(typeof mux.listWorkspaces).toBe("function");
    expect(typeof mux.closeWorkspace).toBe("function");
  });
});
