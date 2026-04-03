// Tests for auto-launch logic: checkAutoLaunch and ensureMuxOrAutoLaunch.
// Uses dependency injection -- no vi.mock needed.

import { describe, it, expect, vi } from "vitest";
import {
  checkAutoLaunch,
  ensureMuxOrAutoLaunch,
  ensureMuxInteractiveOrDie,
  type AutoLaunchDeps,
  type InteractiveMuxDeps,
} from "../core/mux.ts";

// ── Helper: build injectable AutoLaunchDeps ─────────────────────────

function makeDeps(overrides: Partial<AutoLaunchDeps> = {}): AutoLaunchDeps {
  return {
    env: {},
    ...overrides,
  };
}

// ── checkAutoLaunch (pure detection logic) ──────────────────────────

describe("checkAutoLaunch", () => {
  it("returns proceed when CMUX_WORKSPACE_ID is set", () => {
    const deps = makeDeps({ env: { CMUX_WORKSPACE_ID: "workspace:1" } });
    expect(checkAutoLaunch(deps)).toEqual({ action: "proceed" });
  });

  it("returns proceed when nothing available (headless fallback)", () => {
    const deps = makeDeps({ env: {} });
    expect(checkAutoLaunch(deps)).toEqual({ action: "proceed" });
  });

  it("returns proceed when NINTHWAVE_MUX=headless", () => {
    const deps = makeDeps({ env: { NINTHWAVE_MUX: "headless" } });
    expect(checkAutoLaunch(deps)).toEqual({ action: "proceed" });
  });

  it("returns proceed when $TMUX is set (inside tmux session)", () => {
    const deps = makeDeps({
      env: { TMUX: "/tmp/tmux-501/default,12345,0" },
    });
    expect(checkAutoLaunch(deps)).toEqual({ action: "proceed" });
  });

  it("returns proceed when NINTHWAVE_MUX=tmux", () => {
    const deps = makeDeps({ env: { NINTHWAVE_MUX: "tmux" } });
    expect(checkAutoLaunch(deps)).toEqual({ action: "proceed" });
  });

  it("NINTHWAVE_MUX=cmux returns proceed", () => {
    const deps = makeDeps({ env: { NINTHWAVE_MUX: "cmux" } });
    expect(checkAutoLaunch(deps)).toEqual({ action: "proceed" });
  });

  it("invalid NINTHWAVE_MUX warns and falls through to proceed", () => {
    const warnings: string[] = [];
    const deps = makeDeps({
      env: { NINTHWAVE_MUX: "garbage" },
      warn: (msg) => warnings.push(msg),
    });
    const result = checkAutoLaunch(deps);
    expect(result).toEqual({ action: "proceed" });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Invalid NINTHWAVE_MUX");
    expect(warnings[0]).toContain("garbage");
  });

  it("NINTHWAVE_MUX=tmux takes precedence over CMUX_WORKSPACE_ID", () => {
    const deps = makeDeps({
      env: { NINTHWAVE_MUX: "tmux", CMUX_WORKSPACE_ID: "workspace:1" },
    });
    expect(checkAutoLaunch(deps)).toEqual({ action: "proceed" });
  });
});

// ── ensureMuxOrAutoLaunch (side-effectful wrapper) ──────────────────

describe("ensureMuxOrAutoLaunch", () => {
  it("returns normally when inside cmux", () => {
    const deps = makeDeps({ env: { CMUX_WORKSPACE_ID: "workspace:1" } });
    ensureMuxOrAutoLaunch(["watch"], deps);
  });

  it("returns normally when nothing is available (headless fallback)", () => {
    const deps = makeDeps({ env: {} });
    ensureMuxOrAutoLaunch(["watch"], deps);
  });

  it("returns normally when inside tmux session", () => {
    const deps = makeDeps({
      env: { TMUX: "/tmp/tmux-501/default,12345,0" },
    });
    ensureMuxOrAutoLaunch(["watch"], deps);
  });

  it("returns normally when NINTHWAVE_MUX=tmux", () => {
    const deps = makeDeps({ env: { NINTHWAVE_MUX: "tmux" } });
    ensureMuxOrAutoLaunch(["watch"], deps);
  });
});

// ── ensureMuxInteractiveOrDie ────────────────────────────────────────

function makeInteractiveDeps(
  overrides: Partial<InteractiveMuxDeps> & {
    promptAnswers?: string[];
    installExitCode?: number;
  } = {},
): InteractiveMuxDeps & { output: string[]; installed: string[][]; relaunched: string[][] | null; opened: string[] } {
  const output: string[] = [];
  const installed: string[][] = [];
  const relaunched: string[][] | null = [];
  const opened: string[] = [];
  const promptAnswers = overrides.promptAnswers ?? [];
  let promptIdx = 0;

  return {
    env: overrides.env ?? {},
    isTTY: overrides.isTTY ?? true,
    platform: overrides.platform ?? "darwin",
    prompt: async (_q: string) => {
      const answer = promptAnswers[promptIdx] ?? "";
      promptIdx++;
      return answer;
    },
    runInstall: (cmd: string, args: string[]) => {
      installed.push([cmd, ...args]);
      return { exitCode: overrides.installExitCode ?? 0 };
    },
    relaunch: (args: string[]) => {
      relaunched.push(args);
    },
    openApp: (app: string) => {
      opened.push(app);
    },
    output,
    installed,
    relaunched,
    opened,
  };
}

describe("ensureMuxInteractiveOrDie", () => {
  it("returns normally when inside cmux session", async () => {
    const deps = makeInteractiveDeps({ env: { CMUX_WORKSPACE_ID: "workspace:1" } });
    await ensureMuxInteractiveOrDie([], deps);
  });

  it("returns normally when inside tmux session", async () => {
    const deps = makeInteractiveDeps({ env: { TMUX: "/tmp/tmux" } });
    await ensureMuxInteractiveOrDie([], deps);
  });

  it("returns normally when nothing installed (headless fallback)", async () => {
    const deps = makeInteractiveDeps({ isTTY: false });
    await ensureMuxInteractiveOrDie([], deps);
  });

  it("returns normally when outside all sessions", async () => {
    const deps = makeInteractiveDeps({ platform: "darwin" });
    await ensureMuxInteractiveOrDie([], deps);
    expect(deps.opened).toHaveLength(0);
    expect(deps.installed).toHaveLength(0);
  });
});
