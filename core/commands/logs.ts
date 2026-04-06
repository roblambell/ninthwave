// `nw logs` -- view orchestration log entries.
//
// Reads JSONL log files from ~/.ninthwave/projects/{slug}/orchestrator.log
// and pretty-prints them with color. Supports filtering by item ID, level,
// and line count, plus --follow mode for tailing.

import { existsSync, readFileSync, statSync, openSync, readSync, closeSync } from "fs";
import { RED, YELLOW, BLUE, CYAN, DIM, BOLD, RESET, GREEN } from "../output.ts";
import { userStateDir } from "../daemon.ts";
import type { LogEntry } from "./orchestrate.ts";

// ── Types ──────────────────────────────────────────────────────────

export interface LogsOptions {
  follow: boolean;
  item: string | null;
  level: "info" | "warn" | "error" | null;
  lines: number;
}

// ── Filesystem abstraction (for testing) ────────────────────────────

export interface LogsIO {
  existsSync: typeof existsSync;
  readFileSync: typeof readFileSync;
  statSync: typeof statSync;
}

const defaultIO: LogsIO = { existsSync, readFileSync, statSync };

// ── Parsing ─────────────────────────────────────────────────────────

/** Parse a single JSONL line. Returns null if malformed. */
export function parseLogLine(line: string): LogEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const entry = JSON.parse(trimmed);
    // Must have at least ts, level, event
    if (
      typeof entry.ts === "string" &&
      typeof entry.level === "string" &&
      typeof entry.event === "string"
    ) {
      return entry as LogEntry;
    }
    return null;
  } catch {
    return null;
  }
}

/** Parse all lines from a JSONL string. Skips malformed lines. */
export function parseLogLines(content: string): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const line of content.split("\n")) {
    const entry = parseLogLine(line);
    if (entry) entries.push(entry);
  }
  return entries;
}

// ── Filtering ───────────────────────────────────────────────────────

const LEVEL_SEVERITY: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** Filter entries by minimum level. */
export function filterByLevel(
  entries: LogEntry[],
  minLevel: "info" | "warn" | "error",
): LogEntry[] {
  const minSev = LEVEL_SEVERITY[minLevel] ?? 0;
  return entries.filter((e) => (LEVEL_SEVERITY[e.level] ?? 0) >= minSev);
}

/** Filter entries that contain the given item ID in any field value. */
export function filterByItem(entries: LogEntry[], itemId: string): LogEntry[] {
  return entries.filter((entry) => {
    // Check all string values in the entry
    for (const value of Object.values(entry)) {
      if (typeof value === "string" && value.includes(itemId)) return true;
      // Check arrays of strings (e.g., "items" field)
      if (Array.isArray(value) && value.some((v) => typeof v === "string" && v.includes(itemId))) {
        return true;
      }
    }
    return false;
  });
}

// ── Formatting ──────────────────────────────────────────────────────

/** Colorize a log level tag. */
function colorLevel(level: string): string {
  switch (level) {
    case "error":
      return `${RED}ERR${RESET}`;
    case "warn":
      return `${YELLOW}WRN${RESET}`;
    case "info":
      return `${GREEN}INF${RESET}`;
    case "debug":
      return `${DIM}DBG${RESET}`;
    default:
      return level.toUpperCase().slice(0, 3);
  }
}

/** Format a timestamp for display (HH:MM:SS). */
function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return `${DIM}${d.toLocaleTimeString("en-US", { hour12: false })}${RESET}`;
  } catch {
    return ts;
  }
}

/** Format contextual fields (everything except ts, level, event). */
function formatContext(entry: LogEntry): string {
  const skip = new Set(["ts", "level", "event"]);
  const parts: string[] = [];

  for (const [key, value] of Object.entries(entry)) {
    if (skip.has(key)) continue;
    if (value === undefined || value === null) continue;

    if (typeof value === "string") {
      parts.push(`${DIM}${key}=${RESET}${value}`);
    } else if (typeof value === "number" || typeof value === "boolean") {
      parts.push(`${DIM}${key}=${RESET}${CYAN}${value}${RESET}`);
    } else if (Array.isArray(value)) {
      const items = value.map((v) => typeof v === "string" || typeof v === "number" ? String(v) : JSON.stringify(v));
      parts.push(`${DIM}${key}=${RESET}[${items.join(",")}]`);
    } else {
      parts.push(`${DIM}${key}=${RESET}${JSON.stringify(value)}`);
    }
  }

  return parts.join(" ");
}

/** Pretty-print a single log entry. Returns the formatted line. */
export function formatLogEntry(entry: LogEntry): string {
  const time = formatTime(entry.ts);
  const level = colorLevel(entry.level);
  const event = `${BOLD}${entry.event}${RESET}`;
  const context = formatContext(entry);

  return context
    ? `${time} ${level} ${event} ${context}`
    : `${time} ${level} ${event}`;
}

// ── Follow mode ─────────────────────────────────────────────────────

/**
 * Tail a log file, printing new entries as they appear.
 * Uses polling (~500ms) to detect new content.
 * Returns a cleanup function for testing.
 */
export function followLog(
  logPath: string,
  options: LogsOptions,
  io: LogsIO = defaultIO,
  output: (line: string) => void = console.log,
): () => void {
  let lastSize = 0;
  try {
    lastSize = io.statSync(logPath).size;
  } catch {
    // File might not exist yet
  }

  // Print existing entries first (last N lines)
  if (io.existsSync(logPath)) {
    const content = io.readFileSync(logPath, "utf-8");
    let entries = parseLogLines(content);
    if (options.item) entries = filterByItem(entries, options.item);
    if (options.level) entries = filterByLevel(entries, options.level);

    const tail = entries.slice(-options.lines);
    for (const entry of tail) {
      output(formatLogEntry(entry));
    }
    lastSize = io.statSync(logPath).size;
  }

  const interval = setInterval(() => {
    try {
      if (!io.existsSync(logPath)) return;

      const currentSize = io.statSync(logPath).size;
      if (currentSize <= lastSize) {
        // File might have been truncated/rotated
        if (currentSize < lastSize) lastSize = 0;
        else return;
      }

      // Read the new bytes
      const content = io.readFileSync(logPath, "utf-8");
      // We need to re-read because readFileSync reads the whole file
      // Split and process only lines we haven't seen
      const allLines = content.split("\n");

      // Count bytes to find where new content starts
      let byteCount = 0;
      const newEntries: LogEntry[] = [];
      for (const line of allLines) {
        const lineBytes = Buffer.byteLength(line + "\n", "utf-8");
        if (byteCount >= lastSize) {
          const entry = parseLogLine(line);
          if (entry) newEntries.push(entry);
        }
        byteCount += lineBytes;
      }

      lastSize = currentSize;

      let filtered = newEntries;
      if (options.item) filtered = filterByItem(filtered, options.item);
      if (options.level) filtered = filterByLevel(filtered, options.level);

      for (const entry of filtered) {
        output(formatLogEntry(entry));
      }
    } catch {
      // Best-effort -- file might be temporarily unavailable
    }
  }, 500);

  return () => clearInterval(interval); // lint-ignore: no-uncleared-interval
}

// ── Main command ────────────────────────────────────────────────────

/** Parse CLI args into LogsOptions. */
export function parseLogsArgs(args: string[]): LogsOptions {
  let follow = false;
  let item: string | null = null;
  let level: "info" | "warn" | "error" | null = null;
  let lines = 50;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    switch (arg) {
      case "--follow":
      case "-f":
        follow = true;
        break;
      case "--item": {
        const val = args[++i];
        if (val) item = val;
        break;
      }
      case "--level": {
        const val = args[++i];
        if (val === "warn" || val === "error") level = val;
        break;
      }
      case "--lines":
      case "-n": {
        const val = args[++i];
        if (val) {
          const n = parseInt(val, 10);
          if (!isNaN(n) && n > 0) lines = n;
        }
        break;
      }
    }
  }

  return { follow, item, level, lines };
}

/**
 * Resolve the log file path for the current project.
 * Exported for testing.
 */
export function resolveLogPath(projectRoot: string): string {
  const stateDir = userStateDir(projectRoot);
  return `${stateDir}/orchestrator.log`;
}

/**
 * Collect entries from the current log file and rotated files (.1, .2, .3, ...).
 * Reads rotated files from oldest to newest so entries stay in chronological order.
 * Only reads as many rotated files as needed to satisfy `options.lines`.
 */
export function readEntriesWithRotated(
  logPath: string,
  options: LogsOptions,
  io: LogsIO = defaultIO,
): LogEntry[] {
  // Gather all available log files: current + rotated (.1, .2, .3, ...)
  const files: string[] = [];
  if (io.existsSync(logPath)) files.push(logPath);

  // Discover rotated files
  for (let n = 1; ; n++) {
    const rotated = `${logPath}.${n}`;
    if (!io.existsSync(rotated)) break;
    files.push(rotated);
  }

  if (files.length === 0) return [];

  // Read from newest rotated → current (reversed to build from oldest first)
  // files[0] = current, files[1] = .1 (most recent rotation), files[2] = .2, etc.
  // We want chronological order: oldest first, so reverse the list
  const orderedFiles = files.slice().reverse();

  let entries: LogEntry[] = [];
  for (const file of orderedFiles) {
    const content = io.readFileSync(file, "utf-8");
    const fileEntries = parseLogLines(content);
    entries = entries.concat(fileEntries);
  }

  if (options.item) entries = filterByItem(entries, options.item);
  if (options.level) entries = filterByLevel(entries, options.level);

  return entries;
}

/**
 * Read and display log entries (non-follow mode).
 * Searches rotated files when --lines requests more entries than the current file contains.
 * Returns the formatted output lines for testing.
 */
export function readLogs(
  logPath: string,
  options: LogsOptions,
  io: LogsIO = defaultIO,
): string[] {
  if (!io.existsSync(logPath)) {
    // Check if any rotated files exist
    const hasRotated = io.existsSync(`${logPath}.1`);
    if (!hasRotated) {
      return ["No orchestration logs found. Run `nw` to generate logs."];
    }
  }

  const entries = readEntriesWithRotated(logPath, options, io);

  // Take last N entries
  const tail = entries.slice(-options.lines);

  if (tail.length === 0) {
    return ["No matching log entries found."];
  }

  return tail.map(formatLogEntry);
}

/** CLI handler for `nw logs`. */
export async function cmdLogs(args: string[], projectRoot: string): Promise<void> {
  const options = parseLogsArgs(args);
  const logPath = resolveLogPath(projectRoot);

  if (options.follow) {
    // Follow mode -- print and tail
    const cleanup = followLog(logPath, options);

    // Handle graceful shutdown
    const handler = () => {
      cleanup();
      process.exit(0);
    };
    process.on("SIGINT", handler);
    process.on("SIGTERM", handler);

    // Keep the process alive
    await new Promise(() => {});
  } else {
    // One-shot mode
    const lines = readLogs(logPath, options);
    for (const line of lines) {
      console.log(line);
    }
  }
}
