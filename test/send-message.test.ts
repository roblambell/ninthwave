// Tests for core/send-message.ts -- message delivery pipeline.
// Uses dependency injection (Runner, Sleeper) instead of vi.mock to avoid
// mock leaks between test files (bun test doesn't isolate mocks).

import { describe, it, expect } from "vitest";
import {
  sendMessageImpl,
  verifyDelivery,
  type Runner,
  type SendMessageDeps,
} from "../core/send-message.ts";
import type { RunResult } from "../core/types.ts";

// ── Helpers ────────────────────────────────────────────────────────────

/** Create a RunResult with defaults. */
function ok(stdout = ""): RunResult {
  return { stdout, stderr: "", exitCode: 0 };
}

function fail(stderr = ""): RunResult {
  return { stdout: "", stderr, exitCode: 1 };
}

/** Build a runner that returns preconfigured results for each cmux subcommand. */
function mockRunner(
  overrides: Partial<Record<string, RunResult | RunResult[]>> = {},
): { runner: Runner; calls: Array<{ cmd: string; args: string[] }> } {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  // Track call counts per subcommand for array-based overrides
  const counters: Record<string, number> = {};

  const runner: Runner = (cmd, args) => {
    calls.push({ cmd, args });
    // The subcommand is the first arg (e.g., "set-buffer", "paste-buffer")
    const sub = args[0] ?? "";
    const override = overrides[sub];
    if (Array.isArray(override)) {
      counters[sub] = (counters[sub] ?? 0) + 1;
      return override[counters[sub]! - 1] ?? ok();
    }
    if (override) return override;
    return ok();
  };

  return { runner, calls };
}

/** No-op sleeper that records calls. */
function mockSleeper(): { sleep: (ms: number) => void; sleepCalls: number[] } {
  const sleepCalls: number[] = [];
  return { sleep: (ms) => sleepCalls.push(ms), sleepCalls };
}

// ── verifyDelivery ─────────────────────────────────────────────────────

describe("verifyDelivery", () => {
  it("returns true when screen is readable and message is NOT on last line", () => {
    const { runner } = mockRunner({
      "read-screen": ok("Thinking...\nclaude> "),
    });
    expect(verifyDelivery("ws1", "hello world", runner, true)).toBe(true);
  });

  it("returns false when screen is readable and message IS on last line", () => {
    const { runner } = mockRunner({
      "read-screen": ok("Previous output\nhello world"),
    });
    expect(verifyDelivery("ws1", "hello world", runner, true)).toBe(false);
  });

  it("returns true when screen is unreadable and paste buffer was used", () => {
    const { runner } = mockRunner({
      "read-screen": fail("screen read error"),
    });
    expect(verifyDelivery("ws1", "hello", runner, true)).toBe(true);
  });

  it("returns false when screen is unreadable and keystroke was used (M-ER-1 fix)", () => {
    const { runner } = mockRunner({
      "read-screen": fail("screen read error"),
    });
    // usedPasteBuffer=false -> don't trust unverifiable keystroke delivery
    expect(verifyDelivery("ws1", "hello", runner, false)).toBe(false);
  });

  it("matches short message (< 60 chars) as probe", () => {
    const shortMsg = "deploy now";
    const { runner } = mockRunner({
      "read-screen": ok(`output\n${shortMsg}`),
    });
    // Short message appears on last line -- stuck
    expect(verifyDelivery("ws1", shortMsg, runner, true)).toBe(false);
  });

  it("matches long message (> 60 chars) using truncated probe", () => {
    const longMsg = "A".repeat(100);
    const probe = "A".repeat(60);

    // Last line has truncated probe -- stuck
    const { runner: r1 } = mockRunner({
      "read-screen": ok(`prompt\n${probe}EXTRA`),
    });
    expect(verifyDelivery("ws1", longMsg, r1, true)).toBe(false);

    // Last line does NOT have the probe -- delivered
    const { runner: r2 } = mockRunner({
      "read-screen": ok("prompt\nclaude thinking..."),
    });
    expect(verifyDelivery("ws1", longMsg, r2, true)).toBe(true);
  });
});

// ── attemptSend (via sendMessageImpl with maxRetries=0) ────────────────

describe("attemptSend", () => {
  it("returns true when paste buffer succeeds and delivery is verified", () => {
    const { runner } = mockRunner({
      "read-screen": ok("Thinking...\nclaude> "),
    });
    const { sleep } = mockSleeper();
    const deps: SendMessageDeps = { runner, sleep, maxRetries: 0 };

    expect(sendMessageImpl("ws1", "hello", deps)).toBe(true);
  });

  it("falls back to direct send when paste-buffer fails", () => {
    const { runner, calls } = mockRunner({
      "paste-buffer": fail("not a terminal"),
      "read-screen": ok("Thinking...\nclaude> "),
    });
    const { sleep } = mockSleeper();
    const deps: SendMessageDeps = { runner, sleep, maxRetries: 0 };

    expect(sendMessageImpl("ws1", "hello", deps)).toBe(true);

    // Should have called "send" (direct send) after paste-buffer failed
    const subcommands = calls.map((c) => c.args[0]);
    expect(subcommands).toContain("send");
  });

  it("returns false when both paste-buffer and direct send fail", () => {
    const { runner } = mockRunner({
      "paste-buffer": fail("not a terminal"),
      "send": fail("send failed"),
    });
    const { sleep } = mockSleeper();
    const deps: SendMessageDeps = { runner, sleep, maxRetries: 0 };

    expect(sendMessageImpl("ws1", "hello", deps)).toBe(false);
  });
});

// ── sendMessageImpl retry behavior ─────────────────────────────────────

describe("sendMessageImpl", () => {
  it("succeeds on first attempt without retrying", () => {
    const { runner } = mockRunner({
      "read-screen": ok("Thinking...\nclaude> "),
    });
    const { sleep, sleepCalls } = mockSleeper();
    const deps: SendMessageDeps = { runner, sleep, maxRetries: 3, baseDelayMs: 100 };

    expect(sendMessageImpl("ws1", "hello", deps)).toBe(true);
    // No retry backoff sleeps -- only the in-attempt waits (50ms, 100ms)
    // Retry backoff would be 100, 200, 400ms -- none of those should appear
    expect(sleepCalls.filter((ms) => ms >= 100 && ms !== 100)).toHaveLength(0);
  });

  it("retries on delivery failure with exponential backoff", () => {
    // First attempt: screen shows message stuck (delivery fails)
    // Second attempt: screen shows message delivered (success)
    let readScreenCount = 0;
    const { runner } = mockRunner({
      // read-screen returns stuck on first call, clear on second
      "read-screen": [
        ok("Previous output\nhello"),  // stuck on first verify
        ok("Thinking...\nclaude> "),   // delivered on second verify
      ],
    });
    const { sleep, sleepCalls } = mockSleeper();
    const deps: SendMessageDeps = { runner, sleep, maxRetries: 3, baseDelayMs: 100 };

    expect(sendMessageImpl("ws1", "hello", deps)).toBe(true);

    // Should have a retry backoff sleep of 100ms (baseDelay * 2^0)
    expect(sleepCalls).toContain(100);
  });

  it("returns false after max retries exhausted", () => {
    // Every attempt shows message stuck on last line
    const { runner } = mockRunner({
      "read-screen": ok("Previous output\nhello"),
    });
    const { sleep, sleepCalls } = mockSleeper();
    // Use baseDelayMs=1000 so backoff sleeps (1000, 2000) are distinguishable
    // from in-attempt sleeps (50, 100)
    const deps: SendMessageDeps = { runner, sleep, maxRetries: 2, baseDelayMs: 1000 };

    expect(sendMessageImpl("ws1", "hello", deps)).toBe(false);

    // Should have retry backoff sleeps: 1000ms (1000*2^0), 2000ms (1000*2^1)
    const backoffSleeps = sleepCalls.filter((ms) => ms >= 1000);
    expect(backoffSleeps).toEqual([1000, 2000]);

    // Should have 3 attempts total (1 initial + 2 retries)
    // Each attempt does 2 in-attempt sleeps (50ms + 100ms) = 6 in-attempt sleeps
    const inAttemptSleeps = sleepCalls.filter((ms) => ms < 1000);
    expect(inAttemptSleeps).toHaveLength(6);
  });

  it("passes workspace and message through to cmux commands", () => {
    const { runner, calls } = mockRunner({
      "read-screen": ok("Thinking...\nclaude> "),
    });
    const { sleep } = mockSleeper();
    const deps: SendMessageDeps = { runner, sleep, maxRetries: 0 };

    sendMessageImpl("my-workspace", "test message", deps);

    // set-buffer should contain the message
    const setBuf = calls.find((c) => c.args[0] === "set-buffer");
    expect(setBuf).toBeDefined();
    expect(setBuf!.args).toContain("test message");

    // paste-buffer should reference the workspace
    const paste = calls.find((c) => c.args[0] === "paste-buffer");
    expect(paste).toBeDefined();
    expect(paste!.args).toContain("my-workspace");

    // send-key should reference the workspace
    const sendKey = calls.find((c) => c.args[0] === "send-key");
    expect(sendKey).toBeDefined();
    expect(sendKey!.args).toContain("my-workspace");
  });
});
