// Multiplexer interface: abstracts terminal multiplexer operations.
// Decouples command modules from the concrete cmux/tmux implementation.

import * as cmux from "./cmux.ts";
import { TmuxAdapter } from "./tmux.ts";
import { die, warn as defaultWarn } from "./output.ts";
import { resolveCmuxBinary } from "./cmux-resolve.ts";
import { run as defaultShellRun } from "./shell.ts";
import type { RunResult } from "./types.ts";

/** Shell runner signature -- injectable for testing. */
export type ShellRunner = (
  cmd: string,
  args: string[],
) => RunResult;

/** Terminal multiplexer abstraction for workspace management. */
export interface Multiplexer {
  /** Identifier for this mux backend. */
  readonly type: MuxType;
  /** Check if the multiplexer backend is available (binary installed + session active). */
  isAvailable(): boolean;
  /** Return a human-readable message explaining why isAvailable() returned false. */
  diagnoseUnavailable(): string;
  /** Launch a new workspace. Returns a ref (e.g., "workspace:1") or null on failure. */
  launchWorkspace(cwd: string, command: string, todoId?: string): string | null;
  /** Split a pane in the current workspace. Returns a ref or null on failure. */
  splitPane(command: string): string | null;
  /** Send a message to a workspace. Returns true on success. */
  sendMessage(ref: string, message: string): boolean;
  /** Read screen content from a workspace. Returns raw text or "" on failure. */
  readScreen(ref: string, lines?: number): string;
  /** List all workspaces. Returns raw output string. */
  listWorkspaces(): string;
  /** Close a workspace. Returns true on success. */
  closeWorkspace(ref: string): boolean;
  /** Set status text, icon, and color for a workspace. Best-effort -- returns boolean success. */
  setStatus(ref: string, key: string, text: string, icon: string, color: string): boolean;
  /** Set progress value (0.0–1.0) and optional label for a workspace. Best-effort -- returns boolean success. */
  setProgress(ref: string, value: number, label?: string): boolean;
}

/** Adapter that delegates to the cmux CLI binary. */
export class CmuxAdapter implements Multiplexer {
  readonly type: MuxType = "cmux";

  isAvailable(): boolean {
    return cmux.isAvailable();
  }

  diagnoseUnavailable(): string {
    return "cmux is not available. Ensure cmux is installed and running.";
  }
  launchWorkspace(cwd: string, command: string, _todoId?: string): string | null {
    return cmux.launchWorkspace(cwd, command);
  }
  splitPane(command: string): string | null {
    return cmux.splitPane(command);
  }
  sendMessage(ref: string, message: string): boolean {
    return cmux.sendMessage(ref, message);
  }
  readScreen(ref: string, lines?: number): string {
    return cmux.readScreen(ref, lines);
  }
  listWorkspaces(): string {
    return cmux.listWorkspaces();
  }
  closeWorkspace(ref: string): boolean {
    return cmux.closeWorkspace(ref);
  }
  setStatus(ref: string, key: string, text: string, icon: string, color: string): boolean {
    return cmux.setStatus(ref, key, text, icon, color);
  }
  setProgress(ref: string, value: number, label?: string): boolean {
    return cmux.setProgress(ref, value, label);
  }
}

/** Supported multiplexer backends. */
export type MuxType = "cmux" | "tmux";

/** Valid values for the NINTHWAVE_MUX environment variable. */
const VALID_MUX_VALUES: readonly MuxType[] = ["cmux", "tmux"] as const;

/** Injectable dependencies for multiplexer detection -- enables testing without vi.mock. */
export interface DetectMuxDeps {
  env: Record<string, string | undefined>;
  checkBinary: (name: string) => boolean;
  warn?: (message: string) => void;
}

const defaultDetectDeps: DetectMuxDeps = {
  env: process.env,
  checkBinary: (name: string): boolean => {
    if (name === "cmux") return resolveCmuxBinary() !== null;
    // For tmux and others, check PATH
    return Bun.which(name) !== null;
  },
  warn: defaultWarn,
};

/**
 * Auto-detect the best available multiplexer.
 *
 * Detection chain:
 * 1. NINTHWAVE_MUX env override (validated)
 * 2. CMUX_WORKSPACE_ID -- inside a cmux session
 * 3. $TMUX -- inside a tmux session
 * 4. tmux binary available (preferred over cmux outside session)
 * 5. cmux binary available
 * 6. Error -- no multiplexer found
 */
export function detectMuxType(deps: DetectMuxDeps = defaultDetectDeps): MuxType {
  const { env, checkBinary, warn } = deps;

  // 1. NINTHWAVE_MUX override
  if (env.NINTHWAVE_MUX) {
    const override = env.NINTHWAVE_MUX as string;
    if (VALID_MUX_VALUES.includes(override as MuxType)) {
      return override as MuxType;
    }
    // Invalid value -- warn and fall through to auto-detect
    (warn ?? defaultWarn)(
      `Invalid NINTHWAVE_MUX="${override}". Valid values: ${VALID_MUX_VALUES.join(", ")}. Falling back to auto-detect.`,
    );
  }

  // 2. Inside a cmux session
  if (env.CMUX_WORKSPACE_ID) return "cmux";

  // 3. Inside a tmux session
  if (env.TMUX) return "tmux";

  // 4. tmux binary available (preferred over cmux outside session)
  if (checkBinary("tmux")) return "tmux";

  // 5. cmux binary available
  if (checkBinary("cmux")) return "cmux";

  // 6. No multiplexer found
  throw new Error(
    "No multiplexer available. Install tmux (brew install tmux) or cmux (brew install --cask manaflow-ai/cmux/cmux).",
  );
}

/**
 * Return the active multiplexer adapter based on auto-detection.
 *
 * When detection fails (no mux available), falls back to CmuxAdapter so that
 * callers using `getMux()` as a default parameter don't crash at import time.
 * The adapter's `isAvailable()` will return false, and the caller can handle
 * the error.
 */
export function getMux(deps?: DetectMuxDeps): Multiplexer {
  try {
    const muxType = detectMuxType(deps);
    if (muxType === "tmux") {
      return new TmuxAdapter({
        runner: defaultShellRun,
        sleep: process.env.NODE_ENV === "test" ? () => {} : (ms) => Bun.sleepSync(ms),
        env: process.env,
        cwd: () => process.cwd(),
      });
    }
    return new CmuxAdapter();
  } catch {
    // No mux available -- fall back to CmuxAdapter (isAvailable() will report false)
    return new CmuxAdapter();
  }
}

// ── Ensure we're inside a mux session ───────────────────────────────

/** Injectable dependencies for mux session detection. */
export interface AutoLaunchDeps {
  env: Record<string, string | undefined>;
  checkBinary: (name: string) => boolean;
  warn?: (message: string) => void;
}

/** Possible outcomes from auto-launch detection. */
export type AutoLaunchResult =
  | { action: "proceed" }
  | { action: "error"; message: string };

/**
 * Pure detection logic: determine whether to proceed or error.
 *
 * Detection chain:
 * 1. NINTHWAVE_MUX override → tmux: proceed, cmux: must be in session, invalid: warn+fallthrough
 * 2. CMUX_WORKSPACE_ID set → proceed (already inside cmux)
 * 3. $TMUX set → proceed (inside tmux session)
 * 4. tmux installed → proceed (adapter creates its own session)
 * 5. cmux installed → error (detected but not in a session)
 * 6. Nothing → error (install prompt)
 */
export function checkAutoLaunch(deps: AutoLaunchDeps): AutoLaunchResult {
  const { env, checkBinary, warn } = deps;

  // 1. NINTHWAVE_MUX override
  if (env.NINTHWAVE_MUX) {
    const override = env.NINTHWAVE_MUX as string;
    if (override === "tmux") return { action: "proceed" };
    if (override === "cmux") {
      // Must be inside a cmux session
      if (env.CMUX_WORKSPACE_ID) return { action: "proceed" };
      return {
        action: "error",
        message: "NINTHWAVE_MUX=cmux but not inside a cmux session. Open cmux and run nw there.",
      };
    }
    // Invalid value -- warn and fall through to auto-detect
    (warn ?? defaultWarn)(
      `Invalid NINTHWAVE_MUX="${override}". Valid values: cmux, tmux. Falling back to auto-detect.`,
    );
  }

  // 2. Already inside cmux -- proceed normally
  if (env.CMUX_WORKSPACE_ID) return { action: "proceed" };

  // 3. Inside a tmux session -- proceed
  if (env.TMUX) return { action: "proceed" };

  // 4. tmux installed -- proceed (adapter creates its own session)
  if (checkBinary("tmux")) return { action: "proceed" };

  // 5. cmux installed but not in a session
  if (checkBinary("cmux")) {
    return {
      action: "error",
      message: "Not inside a cmux session. Open cmux and run nw there.",
    };
  }

  // 6. Nothing installed
  return {
    action: "error",
    message:
      "No multiplexer available. Install tmux (brew install tmux) or cmux (brew install --cask manaflow-ai/cmux/cmux).",
  };
}

const defaultAutoLaunchDeps: AutoLaunchDeps = {
  env: process.env,
  checkBinary: (name: string): boolean => {
    if (name === "cmux") return resolveCmuxBinary() !== null;
    return Bun.which(name) !== null;
  },
  warn: defaultWarn,
};

/**
 * Ensure we're inside a mux session (or can create one), or die with a helpful message.
 *
 * For commands that need a multiplexer (watch, start, <ID>, no-args interactive),
 * call this before proceeding.
 */
export function ensureMuxOrAutoLaunch(
  _originalArgs: string[],
  deps: AutoLaunchDeps = defaultAutoLaunchDeps,
): void {
  const result = checkAutoLaunch(deps);
  if (result.action === "proceed") return;
  die(result.message);
}

/**
 * Poll a workspace until it shows stable, substantial content (agent is ready).
 *
 * Checks `readScreen` every `pollMs` milliseconds. Returns true once the screen
 * has >= 3 non-empty lines and the content is the same for two consecutive polls
 * (indicating the agent has finished loading and the UI is stable).
 *
 * @param sleep -- injectable for testing; defaults to Bun.sleepSync
 */
export function waitForReady(
  mux: Multiplexer,
  ref: string,
  sleep: (ms: number) => void = process.env.NODE_ENV === "test"
    ? () => {}
    : (ms) => Bun.sleepSync(ms),
  maxAttempts: number = 30,
  pollMs: number = 500,
): boolean {
  let lastScreen = "";

  for (let i = 0; i < maxAttempts; i++) {
    sleep(pollMs);
    const screen = mux.readScreen(ref, 10);
    const lines = screen.split("\n").filter((l) => l.trim().length > 0);

    // Stable, substantial content = ready
    if (lines.length >= 3 && screen === lastScreen) {
      return true;
    }
    lastScreen = screen;
  }

  return false;
}
