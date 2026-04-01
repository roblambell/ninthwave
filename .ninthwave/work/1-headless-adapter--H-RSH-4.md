# Feat: Create HeadlessAdapter for multiplexer-free operation (H-RSH-4)

**Priority:** High
**Source:** Plan: Remove Send-Keys & Add Headless Adapter (eng-reviewed 2026-04-01)
**Depends on:** H-RSH-1
**Domain:** headless-adapter

Create core/headless.ts implementing the Multiplexer interface for environments without tmux or cmux. Workers are spawned as detached background processes via child_process.spawn with stdio redirected to per-worker log files. PID files track process lifecycle. Follow the pattern from core/daemon.ts forkDaemon.

launchWorkspace: create log dir (~/.ninthwave/projects/{slug}/logs/) and PID dir (~/.ninthwave/projects/{slug}/workers/), spawn("sh", ["-c", command], { cwd, detached: true, stdio: ["ignore", logFd, logFd] }), child.unref(), write PID file, return todoId as ref.

readScreen: read tail of the log file for the given ref. Return "" if log does not exist.

listWorkspaces: scan PID dir, check each PID alive via process.kill(pid, 0), clean stale PID files, return live workspace info.

closeWorkspace: read PID, send SIGTERM, wait 5s grace, SIGKILL if still alive, clean PID file.

splitPane/setStatus/setProgress: return false (no-op).

Use dependency injection for spawn, fs ops, and process.kill to keep tests fast and deterministic.

**Test plan:**
- Test launchWorkspace: verify spawn called with correct args, PID file written, ref returned
- Test launchWorkspace failure: spawn error returns null
- Test readScreen: reads last N lines of log file, returns "" for missing log
- Test listWorkspaces: returns alive PIDs, cleans stale ones
- Test closeWorkspace: SIGTERM sent, PID file cleaned
- Test closeWorkspace on already-exited process: cleans PID, returns true
- Test no-op methods return false

Acceptance: HeadlessAdapter implements all Multiplexer methods. Dependency-injected for testability. All tests pass. PID/log paths use userStateDir convention from existing code.

Key files: `core/headless.ts` (new), `test/headless.test.ts` (new)
