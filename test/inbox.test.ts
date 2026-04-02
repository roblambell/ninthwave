import { describe, it, expect } from "vitest";
import {
  writeInbox,
  checkInbox,
  drainInbox,
  waitForInbox,
  cleanInbox,
  peekInbox,
  itemInboxDir,
  inboxWaitStatePath,
  cmdInbox,
  inspectInbox,
  readInboxHistory,
  readInboxWaitState,
  type InboxIO,
  type InboxDeps,
  type InboxWaitRuntime,
} from "../core/commands/inbox.ts";
import { captureOutput } from "./helpers.ts";
// ── In-memory IO for fast unit tests ─────────────────────────────────

function makeMemIO() {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const io: InboxIO = {
    existsSync: (p) => files.has(p) || dirs.has(p),
    mkdirSync: (p) => { dirs.add(p); },
    readdirSync: (p) => {
      const prefix = `${p}/`;
      return [...files.keys()]
        .filter((file) => file.startsWith(prefix) && !file.slice(prefix.length).includes("/"))
        .map((file) => file.slice(prefix.length));
    },
    readFileSync: (p) => {
      const content = files.get(p);
      if (content === undefined) throw new Error(`ENOENT: ${p}`);
      return content;
    },
    writeFileSync: (p, data) => { files.set(p, data); },
    appendFileSync: (p, data) => { files.set(p, `${files.get(p) ?? ""}${data}`); },
    unlinkSync: (p) => { files.delete(p); },
    renameSync: (old, nw) => {
      const content = files.get(old);
      if (content === undefined) throw new Error(`ENOENT: ${old}`);
      files.delete(old);
      files.set(nw, content);
    },
  };
  return { io, files, dirs };
}

function makeWaitRuntime() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const handlers = new Map<NodeJS.Signals, () => void>();
  let exitCode: number | null = null;

  const runtime: InboxWaitRuntime = {
    writeStdout: (text) => {
      stdout.push(text);
    },
    writeStderr: (text) => {
      stderr.push(text);
    },
    exit: (code) => {
      exitCode = code;
      throw new Error(`EXIT:${code}`);
    },
    onSignal: (signal, handler) => {
      handlers.set(signal, handler);
    },
    removeSignalListener: (signal, handler) => {
      if (handlers.get(signal) === handler) {
        handlers.delete(signal);
      }
    },
  };

  return { runtime, stdout, stderr, handlers, getExitCode: () => exitCode };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("inbox", () => {
  describe("writeInbox", () => {
    it("writes a message atomically", () => {
      const { io, files } = makeMemIO();
      writeInbox("/fake/project", "H-FOO-1", "Fix CI failure", io);
      const prefix = `${itemInboxDir("/fake/project", "H-FOO-1")}/`;
      const queued = [...files.entries()].filter(([path]) => path.startsWith(prefix));
      expect(queued).toHaveLength(1);
      expect(queued[0]![1]).toBe("Fix CI failure");
    });

    it("creates inbox directory if missing", () => {
      const { io, dirs } = makeMemIO();
      writeInbox("/fake/project", "H-FOO-2", "msg", io);
      expect(dirs.has(itemInboxDir("/fake/project", "H-FOO-2"))).toBe(true);
    });

    it("queues back-to-back messages instead of overwriting", () => {
      const { io, files } = makeMemIO();
      writeInbox("/fake/project", "H-FOO-1", "first", io);
      writeInbox("/fake/project", "H-FOO-1", "second", io);
      const prefix = `${itemInboxDir("/fake/project", "H-FOO-1")}/`;
      const queued = [...files.entries()]
        .filter(([path]) => path.startsWith(prefix))
        .sort(([a], [b]) => a.localeCompare(b));
      expect(queued.map(([, content]) => content)).toEqual(["first", "second"]);
    });
  });

  describe("checkInbox", () => {
    it("returns null when no message exists", () => {
      const { io } = makeMemIO();
      expect(checkInbox("/fake/project", "H-FOO-1", io)).toBeNull();
    });

    it("returns message and removes file", () => {
      const { io, files } = makeMemIO();
      writeInbox("/fake/project", "H-FOO-1", "hello", io);
      const msg = checkInbox("/fake/project", "H-FOO-1", io);
      expect(msg).toBe("hello");
      const prefix = `${itemInboxDir("/fake/project", "H-FOO-1")}/`;
      expect([...files.keys()].filter((path) => path.startsWith(prefix))).toHaveLength(0);
    });

    it("returns queued messages in order", () => {
      const { io } = makeMemIO();
      writeInbox("/fake/project", "H-FOO-1", "first", io);
      writeInbox("/fake/project", "H-FOO-1", "second", io);
      expect(checkInbox("/fake/project", "H-FOO-1", io)).toBe("first");
      expect(checkInbox("/fake/project", "H-FOO-1", io)).toBe("second");
      expect(checkInbox("/fake/project", "H-FOO-1", io)).toBeNull();
    });
  });

  describe("drainInbox", () => {
    it("returns an empty list when no messages exist", () => {
      const { io } = makeMemIO();
      expect(drainInbox("/fake/project", "H-FOO-1", io)).toEqual([]);
    });

    it("returns all queued messages in order and clears them", () => {
      const { io, files } = makeMemIO();
      writeInbox("/fake/project", "H-FOO-1", "first", io);
      writeInbox("/fake/project", "H-FOO-1", "second", io);
      writeInbox("/fake/project", "H-FOO-1", "third", io);

      expect(drainInbox("/fake/project", "H-FOO-1", io)).toEqual([
        "first",
        "second",
        "third",
      ]);
      const prefix = `${itemInboxDir("/fake/project", "H-FOO-1")}/`;
      expect([...files.keys()].filter((path) => path.startsWith(prefix))).toHaveLength(0);
    });

    it("records a durable drain history entry", () => {
      const { io } = makeMemIO();
      writeInbox("/fake/project", "H-FOO-1", "first", io);
      writeInbox("/fake/project", "H-FOO-1", "second", io);

      drainInbox("/fake/project", "H-FOO-1", io);

      const history = readInboxHistory("/fake/project", "H-FOO-1", 10, io);
      expect(history.some((entry) => entry.action === "drain" && entry.messageCount === 2)).toBe(true);
    });
  });

  describe("waitForInbox", () => {
    it("returns immediately when message exists", () => {
      const { io } = makeMemIO();
      writeInbox("/fake/project", "H-FOO-1", "urgent", io);
      let sleepCount = 0;
      const deps = {
        io,
        sleep: () => { sleepCount++; },
      };
      const msg = waitForInbox("/fake/project", "H-FOO-1", deps, 10);
      expect(msg).toBe("urgent");
      expect(sleepCount).toBe(0);
    });

    it("polls until message arrives", () => {
      const { io } = makeMemIO();
      let sleepCount = 0;
      const deps = {
        io,
        sleep: () => {
          sleepCount++;
          if (sleepCount === 3) {
            writeInbox("/fake/project", "H-FOO-1", "arrived", io);
          }
        },
      };
      const msg = waitForInbox("/fake/project", "H-FOO-1", deps, 10);
      expect(msg).toBe("arrived");
      expect(sleepCount).toBe(3);
    });
  });

  describe("cleanInbox", () => {
    it("removes inbox file if exists", () => {
      const { io, files } = makeMemIO();
      writeInbox("/fake/project", "H-FOO-1", "msg", io);
      writeInbox("/fake/project", "H-FOO-1", "msg-2", io);
      cleanInbox("/fake/project", "H-FOO-1", io);
      const prefix = `${itemInboxDir("/fake/project", "H-FOO-1")}/`;
      expect([...files.keys()].filter((path) => path.startsWith(prefix))).toHaveLength(0);
    });

    it("no-ops when file does not exist", () => {
      const { io } = makeMemIO();
      // Should not throw
      cleanInbox("/fake/project", "H-FOO-1", io);
    });

    it("records a durable clean history entry", () => {
      const { io } = makeMemIO();
      writeInbox("/fake/project", "H-FOO-1", "msg", io);

      cleanInbox("/fake/project", "H-FOO-1", io);

      const history = readInboxHistory("/fake/project", "H-FOO-1", 10, io);
      expect(history.some((entry) => entry.action === "clean" && entry.messageCount === 1)).toBe(true);
    });
  });

  describe("inspection helpers", () => {
    it("peeks queued messages without consuming them", () => {
      const { io } = makeMemIO();
      writeInbox("/fake/project", "H-FOO-1", "first queued message", io);
      writeInbox("/fake/project", "H-FOO-1", "second queued message", io);

      expect(peekInbox("/fake/project", "H-FOO-1", io)).toEqual([
        "first queued message",
        "second queued message",
      ]);
      expect(checkInbox("/fake/project", "H-FOO-1", io)).toBe("first queued message");
      expect(checkInbox("/fake/project", "H-FOO-1", io)).toBe("second queued message");
    });

    it("inspects pending count, queue location, wait metadata, and recent history", () => {
      const { io, files } = makeMemIO();
      writeInbox("/fake/project", "H-FOO-1", "message for status", io);
      const waitPath = inboxWaitStatePath("/fake/project", "H-FOO-1");
      files.set(waitPath, JSON.stringify({
        itemId: "H-FOO-1",
        startedAt: "2026-04-02T10:00:00.000Z",
        pid: 123,
        pollMs: 1000,
        namespaceProjectRoot: "/fake/project",
        queuePath: itemInboxDir("/fake/project", "H-FOO-1"),
      }));

      const inspection = inspectInbox("/fake/project", "H-FOO-1", io);
      expect(inspection.pendingCount).toBe(1);
      expect(inspection.queuePath).toBe(itemInboxDir("/fake/project", "H-FOO-1"));
      expect(inspection.pendingMessages[0]?.preview).toContain("message for status");
      expect(inspection.waitState?.pid).toBe(123);
      expect(inspection.recentHistory[0]?.action).toBe("write");
      expect(checkInbox("/fake/project", "H-FOO-1", io)).toBe("message for status");
    });

    it("records durable history across write, deliver, drain, clean, and interrupted wait paths", () => {
      const { io } = makeMemIO();
      writeInbox("/fake/project", "H-FOO-1", "first", io);
      checkInbox("/fake/project", "H-FOO-1", io);

      writeInbox("/fake/project", "H-FOO-1", "second", io);
      writeInbox("/fake/project", "H-FOO-1", "third", io);
      drainInbox("/fake/project", "H-FOO-1", io);

      writeInbox("/fake/project", "H-FOO-1", "fourth", io);
      cleanInbox("/fake/project", "H-FOO-1", io);

      const waitRuntime = makeWaitRuntime();
      let sleepCount = 0;
      const deps: InboxDeps = {
        io,
        sleep: () => {
          sleepCount++;
          if (sleepCount === 1) {
            waitRuntime.handlers.get("SIGINT")?.();
          }
        },
        getBranch: () => "ninthwave/H-FOO-1",
      };

      expect(() => cmdInbox(["--wait", "H-FOO-1"], "/fake/project", deps, waitRuntime.runtime)).toThrow("EXIT:1");

      const actions = readInboxHistory("/fake/project", "H-FOO-1", 20, io).map((entry) => entry.action);
      expect(actions).toContain("write");
      expect(actions).toContain("deliver");
      expect(actions).toContain("drain");
      expect(actions).toContain("clean");
      expect(actions).toContain("wait-interrupted");
    });
  });

  describe("cmdInbox", () => {
    it("writes a message via --write", () => {
      const { io, files } = makeMemIO();
      const deps: InboxDeps = {
        io,
        sleep: () => {},
        getBranch: () => "ninthwave/H-FOO-1",
      };
      const out = captureOutput(() => cmdInbox(["--write", "H-FOO-1", "-m", "Fix it"], "/fake/project", deps));
      const prefix = `${itemInboxDir("/fake/project", "H-FOO-1")}/`;
      const queued = [...files.entries()].filter(([path]) => path.startsWith(prefix));
      expect(queued.map(([, content]) => content)).toEqual(["Fix it"]);
      expect(out).toContain("wrote message");
    });

    it("checks for all pending messages via --check", () => {
      const { io } = makeMemIO();
      writeInbox("/fake/project", "H-FOO-1", "check-msg-1", io);
      writeInbox("/fake/project", "H-FOO-1", "check-msg-2", io);
      const chunks: string[] = [];
      const origWrite = process.stdout.write;
      process.stdout.write = ((chunk: string) => { chunks.push(chunk); return true; }) as typeof process.stdout.write;
      try {
        const deps: InboxDeps = {
          io,
          sleep: () => {},
          getBranch: () => "ninthwave/H-FOO-1",
        };
        cmdInbox(["--check", "H-FOO-1"], "/fake/project", deps);
      } finally {
        process.stdout.write = origWrite;
      }
      expect(chunks.join("")).toBe("check-msg-1\n\ncheck-msg-2");
    });

    it("reports non-destructive status output", () => {
      const { io } = makeMemIO();
      writeInbox("/fake/project", "H-FOO-1", "check status preview", io);
      const deps: InboxDeps = {
        io,
        sleep: () => {},
        getBranch: () => "ninthwave/H-FOO-1",
      };

      const chunks: string[] = [];
      const origWrite = process.stdout.write;
      process.stdout.write = ((chunk: string) => { chunks.push(chunk); return true; }) as typeof process.stdout.write;
      try {
        cmdInbox(["--status", "H-FOO-1"], "/fake/project", deps);
      } finally {
        process.stdout.write = origWrite;
      }
      const out = chunks.join("");

      expect(out).toContain("Pending: 1");
      expect(out).toContain(`Queue: ${itemInboxDir("/fake/project", "H-FOO-1")}`);
      expect(out).toContain("check status preview");
      expect(checkInbox("/fake/project", "H-FOO-1", io)).toBe("check status preview");
    });

    it("reports non-destructive queue previews via --peek", () => {
      const { io } = makeMemIO();
      writeInbox("/fake/project", "H-FOO-1", "peek-msg-1", io);
      writeInbox("/fake/project", "H-FOO-1", "peek-msg-2", io);
      const deps: InboxDeps = {
        io,
        sleep: () => {},
        getBranch: () => "ninthwave/H-FOO-1",
      };

      const chunks: string[] = [];
      const origWrite = process.stdout.write;
      process.stdout.write = ((chunk: string) => { chunks.push(chunk); return true; }) as typeof process.stdout.write;
      try {
        cmdInbox(["--peek", "H-FOO-1"], "/fake/project", deps);
      } finally {
        process.stdout.write = origWrite;
      }
      const out = chunks.join("");

      expect(out).toContain("Pending: 2");
      expect(out).toContain("peek-msg-1");
      expect(out).toContain("peek-msg-2");
      expect(drainInbox("/fake/project", "H-FOO-1", io)).toEqual(["peek-msg-1", "peek-msg-2"]);
    });

    it("auto-detects item ID from branch", () => {
      const { io, files } = makeMemIO();
      const deps: InboxDeps = {
        io,
        sleep: () => {},
        getBranch: () => "ninthwave/AUTO-DETECT-1",
      };
      captureOutput(() => cmdInbox(["--write", "-m", "auto msg"], "/fake/project", deps));
      const prefix = `${itemInboxDir("/fake/project", "AUTO-DETECT-1")}/`;
      const queued = [...files.entries()].filter(([path]) => path.startsWith(prefix));
      expect(queued.map(([, content]) => content)).toEqual(["auto msg"]);
    });

    it("dies when no item ID and not on ninthwave branch", () => {
      const { io } = makeMemIO();
      const deps: InboxDeps = {
        io,
        sleep: () => {},
        getBranch: () => "main",
      };
      const out = captureOutput(() => cmdInbox(["--check"], "/fake/project", deps));
      expect(out).toContain("Could not determine item ID");
    });

    it("dies with no subcommand", () => {
      const { io } = makeMemIO();
      const deps: InboxDeps = {
        io,
        sleep: () => {},
        getBranch: () => "ninthwave/H-FOO-1",
      };
      const out = captureOutput(() => cmdInbox([], "/fake/project", deps));
      expect(out).toContain("Usage");
    });

    it("emits rerun guidance and exits non-zero when wait is interrupted before delivery", () => {
      const { io } = makeMemIO();
      const waitRuntime = makeWaitRuntime();
      let sleepCount = 0;
      const deps: InboxDeps = {
        io,
        sleep: () => {
          sleepCount++;
          if (sleepCount === 2) {
            waitRuntime.handlers.get("SIGTERM")?.();
          }
        },
        getBranch: () => "ninthwave/H-FOO-1",
      };

      expect(() => cmdInbox(["--wait", "H-FOO-1"], "/fake/project", deps, waitRuntime.runtime)).toThrow("EXIT:1");
      expect(waitRuntime.getExitCode()).toBe(1);
      expect(waitRuntime.stdout).toEqual([]);
      expect(waitRuntime.stderr.join("")).toContain("rerun 'nw inbox --wait H-FOO-1' with a very long timeout");
      expect(waitRuntime.handlers.size).toBe(0);
      expect(readInboxWaitState("/fake/project", "H-FOO-1", io)).toBeNull();
      expect(readInboxHistory("/fake/project", "H-FOO-1", 10, io).some((entry) => entry.action === "wait-interrupted")).toBe(true);
    });

    it("writes explicit wait-state metadata while blocked", () => {
      const { io } = makeMemIO();
      const waitRuntime = makeWaitRuntime();
      let activeWaitPath: string | null = null;
      const deps: InboxDeps = {
        io,
        sleep: () => {
          activeWaitPath = inboxWaitStatePath("/fake/project", "H-FOO-1");
          const raw = activeWaitPath ? io.readFileSync(activeWaitPath, "utf-8") : null;
          expect(raw).toContain('"itemId": "H-FOO-1"');
          writeInbox("/fake/project", "H-FOO-1", "arrived after wait", io);
        },
        getBranch: () => "ninthwave/H-FOO-1",
      };

      cmdInbox(["--wait", "H-FOO-1"], "/fake/project", deps, waitRuntime.runtime);

      expect(waitRuntime.stdout.join("")).toBe("arrived after wait");
      expect(activeWaitPath).toBe(inboxWaitStatePath("/fake/project", "H-FOO-1"));
      expect(readInboxWaitState("/fake/project", "H-FOO-1", io)).toBeNull();
    });
  });
});
