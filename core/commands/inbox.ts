// inbox command: file-based message delivery between orchestrator and agents.
//
// Replaces cmux send-key for agent messaging. The orchestrator writes messages
// to an inbox file; agents use `nw inbox --check` during active work and
// `nw inbox --wait` once they are idle.
//
// Usage:
//   nw inbox --wait <item-id>              Block until a message arrives
//   nw inbox --check <item-id>             Non-blocking check for all pending messages
//   nw inbox --status <item-id>            Inspect queue + wait metadata without consuming
//   nw inbox --peek <item-id>              Preview queued messages without consuming
//   nw inbox --write <item-id> -m <text>   Write a message to the inbox

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync, renameSync } from "fs";
import { dirname, join } from "path";
import { die } from "../output.ts";
import { resolveActiveWorkerNamespace, userStateDir } from "../daemon.ts";

// ── Types ────────────────────────────────────────────────────────────

export interface InboxIO {
  existsSync: (path: string) => boolean;
  mkdirSync: (path: string, opts?: { recursive?: boolean }) => void;
  readdirSync: (path: string) => string[];
  readFileSync: (path: string, encoding: BufferEncoding) => string;
  writeFileSync: (path: string, data: string, encoding?: BufferEncoding) => void;
  appendFileSync: (path: string, data: string, encoding?: BufferEncoding) => void;
  unlinkSync: (path: string) => void;
  renameSync: (oldPath: string, newPath: string) => void;
}

export interface InboxDeps {
  io: InboxIO;
  sleep: (ms: number) => void;
  getBranch: () => string | null;
}

export interface InboxWaitRuntime {
  writeStdout: (text: string) => void;
  writeStderr: (text: string) => void;
  exit: (code: number) => never;
  onSignal: (signal: NodeJS.Signals, handler: () => void) => void;
  removeSignalListener: (signal: NodeJS.Signals, handler: () => void) => void;
}

const defaultDeps: InboxDeps = {
  io: { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync, unlinkSync, renameSync },
  sleep: (ms) => Bun.sleepSync(ms),
  getBranch: () => {
    try {
      const result = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], { stdout: "pipe", stderr: "pipe" });
      return result.exitCode === 0 ? result.stdout.toString().trim() : null;
    } catch {
      return null;
    }
  },
};

const defaultWaitRuntime: InboxWaitRuntime = {
  writeStdout: (text) => {
    process.stdout.write(text);
  },
  writeStderr: (text) => {
    process.stderr.write(text);
  },
  exit: (code) => process.exit(code),
  onSignal: (signal, handler) => {
    process.on(signal, handler);
  },
  removeSignalListener: (signal, handler) => {
    process.removeListener(signal, handler);
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

export function inboxHistoryPath(projectRoot: string): string {
  return join(userStateDir(projectRoot), "inbox-history.jsonl");
}

export function inboxWaitDir(projectRoot: string): string {
  return join(userStateDir(projectRoot), "inbox-waits");
}

export function inboxWaitStatePath(projectRoot: string, itemId: string): string {
  return join(inboxWaitDir(projectRoot), `${itemId}.json`);
}

export type InboxHistoryAction = "write" | "deliver" | "drain" | "clean" | "wait-interrupted";

export interface InboxHistoryEntry {
  itemId: string;
  ts: string;
  action: InboxHistoryAction;
  namespaceProjectRoot: string;
  queuePath: string;
  preview?: string;
  previews?: string[];
  messageCount?: number;
  waitStartedAt?: string;
  waitInterruptedAt?: string;
}

export interface InboxWaitState {
  itemId: string;
  startedAt: string;
  pid: number;
  pollMs: number;
  namespaceProjectRoot: string;
  queuePath: string;
}

export interface PendingInboxMessage {
  filePath: string;
  preview: string;
}

export interface InboxInspection {
  itemId: string;
  requestedProjectRoot: string;
  namespaceProjectRoot: string;
  namespaceSource: "cwd" | "daemon-state";
  queuePath: string;
  pendingCount: number;
  pendingMessages: PendingInboxMessage[];
  waitState: InboxWaitState | null;
  recentHistory: InboxHistoryEntry[];
}

/** Lightweight inbox metadata snapshot for daemon state serialization. */
export interface InboxSnapshot {
  pendingCount: number;
  waitingSince: string | null;
  namespace: string;
  lastActivity: string | null;
}

// ── Core operations ──────────────────────────────────────────────────

let inboxWriteSequence = 0;
const DEFAULT_PREVIEW_LIMIT = 5;
const DEFAULT_HISTORY_LIMIT = 10;
const PREVIEW_CHARS = 120;

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
 * Resolve the active worker namespace for inbox read operations.
 *
 * Workers invoke `nw inbox` from inside a git worktree, where
 * `git rev-parse --git-common-dir` returns the main repo's `.git` dir -- so
 * `getProjectRoot()` hands us the hub path, not the worktree path. The
 * orchestrator, however, delivers messages to the *worktree* namespace
 * (via `resolveImplementerInboxTarget` in orchestrator-actions.ts). Without
 * this resolver, read-path functions (checkInbox/waitForInbox) would poll
 * the hub directory while messages accumulate in the worktree directory --
 * a silent hang.
 *
 * This matches what inspectInbox and snapshotInboxState already do, so the
 * TUI's pending count, `nw inbox --status`, and the worker's read loop all
 * converge on the same queue directory.
 *
 * Race-window fallback: between `executeLaunch` setting `item.worktreePath`
 * and the next engine snapshot persisting the daemon state file, a freshly
 * spawned worker's first `nw inbox --check` could resolve daemon state
 * without a worktreePath and fall back to the hub (empty). We catch that by
 * checking whether the process cwd is this item's own worktree -- the mux
 * always launches workers with cwd set to the worktree -- and using it as
 * the resolved namespace when daemon state isn't yet populated.
 */
function resolveInboxRoot(
  projectRoot: string,
  itemId: string,
  io: InboxIO,
): string {
  const resolution = resolveActiveWorkerNamespace(projectRoot, itemId, io);
  if (resolution.source === "daemon-state") {
    return resolution.activeProjectRoot;
  }
  try {
    const cwd = process.cwd();
    if (cwd !== projectRoot) {
      const basename = cwd.split("/").pop() ?? "";
      if (basename === `ninthwave-${itemId}` && io.existsSync(cwd)) {
        return cwd;
      }
    }
  } catch {
    // process.cwd() can throw if the directory was deleted; fall through.
  }
  return resolution.activeProjectRoot;
}

function ensureParentDir(filePath: string, io: InboxIO): void {
  const dir = dirname(filePath);
  if (!io.existsSync(dir)) {
    io.mkdirSync(dir, { recursive: true });
  }
}

function previewMessage(message: string): string {
  const flattened = message.replace(/\s+/g, " ").trim();
  if (flattened.length <= PREVIEW_CHARS) return flattened;
  return `${flattened.slice(0, PREVIEW_CHARS - 1)}…`;
}

export function appendInboxHistoryEntry(
  projectRoot: string,
  entry: InboxHistoryEntry,
  io: InboxIO = defaultDeps.io,
): void {
  const filePath = inboxHistoryPath(projectRoot);
  ensureParentDir(filePath, io);
  io.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, "utf-8");
}

export function readInboxHistory(
  projectRoot: string,
  itemId: string,
  limit: number = DEFAULT_HISTORY_LIMIT,
  io: InboxIO = defaultDeps.io,
): InboxHistoryEntry[] {
  const filePath = inboxHistoryPath(projectRoot);
  if (!io.existsSync(filePath)) return [];
  try {
    const content = io.readFileSync(filePath, "utf-8");
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as InboxHistoryEntry];
        } catch {
          return [];
        }
      })
      .filter((entry) => entry.itemId === itemId)
      .slice(-limit)
      .reverse();
  } catch {
    return [];
  }
}

export function writeInboxWaitState(
  projectRoot: string,
  itemId: string,
  waitState: InboxWaitState,
  io: InboxIO = defaultDeps.io,
): void {
  const filePath = inboxWaitStatePath(projectRoot, itemId);
  ensureParentDir(filePath, io);
  io.writeFileSync(filePath, JSON.stringify(waitState, null, 2), "utf-8");
}

export function readInboxWaitState(
  projectRoot: string,
  itemId: string,
  io: InboxIO = defaultDeps.io,
): InboxWaitState | null {
  const filePath = inboxWaitStatePath(projectRoot, itemId);
  if (!io.existsSync(filePath)) return null;
  try {
    return JSON.parse(io.readFileSync(filePath, "utf-8")) as InboxWaitState;
  } catch {
    return null;
  }
}

export function clearInboxWaitState(
  projectRoot: string,
  itemId: string,
  io: InboxIO = defaultDeps.io,
): void {
  const filePath = inboxWaitStatePath(projectRoot, itemId);
  if (!io.existsSync(filePath)) return;
  try {
    io.unlinkSync(filePath);
  } catch {
    // Best-effort cleanup
  }
}

function readQueuedMessages(
  projectRoot: string,
  itemId: string,
  io: InboxIO,
): Array<{ filePath: string; content: string; preview: string }> {
  return listInboxFiles(projectRoot, itemId, io)
    .flatMap((filePath) => {
      try {
        const content = io.readFileSync(filePath, "utf-8");
        return [{ filePath, content, preview: previewMessage(content) }];
      } catch {
        return [];
      }
    });
}

export function peekInbox(
  projectRoot: string,
  itemId: string,
  io: InboxIO = defaultDeps.io,
): string[] {
  return readQueuedMessages(projectRoot, itemId, io).map((message) => message.content);
}

export function inspectInbox(
  projectRoot: string,
  itemId: string,
  io: InboxIO = defaultDeps.io,
): InboxInspection {
  const namespace = resolveActiveWorkerNamespace(projectRoot, itemId, io);
  const pendingMessages = readQueuedMessages(namespace.activeProjectRoot, itemId, io)
    .slice(0, DEFAULT_PREVIEW_LIMIT)
    .map((message) => ({ filePath: message.filePath, preview: message.preview }));

  return {
    itemId,
    requestedProjectRoot: projectRoot,
    namespaceProjectRoot: namespace.activeProjectRoot,
    namespaceSource: namespace.source,
    queuePath: itemInboxDir(namespace.activeProjectRoot, itemId),
    pendingCount: listInboxFiles(namespace.activeProjectRoot, itemId, io).length,
    pendingMessages,
    waitState: readInboxWaitState(namespace.activeProjectRoot, itemId, io),
    recentHistory: readInboxHistory(namespace.activeProjectRoot, itemId, DEFAULT_HISTORY_LIMIT, io),
  };
}

/**
 * Lightweight inbox snapshot for daemon state serialization.
 * Cheaper than inspectInbox: skips message previews and limits history to 1 entry.
 */
export function snapshotInboxState(
  projectRoot: string,
  itemId: string,
  io: InboxIO = defaultDeps.io,
): InboxSnapshot {
  const namespace = resolveActiveWorkerNamespace(projectRoot, itemId, io);
  const ns = namespace.activeProjectRoot;
  const pendingCount = listInboxFiles(ns, itemId, io).length;
  const waitState = readInboxWaitState(ns, itemId, io);
  const history = readInboxHistory(ns, itemId, 1, io);
  return {
    pendingCount,
    waitingSince: waitState?.startedAt ?? null,
    namespace: ns,
    lastActivity: history[0]?.ts ?? null,
  };
}

function renderPeek(inspection: InboxInspection): string {
  const lines = [
    `Item: ${inspection.itemId}`,
    `Namespace: ${inspection.namespaceProjectRoot}`,
    `Queue: ${inspection.queuePath}`,
    `Pending: ${inspection.pendingCount}`,
  ];

  if (inspection.pendingMessages.length === 0) {
    lines.push("Pending previews: (none)");
  } else {
    lines.push("Pending previews:");
    for (const [index, message] of inspection.pendingMessages.entries()) {
      lines.push(`  ${index + 1}. ${message.preview}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function formatHistoryEntry(entry: InboxHistoryEntry): string {
  if (entry.action === "write" || entry.action === "deliver") {
    return `${entry.ts} ${entry.action}: ${entry.preview ?? "(no preview)"}`;
  }
  if (entry.action === "wait-interrupted") {
    return `${entry.ts} wait-interrupted: started ${entry.waitStartedAt ?? "unknown"}`;
  }
  const count = entry.messageCount ?? 0;
  const previews = entry.previews?.length ? ` -- ${entry.previews.join(" | ")}` : "";
  return `${entry.ts} ${entry.action}: ${count} message${count === 1 ? "" : "s"}${previews}`;
}

function renderStatus(inspection: InboxInspection): string {
  const lines = [
    `Item: ${inspection.itemId}`,
    `Requested namespace: ${inspection.requestedProjectRoot}`,
    `Active namespace: ${inspection.namespaceProjectRoot}`,
    `Namespace source: ${inspection.namespaceSource}`,
    `Queue: ${inspection.queuePath}`,
    `Pending: ${inspection.pendingCount}`,
  ];

  if (inspection.pendingMessages.length === 0) {
    lines.push("Pending previews: (none)");
  } else {
    lines.push("Pending previews:");
    for (const [index, message] of inspection.pendingMessages.entries()) {
      lines.push(`  ${index + 1}. ${message.preview}`);
    }
  }

  if (inspection.waitState) {
    lines.push("Wait state:");
    lines.push(`  started: ${inspection.waitState.startedAt}`);
    lines.push(`  pid: ${inspection.waitState.pid}`);
    lines.push(`  pollMs: ${inspection.waitState.pollMs}`);
  } else {
    lines.push("Wait state: idle");
  }

  if (inspection.recentHistory.length === 0) {
    lines.push("Recent history: (none)");
  } else {
    lines.push("Recent history:");
    for (const entry of inspection.recentHistory) {
      lines.push(`  - ${formatHistoryEntry(entry)}`);
    }
  }

  return `${lines.join("\n")}\n`;
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
  appendInboxHistoryEntry(projectRoot, {
    itemId,
    ts: new Date().toISOString(),
    action: "write",
    namespaceProjectRoot: projectRoot,
    queuePath: dir,
    preview: previewMessage(message),
  }, io);
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
  const ns = resolveInboxRoot(projectRoot, itemId, io);
  const filePath = listInboxFiles(ns, itemId, io)[0];
  if (!filePath) return null;
  try {
    const content = io.readFileSync(filePath, "utf-8");
    io.unlinkSync(filePath);
    appendInboxHistoryEntry(ns, {
      itemId,
      ts: new Date().toISOString(),
      action: "deliver",
      namespaceProjectRoot: ns,
      queuePath: itemInboxDir(ns, itemId),
      preview: previewMessage(content),
    }, io);
    return content;
  } catch {
    return null;
  }
}

/**
 * Drain all currently pending messages without blocking.
 * Returns messages in queue order and removes only the consumed files.
 */
export function drainInbox(
  projectRoot: string,
  itemId: string,
  io: InboxIO = defaultDeps.io,
): string[] {
  const messages: string[] = [];
  while (true) {
    const message = checkInbox(projectRoot, itemId, io);
    if (message === null) break;
    messages.push(message);
  }
  const ns = resolveInboxRoot(projectRoot, itemId, io);
  appendInboxHistoryEntry(ns, {
    itemId,
    ts: new Date().toISOString(),
    action: "drain",
    namespaceProjectRoot: ns,
    queuePath: itemInboxDir(ns, itemId),
    messageCount: messages.length,
    previews: messages.slice(0, DEFAULT_PREVIEW_LIMIT).map((message) => previewMessage(message)),
  }, io);
  return messages;
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

export function runInboxWait(
  projectRoot: string,
  itemId: string,
  deps: Pick<InboxDeps, "io" | "sleep"> = defaultDeps,
  runtime: InboxWaitRuntime = defaultWaitRuntime,
): void {
  let delivered = false;
  let cleanedUp = false;
  const waitStartedAt = new Date().toISOString();
  // Resolve once at entry so the wait-state file lives next to the queue the
  // worker will actually watch. waitForInbox re-resolves on each poll, so the
  // read path is unaffected if daemon state updates mid-wait -- but the wait
  // state file is left at its initial path to keep cleanup deterministic.
  const waitNs = resolveInboxRoot(projectRoot, itemId, deps.io);
  const waitState: InboxWaitState = {
    itemId,
    startedAt: waitStartedAt,
    pid: process.pid,
    pollMs: 1000,
    namespaceProjectRoot: waitNs,
    queuePath: itemInboxDir(waitNs, itemId),
  };
  writeInboxWaitState(waitNs, itemId, waitState, deps.io);
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearInboxWaitState(waitNs, itemId, deps.io);
    runtime.removeSignalListener("SIGINT", onInterrupt);
    runtime.removeSignalListener("SIGTERM", onInterrupt);
  };
  const onInterrupt = () => {
    if (delivered) return;
    appendInboxHistoryEntry(waitNs, {
      itemId,
      ts: new Date().toISOString(),
      action: "wait-interrupted",
      namespaceProjectRoot: waitNs,
      queuePath: itemInboxDir(waitNs, itemId),
      waitStartedAt,
      waitInterruptedAt: new Date().toISOString(),
    }, deps.io);
    cleanup();
    runtime.writeStderr(
      `Inbox wait interrupted before delivery; rerun 'nw inbox --wait ${itemId}' with a very long timeout.\n`,
    );
    runtime.exit(1);
  };

  runtime.onSignal("SIGINT", onInterrupt);
  runtime.onSignal("SIGTERM", onInterrupt);

  try {
    const message = waitForInbox(projectRoot, itemId, deps);
    delivered = true;
    runtime.writeStdout(message);
  } finally {
    cleanup();
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
  const removedMessages: string[] = [];
  for (const filePath of listInboxFiles(projectRoot, itemId, io)) {
    try {
      removedMessages.push(io.readFileSync(filePath, "utf-8"));
      io.unlinkSync(filePath);
    } catch {
      // Best-effort cleanup
    }
  }
  clearInboxWaitState(projectRoot, itemId, io);
  appendInboxHistoryEntry(projectRoot, {
    itemId,
    ts: new Date().toISOString(),
    action: "clean",
    namespaceProjectRoot: projectRoot,
    queuePath: itemInboxDir(projectRoot, itemId),
    messageCount: removedMessages.length,
    previews: removedMessages.slice(0, DEFAULT_PREVIEW_LIMIT).map((message) => previewMessage(message)),
  }, io);
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
  runtime: InboxWaitRuntime = defaultWaitRuntime,
): void {
  const isWait = args.includes("--wait");
  const isCheck = args.includes("--check");
  const isStatus = args.includes("--status");
  const isPeek = args.includes("--peek");
  const isWrite = args.includes("--write");

  if (!isWait && !isCheck && !isStatus && !isPeek && !isWrite) {
    die("Usage: nw inbox --wait <id> | --check <id> | --status <id> | --peek <id> | --write <id> -m <text>");
    return;
  }

  // Determine item ID: positional arg after the flag, or auto-detect from branch
  let itemId: string | undefined;
  for (const flag of ["--wait", "--check", "--status", "--peek", "--write"]) {
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
    const messages = drainInbox(projectRoot, itemId, deps.io);
    if (messages.length > 0) {
      process.stdout.write(messages.join("\n\n"));
    }
    return;
  }

  if (isStatus) {
    process.stdout.write(renderStatus(inspectInbox(projectRoot, itemId, deps.io)));
    return;
  }

  if (isPeek) {
    process.stdout.write(renderPeek(inspectInbox(projectRoot, itemId, deps.io)));
    return;
  }

  if (isWait) {
    // Blocking wait -- intended for workers that are idle or done
    runInboxWait(projectRoot, itemId, deps, runtime);
    return;
  }
}
