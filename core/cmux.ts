import { run } from "./shell.ts";
import { setStatusImpl, setProgressImpl } from "./cmux-status.ts";
import { resolveCmuxBinary } from "./cmux-resolve.ts";
import type { RunResult } from "./types.ts";

/** Shell runner signature for dependency injection. */
export type ShellRunner = (cmd: string, args: string[]) => RunResult;

/** Process-kill signature for dependency injection. */
export type ProcessKiller = (pid: number, signal: NodeJS.Signals | number) => void;

/** Resolved cmux binary path (cached at module load). */
let _cmuxBin: string | null | undefined;
function cmuxBin(): string {
  if (_cmuxBin === undefined) _cmuxBin = resolveCmuxBinary();
  return _cmuxBin ?? "cmux";
}

/** Check if the cmux binary is available. */
export function isAvailable(): boolean {
  const result = run(cmuxBin(), ["version"]);
  return result.exitCode === 0;
}

/**
 * Launch a new cmux workspace.
 * Returns the workspace ref (e.g., "workspace:1") or null on failure.
 */
export function launchWorkspace(
  cwd: string,
  command: string,
): string | null {
  const result = run(cmuxBin(), [
    "new-workspace",
    "--cwd",
    cwd,
    "--command",
    command,
  ]);
  if (result.exitCode !== 0) return null;
  const match = result.stdout.match(/workspace:\d+/);
  return match ? match[0] : null;
}

/** Read screen content from a cmux workspace. Returns raw text or "" on failure. */
export function readScreen(
  workspaceRef: string,
  lines: number = 10,
): string {
  const result = run(cmuxBin(), [
    "read-screen",
    "--workspace",
    workspaceRef,
    "--lines",
    String(lines),
  ]);
  if (result.exitCode !== 0) return "";
  return result.stdout;
}

/** List all cmux workspaces. Returns the raw output string. */
export function listWorkspaces(): string {
  const result = run(cmuxBin(), ["list-workspaces"]);
  if (result.exitCode !== 0) return "";
  return result.stdout;
}

/**
 * Close a cmux workspace. Returns true on success.
 *
 * When `workItemId` is provided, first SIGKILL any lingering
 * `bun run <…>/core/cli.ts inbox --wait <workItemId>` processes. cmux's
 * own teardown does not reliably reap inbox-wait Bun processes whose
 * parent Claude Code Bash-tool shell got detached from the claude agent
 * (dogfooding has leaked hundreds of these bun pollers -- see
 * `core/commands/inbox.ts:waitForInbox`, an infinite `while(true) {
 * check; Bun.sleepSync(1000); }` loop that never yields to the event
 * loop, so its SIGINT/SIGTERM handlers also never fire). SIGKILL is
 * mandatory here -- SIGTERM is silently swallowed.
 */
export function closeWorkspace(workspaceRef: string, workItemId?: string): boolean {
  return closeWorkspaceImpl(
    workspaceRef,
    workItemId,
    (cmd, args) => run(cmd, args),
    (pid, signal) => process.kill(pid, signal),
  );
}

/**
 * Injectable implementation -- testable without real subprocesses.
 * @internal Exported for testing only.
 */
export function closeWorkspaceImpl(
  workspaceRef: string,
  workItemId: string | undefined,
  runner: ShellRunner,
  kill: ProcessKiller,
): boolean {
  if (workItemId) {
    killStrandedInboxWaiters(workItemId, runner, kill);
  }
  const result = runner(cmuxBin(), [
    "close-workspace",
    "--workspace",
    workspaceRef,
  ]);
  return result.exitCode === 0;
}

/**
 * SIGKILL any `bun run <…>/core/cli.ts inbox --wait <workItemId>` process
 * visible in `ps`. Best-effort: kills that fail (already exited, no
 * permission, etc.) are swallowed.
 *
 * SIGKILL not SIGTERM: the inbox-wait loop's signal handlers cannot fire
 * because `Bun.sleepSync` blocks the event loop. See comment on
 * `closeWorkspace`.
 *
 * @internal Exported for testing only.
 */
export function killStrandedInboxWaiters(
  workItemId: string,
  runner: ShellRunner,
  kill: ProcessKiller,
): number {
  const result = runner("ps", ["-A", "-o", "pid=,command="]);
  if (result.exitCode !== 0) return 0;

  // Escape regex metacharacters in the item id (item ids are generally
  // [A-Z0-9-], but be defensive).
  const idEscape = workItemId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Require trailing boundary so `H-CF-4` does not match `H-CF-40`.
  const pattern = new RegExp(
    `bun\\s+run\\s+\\S*core/cli\\.ts\\s+inbox\\s+--wait\\s+${idEscape}(?:\\s|$)`,
  );

  let killed = 0;
  for (const line of result.stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(\d+)\s+(.*)$/);
    if (!match) continue;
    const pid = parseInt(match[1]!, 10);
    if (!Number.isFinite(pid) || pid <= 1) continue;
    if (!pattern.test(match[2]!)) continue;
    try {
      kill(pid, "SIGKILL");
      killed++;
    } catch {
      // Process already exited, or we lack permission. Best-effort.
    }
  }
  return killed;
}

/**
 * Set status text, icon, and color for a cmux workspace.
 * Best-effort -- returns true on success, false on failure.
 *
 * Wraps: `cmux set-status <key> <text> --icon <icon> --color <color> --workspace <ref>`
 */
export function setStatus(
  ref: string,
  key: string,
  text: string,
  icon: string,
  color: string,
): boolean {
  return setStatusImpl(ref, key, text, icon, color, (_cmd, args) => run(cmuxBin(), args));
}

/**
 * Set progress value (0.0–1.0) and optional label for a cmux workspace.
 * Best-effort -- returns true on success, false on failure.
 *
 * Wraps: `cmux set-progress <value> [--label <label>] --workspace <ref>`
 */
export function setProgress(
  ref: string,
  value: number,
  label?: string,
): boolean {
  return setProgressImpl(ref, value, label, (_cmd, args) => run(cmuxBin(), args));
}

/**
 * Split a pane in the current cmux workspace and run a command in it.
 * Uses the CMUX_WORKSPACE_ID env var to target the current workspace.
 * Returns the surface ref (e.g., "surface:3") or null on failure.
 *
 * Two-step process: `cmux new-split right` creates the split, then
 * `cmux send` delivers the command text (with trailing `\n` for Enter).
 */
export function splitPane(command: string): string | null {
  return splitPaneImpl(command, (_cmd, args) => run(cmuxBin(), args));
}

/**
 * Injectable implementation of splitPane -- testable without vi.mock.
 * @internal Exported for testing only.
 */
export function splitPaneImpl(
  command: string,
  runner: ShellRunner,
): string | null {
  const result = runner("cmux", ["new-split", "right"]);
  if (result.exitCode !== 0) return null;

  // new-split returns a ref -- surface:N, pane:N, or similar
  const match = result.stdout.match(/(?:surface|pane):\d+/);
  const ref = match ? match[0] : null;
  if (!ref) return null;

  // Send the command to the new surface (cmux send interprets \n as Enter)
  const sendResult = runner("cmux", [
    "send",
    "--surface",
    ref,
    `${command}\n`,
  ]);
  if (sendResult.exitCode !== 0) return ref; // split succeeded, send failed -- return ref anyway

  return ref;
}
