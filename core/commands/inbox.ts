// inbox command: file-based message delivery between orchestrator and agents.
//
// Replaces cmux send-key for agent messaging. The orchestrator writes messages
// to an inbox file; agents run `nw inbox --wait` as a background process to
// receive them.
//
// Usage:
//   nw inbox --wait <item-id>              Block until a message arrives
//   nw inbox --check <item-id>             Non-blocking check for message
//   nw inbox --write <item-id> -m <text>   Write a message to the inbox

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync, renameSync } from "fs";
import { join } from "path";
import { die } from "../output.ts";
import { userStateDir } from "../daemon.ts";

// ── Types ────────────────────────────────────────────────────────────

export interface InboxIO {
  existsSync: (path: string) => boolean;
  mkdirSync: (path: string, opts?: { recursive?: boolean }) => void;
  readdirSync: (path: string) => string[];
  readFileSync: (path: string, encoding: BufferEncoding) => string;
  writeFileSync: (path: string, data: string) => void;
  unlinkSync: (path: string) => void;
  renameSync: (oldPath: string, newPath: string) => void;
}

export interface InboxDeps {
  io: InboxIO;
  sleep: (ms: number) => void;
  getBranch: () => string | null;
}

const defaultDeps: InboxDeps = {
  io: { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, renameSync },
  sleep: (ms) => Bun.sleepSync(ms),
  getBranch: () => {
    try {
      const result = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"]);
      return result.exitCode === 0 ? result.stdout.toString().trim() : null;
    } catch {
      return null;
    }
  },
};

// ── Paths ────────────────────────────────────────────────────────────

/** Directory for inbox files: ~/.ninthwave/projects/{slug}/inbox/ */
export function inboxDir(projectRoot: string): string {
  return join(userStateDir(projectRoot), "inbox");
}

/** Directory for a single item's pending messages. */
export function itemInboxDir(projectRoot: string, itemId: string): string {
  return join(inboxDir(projectRoot), itemId);
}

// ── Core operations ──────────────────────────────────────────────────

let inboxWriteSequence = 0;

function nextInboxFileName(): string {
  const now = String(Date.now()).padStart(13, "0");
  const seq = String(inboxWriteSequence++).padStart(6, "0");
  return `${now}-${seq}.msg`;
}

function listInboxFiles(
  projectRoot: string,
  itemId: string,
  io: InboxIO,
): string[] {
  const dir = itemInboxDir(projectRoot, itemId);
  if (!io.existsSync(dir)) return [];
  try {
    return io.readdirSync(dir)
      .filter((name) => name.endsWith(".msg"))
      .sort()
      .map((name) => join(dir, name));
  } catch {
    return [];
  }
}

/**
 * Queue a message atomically (temp file + rename) under the item's inbox directory.
 */
export function writeInbox(
  projectRoot: string,
  itemId: string,
  message: string,
  io: InboxIO = defaultDeps.io,
): void {
  const dir = itemInboxDir(projectRoot, itemId);
  if (!io.existsSync(dir)) {
    io.mkdirSync(dir, { recursive: true });
  }
  const filePath = join(dir, nextInboxFileName());
  const tmpPath = `${filePath}.tmp.${Date.now()}`;
  io.writeFileSync(tmpPath, message);
  io.renameSync(tmpPath, filePath);
}

/**
 * Check for the oldest pending message without blocking.
 * Returns the message or null. Removes only the consumed message file.
 */
export function checkInbox(
  projectRoot: string,
  itemId: string,
  io: InboxIO = defaultDeps.io,
): string | null {
  const filePath = listInboxFiles(projectRoot, itemId, io)[0];
  if (!filePath) return null;
  try {
    const content = io.readFileSync(filePath, "utf-8");
    io.unlinkSync(filePath);
    return content;
  } catch {
    return null;
  }
}

/**
 * Block until a message arrives. Polls every `pollMs` milliseconds.
 * Returns the oldest pending message and removes only that file.
 */
export function waitForInbox(
  projectRoot: string,
  itemId: string,
  deps: Pick<InboxDeps, "io" | "sleep"> = defaultDeps,
  pollMs: number = 1000,
): string {
  while (true) {
    const message = checkInbox(projectRoot, itemId, deps.io);
    if (message !== null) {
      return message;
    }
    deps.sleep(pollMs);
  }
}

/**
 * Remove all pending inbox files for an item. Used during worker cleanup.
 */
export function cleanInbox(
  projectRoot: string,
  itemId: string,
  io: InboxIO = defaultDeps.io,
): void {
  for (const filePath of listInboxFiles(projectRoot, itemId, io)) {
    try {
      io.unlinkSync(filePath);
    } catch {
      // Best-effort cleanup
    }
  }
}

// ── Branch → item ID extraction ──────────────────────────────────────

function extractItemId(branch: string): string | null {
  const match = branch.match(/^ninthwave\/(.+)$/);
  return match ? match[1]! : null;
}

// ── CLI entry point ──────────────────────────────────────────────────

export function cmdInbox(
  args: string[],
  projectRoot: string,
  deps: InboxDeps = defaultDeps,
): void {
  const isWait = args.includes("--wait");
  const isCheck = args.includes("--check");
  const isWrite = args.includes("--write");

  if (!isWait && !isCheck && !isWrite) {
    die("Usage: nw inbox --wait <id> | --check <id> | --write <id> -m <text>");
    return;
  }

  // Determine item ID: positional arg after the flag, or auto-detect from branch
  let itemId: string | undefined;
  for (const flag of ["--wait", "--check", "--write"]) {
    const idx = args.indexOf(flag);
    if (idx !== -1 && idx + 1 < args.length && !args[idx + 1]!.startsWith("-")) {
      itemId = args[idx + 1]!;
      break;
    }
  }

  if (!itemId) {
    // Auto-detect from git branch
    const branch = deps.getBranch();
    if (branch) {
      itemId = extractItemId(branch) ?? undefined;
    }
    if (!itemId) {
      die("Could not determine item ID. Provide it as an argument or run from an item branch.");
      return;
    }
  }

  if (isWrite) {
    const msgIdx = args.indexOf("-m");
    const msgIdx2 = args.indexOf("--message");
    const mi = msgIdx !== -1 ? msgIdx : msgIdx2;
    if (mi === -1 || mi + 1 >= args.length) {
      die("Usage: nw inbox --write <id> -m <text>");
      return;
    }
    const message = args[mi + 1]!;
    writeInbox(projectRoot, itemId, message, deps.io);
    console.log(`Inbox: wrote message for ${itemId}`);
    return;
  }

  if (isCheck) {
    const message = checkInbox(projectRoot, itemId, deps.io);
    if (message) {
      process.stdout.write(message);
    }
    return;
  }

  if (isWait) {
    // Blocking wait -- used by agents as a background process
    const message = waitForInbox(projectRoot, itemId, deps);
    process.stdout.write(message);
    return;
  }
}
