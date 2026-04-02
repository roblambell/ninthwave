// Shared helpers for re-executing the current ninthwave CLI.
// Dev mode reruns the script entrypoint through Bun; packaged mode
// invokes the compiled executable directly.

export interface CliRespawnProcessLike {
  argv: string[];
  execPath?: string;
}

export interface CliRespawnCommand {
  command: string;
  args: string[];
}

const SCRIPT_ENTRYPOINT_RE = /\.(?:[cm]?[jt]s|tsx|jsx)$/i;

function isScriptEntrypoint(value: string | undefined): value is string {
  return typeof value === "string" && SCRIPT_ENTRYPOINT_RE.test(value);
}

export function resolveCliRespawnCommand(
  cliArgs: string[],
  proc: CliRespawnProcessLike = process,
): CliRespawnCommand {
  const argv0 = proc.argv[0];
  const execPath = proc.execPath;

  if (isScriptEntrypoint(proc.argv[1])) {
    if (!argv0) throw new Error("Cannot respawn dev CLI without process.argv[0]");
    return {
      command: argv0,
      args: [proc.argv[1], ...cliArgs],
    };
  }

  const command = execPath ?? argv0;
  if (!command) throw new Error("Cannot respawn packaged CLI without process.execPath or process.argv[0]");
  return {
    command,
    args: [...cliArgs],
  };
}
