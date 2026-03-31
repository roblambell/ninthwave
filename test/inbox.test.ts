import { describe, it, expect } from "vitest";
import {
  writeInbox,
  checkInbox,
  waitForInbox,
  cleanInbox,
  itemInboxDir,
  cmdInbox,
  type InboxIO,
  type InboxDeps,
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
      expect(files.size).toBe(0);
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
      expect(files.size).toBe(0);
    });

    it("no-ops when file does not exist", () => {
      const { io } = makeMemIO();
      // Should not throw
      cleanInbox("/fake/project", "H-FOO-1", io);
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

    it("checks for a message via --check", () => {
      const { io } = makeMemIO();
      writeInbox("/fake/project", "H-FOO-1", "check-msg", io);
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
      expect(chunks.join("")).toBe("check-msg");
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
  });
});
