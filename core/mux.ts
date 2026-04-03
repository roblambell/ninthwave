// Multiplexer interface: abstracts terminal multiplexer operations.
// Decouples command modules from the concrete cmux/tmux implementation.

import { createInterface } from "readline";
import * as cmux from "./cmux.ts";
import { isTmuxLayoutMode, loadUserConfig } from "./config.ts";
import { HeadlessAdapter, isHeadlessWorkspaceRef } from "./headless.ts";
import { TmuxAdapter } from "./tmux.ts";
import { die, warn as defaultWarn } from "./output.ts";
import { run as defaultShellRun } from "./shell.ts";

/** Terminal multiplexer abstraction for workspace management. */
export interface Multiplexer {
  /** Identifier for this mux backend. */
  readonly type: MuxType;
  /** Check if the multiplexer backend is available (binary installed + session active). */
  isAvailable(): boolean;
  /** Return a human-readable message explaining why isAvailable() returned false. */
  diagnoseUnavailable(): string;
  /**
   * Launch a new workspace. Returns a ref (e.g., "workspace:1") or null on failure.
   */
  launchWorkspace(cwd: string, command: string, workItemId?: string): string | null;
  /** Split a pane in the current workspace. Returns a ref or null on failure. */
  splitPane(command: string): string | null;
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
  launchWorkspace(cwd: string, command: string, _workItemId?: string): string | null {
    return cmux.launchWorkspace(cwd, command);
  }
  splitPane(command: string): string | null {
    return cmux.splitPane(command);
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
export type MuxType = "cmux" | "tmux" | "headless";

/** Valid values for the NINTHWAVE_MUX environment variable. */
const VALID_MUX_VALUES: readonly MuxType[] = ["cmux", "tmux", "headless"] as const;

export type BackendPreference = MuxType | "auto";
export type BackendPreferenceSource = "env" | "auto";

export function muxTypeForWorkspaceRef(ref: string): MuxType {
  if (isHeadlessWorkspaceRef(ref)) return "headless";
  if (ref.startsWith("%")) return "tmux";
  if (ref.startsWith("workspace:")) return "cmux";
  if (ref.includes(":")) return "tmux";
  return "headless";
}

export interface BackendFallback {
  from: BackendPreference;
  to: MuxType;
  reason: string;
}

export interface ResolvedBackend {
  requested: BackendPreference;
  source: BackendPreferenceSource;
  effective: MuxType;
  fallback?: BackendFallback;
}

/** Injectable dependencies for multiplexer detection -- enables testing without vi.mock. */
export interface DetectMuxDeps {
  env: Record<string, string | undefined>;
  warn?: (message: string) => void;
}

function defaultDetectDeps(): DetectMuxDeps {
  return {
    env: process.env,
    warn: defaultWarn,
  };
}

function autoDetectMuxType(deps: DetectMuxDeps): MuxType {
  const { env } = deps;

  if (env.CMUX_WORKSPACE_ID) return "cmux";
  if (env.TMUX) return "tmux";
  return "headless";
}

function explicitBackendSupported(
  backend: MuxType,
  deps: DetectMuxDeps,
): boolean {
  const { env } = deps;

  switch (backend) {
    case "headless":
      return true;
    case "tmux":
      return Boolean(env.TMUX);
    case "cmux":
      return Boolean(env.CMUX_WORKSPACE_ID);
  }
}

function explicitBackendUnavailableReason(
  backend: Exclude<BackendPreference, "auto">,
): string {
  return `NINTHWAVE_MUX=${backend} requested, but no active ${backend} session detected. Falling back to headless.`;
}

/**
 * Resolve the multiplexer backend from env overrides or session detection.
 *
 * Detection chain:
 * 1. NINTHWAVE_MUX env override (validated)
 * 2. Session env ($CMUX_WORKSPACE_ID, $TMUX)
 * 3. Headless fallback
 */
export function resolveBackend(
  deps: DetectMuxDeps = defaultDetectDeps(),
): ResolvedBackend {
  const { env, warn } = deps;

  if (env.NINTHWAVE_MUX) {
    const override = env.NINTHWAVE_MUX as string;
    if (VALID_MUX_VALUES.includes(override as MuxType)) {
      if (explicitBackendSupported(override as MuxType, deps)) {
        return {
          requested: override as MuxType,
          source: "env",
          effective: override as MuxType,
        };
      }
      return {
        requested: override as MuxType,
        source: "env",
        effective: "headless",
        fallback: {
          from: override as MuxType,
          to: "headless",
          reason: explicitBackendUnavailableReason(override as MuxType),
        },
      };
    }
    (warn ?? defaultWarn)(
      `Invalid NINTHWAVE_MUX="${override}". Valid values: ${VALID_MUX_VALUES.join(", ")}. Falling back to auto-detect.`,
    );
  }

  const effective = autoDetectMuxType(deps);
  if (effective === "headless") {
    return {
      requested: "auto",
      source: "auto",
      effective,
      fallback: {
        from: "auto",
        to: "headless",
        reason: "No tmux or cmux session detected. Running headless.",
      },
    };
  }

  return {
    requested: "auto",
    source: "auto",
    effective,
  };
}

/**
 * Auto-detect the best available multiplexer.
 *
 * Detection chain:
 * 1. NINTHWAVE_MUX env override (validated)
 * 2. Session env ($CMUX_WORKSPACE_ID, $TMUX)
 * 3. Headless fallback
 */
export function detectMuxType(deps?: DetectMuxDeps): MuxType {
  return resolveBackend(deps ?? defaultDetectDeps()).effective;
}

/** Instantiate a mux adapter for a detected mux type. */
export function createMux(muxType: MuxType, cwd: string = process.cwd()): Multiplexer {
  if (muxType === "tmux") {
    const tmuxLayout = isTmuxLayoutMode(process.env.NINTHWAVE_TMUX_LAYOUT)
      ? process.env.NINTHWAVE_TMUX_LAYOUT
      : loadUserConfig().tmux_layout ?? "dashboard";
    return new TmuxAdapter({
      runner: defaultShellRun,
      sleep: process.env.NODE_ENV === "test" ? () => {} : (ms) => Bun.sleepSync(ms),
      env: process.env,
      cwd: () => cwd,
      layout: tmuxLayout,
    });
  }
  if (muxType === "headless") {
    return new HeadlessAdapter(cwd);
  }
  return new CmuxAdapter();
}

/**
 * Return the active multiplexer adapter based on auto-detection.
 *
 * Falls back to a headless adapter when no terminal multiplexer is available.
 */
export function getMux(deps?: DetectMuxDeps): Multiplexer {
  return createMux(resolveBackend(deps ?? defaultDetectDeps()).effective);
}

// ── Ensure we're inside a mux session ───────────────────────────────

/** Injectable dependencies for mux session detection. */
export interface AutoLaunchDeps {
  env: Record<string, string | undefined>;
  warn?: (message: string) => void;
}

/** Possible outcomes from auto-launch detection. */
export type AutoLaunchResult =
  | { action: "proceed" }
  | { action: "error"; message: string; reason: "cmux-not-in-session" | "nothing-installed" };

/**
 * Pure detection logic: determine whether to proceed or error.
 *
 * Headless is always available, so every scenario can proceed.
 *
 * We still validate NINTHWAVE_MUX so invalid overrides emit a warning rather than
 * silently masking a typo.
 */
export function checkAutoLaunch(deps: AutoLaunchDeps): AutoLaunchResult {
  const { env, warn } = deps;

  // 1. NINTHWAVE_MUX override
  if (env.NINTHWAVE_MUX) {
    const override = env.NINTHWAVE_MUX as string;
    if (override === "tmux" || override === "headless" || override === "cmux") {
      return { action: "proceed" };
    }
    // Invalid value -- warn and fall through to auto-detect
    (warn ?? defaultWarn)(
      `Invalid NINTHWAVE_MUX="${override}". Valid values: cmux, tmux, headless. Falling back to auto-detect.`,
    );
  }

  return { action: "proceed" };
}

const defaultAutoLaunchDeps: AutoLaunchDeps = {
  env: process.env,
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

// ── Interactive mux install ──────────────────────────────────────────

/** Injectable deps for interactive mux install. */
export interface InteractiveMuxDeps {
  env?: Record<string, string | undefined>;
  warn?: (message: string) => void;
  isTTY?: boolean;
  platform?: string;
  prompt?: (question: string) => Promise<string>;
  runInstall?: (cmd: string, args: string[]) => { exitCode: number };
  relaunch?: (args: string[]) => void;
  openApp?: (app: string) => void;
}

function defaultPromptFn(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function defaultRunInstall(cmd: string, args: string[]): { exitCode: number } {
  const result = Bun.spawnSync([cmd, ...args], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return { exitCode: result.exitCode ?? 1 };
}

function defaultRelaunch(args: string[]): void {
  Bun.spawnSync(["nw", ...args], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(0);
}

function defaultOpenApp(app: string): void {
  Bun.spawnSync(["open", "-a", app], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
}

/**
 * Ensure interactive backend setup is handled, or offer optional install guidance (TTY only).
 *
 * On TTY: may offer optional install guidance for interactive backends, or to
 * open cmux when installed but not in a session. On non-TTY: falls back to die().
 *
 * Use this in place of ensureMuxOrAutoLaunch for all CLI entry points.
 */
export async function ensureMuxInteractiveOrDie(
  originalArgs: string[],
  deps: InteractiveMuxDeps = {},
): Promise<void> {
  const autoLaunchDeps: AutoLaunchDeps = {
    env: deps.env ?? process.env,
    warn: deps.warn ?? defaultAutoLaunchDeps.warn,
  };
  const result = checkAutoLaunch(autoLaunchDeps);
  if (result.action === "proceed") return;

  const isTTY = deps.isTTY ?? (process.stdin.isTTY === true);
  if (!isTTY) {
    die(result.message);
    return;
  }

  const platform = deps.platform ?? process.platform;
  const prompt = deps.prompt ?? defaultPromptFn;
  const runInstall = deps.runInstall ?? defaultRunInstall;
  const relaunch = deps.relaunch ?? defaultRelaunch;
  const openApp = deps.openApp ?? defaultOpenApp;
  const isMac = platform === "darwin";

  if (result.reason === "cmux-not-in-session") {
    process.stdout.write("\ncmux is installed but you're not inside a session.\n\n");
    const answer = await prompt("Open cmux now? [Y/n]: ");
    if (answer.toLowerCase() !== "n") {
      if (isMac) {
        openApp("cmux");
        process.stdout.write("\ncmux is open. Run `nw` in a new workspace.\n\n");
      } else {
        process.stdout.write("\nOpen cmux and run `nw` in a new workspace.\n\n");
      }
      process.exit(0);
    } else {
      die(result.message);
    }
    return;
  }

  // nothing-installed
  process.stdout.write("\nHeadless works by default. Install tmux or cmux for interactive sessions.\n\n");

  const options: Array<{ name: string; description: string; installCmd: string; installArgs: string[] }> = [
    {
      name: "tmux",
      description: "battle-hardened, runs in your existing terminal",
      installCmd: "brew",
      installArgs: ["install", "tmux"],
    },
  ];
  if (isMac) {
    options.push({
      name: "cmux",
      description: "visual macOS sidebar",
      installCmd: "brew",
      installArgs: ["install", "--cask", "manaflow-ai/cmux/cmux"],
    });
  }

  for (let i = 0; i < options.length; i++) {
    const o = options[i]!;
    process.stdout.write(`  ${i + 1}. ${o.name}  -- ${o.description}\n`);
  }
  process.stdout.write("\n");

  if (!isMac) {
    process.stdout.write("On Linux, install tmux via your package manager:\n");
    process.stdout.write("  sudo apt install tmux   # Debian/Ubuntu\n");
    process.stdout.write("  brew install tmux        # Homebrew\n\n");
    process.stdout.write("Then re-run `nw` if you want an interactive backend.\n\n");
    process.exit(1);
    return;
  }

  const rangeLabel = options.length > 1 ? `1-${options.length}` : "1";
  const raw = await prompt(`Install [${rangeLabel}]: `);
  const idx = parseInt(raw, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= options.length) {
    die("No valid selection. Headless still works; install tmux or cmux and re-run nw for interactive sessions.");
    return;
  }

  const chosen = options[idx]!;
  process.stdout.write(`\nInstalling ${chosen.name}...\n\n`);
  const installResult = runInstall(chosen.installCmd, chosen.installArgs);
  if (installResult.exitCode !== 0) {
    die(`Installation failed (exit ${installResult.exitCode}). Headless still works; install tmux or cmux manually and re-run nw for interactive sessions.`);
    return;
  }

  if (chosen.name === "tmux") {
    process.stdout.write("\ntmux installed. Relaunching nw...\n\n");
    relaunch(originalArgs);
    process.exit(0);
  } else {
    process.stdout.write("\ncmux installed. Opening cmux...\n");
    openApp("cmux");
    process.stdout.write("Run `nw` in a new cmux workspace.\n\n");
    process.exit(0);
  }
}
