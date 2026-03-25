// Sandbox integration: wraps worker AI tool commands with nono for kernel-level sandboxing.
// nono provides Seatbelt (macOS) and Landlock (Linux) sandboxing with zero startup latency.
// The sandbox wraps the AI tool process, not the orchestrator.
//
// Strategy: use a nono profile (.nono/profiles/claude-worker.json) that extends the built-in
// claude-code profile. The profile handles deny groups, system paths, and temp dirs. At
// runtime we only need to add the dynamic worktree and project-root paths via CLI flags.
// Falls back to manual flag-building when no profile is found.

import { homedir, platform } from "os";
import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { run as defaultRun } from "./shell.ts";
import type { RunResult } from "./types.ts";

/** Shell runner signature — injectable for testing. */
type ShellRunner = (cmd: string, args: string[]) => RunResult;

/** Sandbox filesystem path policy. */
export interface SandboxPathPolicy {
  /** Directories with read-write access. */
  readWrite: string[];
  /** Directories with read-only access. */
  readOnly: string[];
}

/** Sandbox network policy. */
export interface SandboxNetworkPolicy {
  /** Allowed network hosts/domains. */
  allowHosts: string[];
}

/** Full sandbox configuration. */
export interface SandboxConfig {
  /** Whether sandboxing is enabled (default: true when nono is available). */
  enabled: boolean;
  /** Filesystem path policies. */
  paths: SandboxPathPolicy;
  /** Network policies. */
  network: SandboxNetworkPolicy;
}

/** Default allowed network hosts for worker operations. */
const DEFAULT_ALLOWED_HOSTS = [
  "api.github.com",
  "github.com",
  "registry.npmjs.org",
  "bun.sh",
];

/** Default read-only paths for worker operations. */
function defaultReadOnlyPaths(projectRoot: string): string[] {
  const home = homedir();
  const paths = [
    projectRoot,
    join(home, ".claude"),
    join(home, ".config"),
    join(home, ".bun"),
    join(home, ".npm"),
    join(home, ".node"),
  ];

  // Add platform-specific system paths
  if (platform() === "darwin") {
    paths.push("/usr/lib", "/usr/local", "/opt/homebrew");
  } else {
    paths.push("/usr/lib", "/usr/local/lib", "/usr/share");
  }

  return paths.filter((p) => existsSync(p));
}

/**
 * Check if nono is installed and available.
 * Uses dependency injection for testability.
 */
export function isNonoAvailable(
  runner: ShellRunner = defaultRun,
): boolean {
  try {
    const result = runner("which", ["nono"]);
    return result.exitCode === 0 && result.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/** Track whether we've already warned about missing nono. */
let _warnedNoSandbox = false;

/**
 * Emit a one-time warning that nono is not installed.
 * Returns true if the warning was emitted (first call), false if already warned.
 */
export function warnOnceNoSandbox(
  warnFn: (msg: string) => void = console.warn,
): boolean {
  if (_warnedNoSandbox) return false;
  _warnedNoSandbox = true;
  warnFn(
    "[ninthwave] nono not found — workers will run without sandbox. Install nono for kernel-level isolation: https://github.com/always-further/nono",
  );
  return true;
}

/** Reset the one-time warning state (for testing). */
export function _resetWarnState(): void {
  _warnedNoSandbox = false;
}

/** Reset the dry-run validation cache (for testing). */
export function _resetDryRunCache(): void {
  _dryRunValidated = false;
}

/**
 * Build default sandbox configuration for a worker.
 *
 * @param worktreePath - The worker's isolated worktree (read-write)
 * @param projectRoot - The main project root (read-only)
 */
export function buildDefaultConfig(
  worktreePath: string,
  projectRoot: string,
): SandboxConfig {
  return {
    enabled: true,
    paths: {
      readWrite: [worktreePath],
      readOnly: defaultReadOnlyPaths(projectRoot),
    },
    network: {
      allowHosts: [...DEFAULT_ALLOWED_HOSTS],
    },
  };
}

/**
 * Load sandbox overrides from .ninthwave/config.
 *
 * Recognized keys:
 *   sandbox_extra_rw_paths   — comma-separated additional read-write paths
 *   sandbox_extra_ro_paths   — comma-separated additional read-only paths
 *   sandbox_extra_hosts      — comma-separated additional allowed network hosts
 *
 * @param projectRoot - The project root containing .ninthwave/config
 * @param baseConfig - The default config to augment
 * @returns The augmented config
 */
export function applySandboxOverrides(
  projectRoot: string,
  baseConfig: SandboxConfig,
): SandboxConfig {
  const configPath = join(projectRoot, ".ninthwave", "config");
  if (!existsSync(configPath)) return baseConfig;

  const content = readFileSync(configPath, "utf-8");
  const config = { ...baseConfig };
  config.paths = {
    readWrite: [...baseConfig.paths.readWrite],
    readOnly: [...baseConfig.paths.readOnly],
  };
  config.network = {
    allowHosts: [...baseConfig.network.allowHosts],
  };

  for (const rawLine of content.split("\n")) {
    const eqIdx = rawLine.indexOf("=");
    if (eqIdx === -1) continue;

    const key = rawLine.slice(0, eqIdx).trim();
    if (!key || key.startsWith("#")) continue;

    let value = rawLine.slice(eqIdx + 1).trim();
    value = value.replace(/^["']/, "").replace(/["']$/, "");

    switch (key) {
      case "sandbox_extra_rw_paths":
        config.paths.readWrite.push(
          ...value.split(",").map((p) => p.trim()).filter(Boolean),
        );
        break;
      case "sandbox_extra_ro_paths":
        config.paths.readOnly.push(
          ...value.split(",").map((p) => p.trim()).filter(Boolean),
        );
        break;
      case "sandbox_extra_hosts":
        config.network.allowHosts.push(
          ...value.split(",").map((h) => h.trim()).filter(Boolean),
        );
        break;
    }
  }

  return config;
}

/**
 * Find the nono profile for claude workers.
 *
 * Search order:
 * 1. Project-level: <projectRoot>/.nono/profiles/claude-worker.json
 * 2. User-level:    ~/.nono/profiles/claude-worker.json
 *
 * Project-level is always preferred. Returns the absolute path if found, null otherwise.
 *
 * @param projectRoot - The project root to search first
 * @param home - Home directory for user-level fallback (default: os.homedir(), injectable for testing)
 */
export function findProfile(projectRoot: string, home?: string): string | null {
  // 1. Project-level (preferred)
  const projectProfile = join(projectRoot, ".nono", "profiles", "claude-worker.json");
  if (existsSync(projectProfile)) return projectProfile;

  // 2. User-level fallback
  const userHome = home ?? homedir();
  const userProfile = join(userHome, ".nono", "profiles", "claude-worker.json");
  if (existsSync(userProfile)) return userProfile;

  return null;
}

/**
 * Build a sandbox command using the nono profile.
 *
 * Uses --profile for the policy, --workdir for the worktree (gets RW access
 * via the profile's workdir.access=readwrite), and --read for the project root.
 */
export function buildProfileCommand(
  profilePath: string,
  worktreePath: string,
  projectRoot: string,
  command: string,
): string {
  const parts: string[] = [
    "nono", "run", "-s",
    "--profile", profilePath,
    "--workdir", worktreePath,
  ];

  // Grant read-only access to the main project root (different from worktree)
  if (projectRoot !== worktreePath) {
    parts.push("--read", projectRoot);
  }

  parts.push("--", command);
  return parts.join(" ");
}

/**
 * Build the nono command prefix for sandboxing a worker command.
 *
 * Filesystem-only sandboxing — network is unrestricted by default because
 * workers need to push to GitHub, install packages, call APIs, etc.
 * Using --allow-domain triggers nono's network proxy which adds latency
 * and can hang; filesystem isolation is the right default.
 *
 * @param config - The sandbox configuration
 * @param command - The original command to wrap
 * @returns The sandboxed command string
 */
export function buildSandboxCommand(
  config: SandboxConfig,
  command: string,
): string {
  const parts: string[] = ["nono", "run", "-s", "--allow-cwd"];

  for (const rw of config.paths.readWrite) {
    parts.push("--allow", rw);
  }
  for (const ro of config.paths.readOnly) {
    parts.push("--read", ro);
  }

  parts.push("--", command);

  return parts.join(" ");
}

/** Track whether dry-run validation has passed. */
let _dryRunValidated = false;

/**
 * Validate the sandbox command with a dry-run before first use.
 *
 * Runs `nono run --dry-run ...` to verify the profile and flags are valid
 * without actually executing the command. Caches the result so validation
 * only happens once per process.
 *
 * @returns true if the dry-run succeeded, false if it failed
 */
export function validateWithDryRun(
  sandboxedCommand: string,
  runner: ShellRunner = defaultRun,
  warnFn: (msg: string) => void = console.warn,
): boolean {
  if (_dryRunValidated) return true;

  // Insert --dry-run after "nono run"
  const dryRunCmd = sandboxedCommand.replace(
    "nono run ",
    "nono run --dry-run ",
  );

  // Split the dry-run command to call the runner
  const parts = dryRunCmd.split(" ");
  const cmd = parts[0]!;
  const args = parts.slice(1);

  try {
    const result = runner(cmd, args);
    if (result.exitCode === 0) {
      _dryRunValidated = true;
      return true;
    }
    warnFn(
      `[ninthwave] sandbox dry-run failed (exit ${result.exitCode}): ${result.stderr.trim()}. Falling back to unsandboxed execution.`,
    );
    return false;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    warnFn(
      `[ninthwave] sandbox dry-run error: ${msg}. Falling back to unsandboxed execution.`,
    );
    return false;
  }
}

/**
 * Wrap a worker command with nono sandboxing if available.
 *
 * Sandbox is ON by default when nono is installed. Use --no-sandbox to opt out.
 *
 * This is the main entry point for sandbox integration. It:
 * 1. Checks if sandboxing is disabled (--no-sandbox)
 * 2. Checks if nono is installed
 * 3. Looks for a nono profile, falling back to manual flags
 * 4. Validates with dry-run before first use
 * 5. Wraps the command
 *
 * @param command - The original worker command
 * @param worktreePath - The worker's isolated worktree
 * @param projectRoot - The main project root
 * @param options - Options controlling sandbox behavior
 * @returns The (possibly sandboxed) command string
 */
export function wrapWithSandbox(
  command: string,
  worktreePath: string,
  projectRoot: string,
  options: {
    disabled?: boolean;
    runner?: ShellRunner;
    warnFn?: (msg: string) => void;
  } = {},
): string {
  const { disabled = false, runner, warnFn } = options;

  // --no-sandbox opt-out
  if (disabled) return command;

  // Check nono availability — sandbox is on by default when nono is installed
  if (!isNonoAvailable(runner)) {
    warnOnceNoSandbox(warnFn);
    return command;
  }

  // Try profile-based sandboxing first
  const profilePath = findProfile(projectRoot);
  if (profilePath) {
    const sandboxed = buildProfileCommand(profilePath, worktreePath, projectRoot, command);

    // Validate with dry-run before first use
    if (validateWithDryRun(sandboxed, runner, warnFn)) {
      return sandboxed;
    }
    // Dry-run failed — fall through to unsandboxed
    return command;
  }

  // Fallback: manual flag-building (no profile found)
  const config = buildDefaultConfig(worktreePath, projectRoot);
  const finalConfig = applySandboxOverrides(projectRoot, config);
  const sandboxed = buildSandboxCommand(finalConfig, command);

  // Validate fallback command too
  if (validateWithDryRun(sandboxed, runner, warnFn)) {
    return sandboxed;
  }
  return command;
}

/** Sandbox config keys for use in config.ts KNOWN_CONFIG_KEYS. */
export const SANDBOX_CONFIG_KEYS = [
  "sandbox_extra_rw_paths",
  "sandbox_extra_ro_paths",
  "sandbox_extra_hosts",
];
