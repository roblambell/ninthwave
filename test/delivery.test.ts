// Tests for core/delivery.ts — shared delivery verification and retry logic.

import { describe, it, expect } from "vitest";
import { checkDelivery, sendWithRetry } from "../core/delivery.ts";

// ── checkDelivery tests ─────────────────────────────────────────────

describe("checkDelivery", () => {
  it("returns true when screen shows no trace of message", () => {
    expect(checkDelivery("Thinking...\nclaude> ", "hello")).toBe(true);
  });

  it("returns false when message is stuck on the last line", () => {
    expect(checkDelivery("Previous output\nhello", "hello")).toBe(false);
  });

  it("returns true when screen is empty", () => {
    expect(checkDelivery("", "hello")).toBe(true);
  });

  it("returns true when screen has only blank lines", () => {
    expect(checkDelivery("\n\n  \n", "hello")).toBe(true);
  });

  it("uses first 60 chars as probe for long messages", () => {
    const longMsg = "A".repeat(100);
    const probe = "A".repeat(60);

    // Last line has the probe — stuck
    expect(checkDelivery(`prompt\n${probe}BBBB`, longMsg)).toBe(false);

    // Last line does NOT have the probe — submitted
    expect(checkDelivery("prompt\nclaude thinking...", longMsg)).toBe(true);
  });

  it("ignores blank lines when finding the last line", () => {
    // Message not on last non-blank line
    expect(checkDelivery("claude>\n\n\n", "hello")).toBe(true);
  });

  it("detects message stuck among trailing blanks", () => {
    expect(checkDelivery("output\nhello\n\n", "hello")).toBe(false);
  });
});

// ── sendWithRetry tests ──────────────────────────────────────────────

describe("sendWithRetry", () => {
  it("returns true on first attempt success", () => {
    const sleepCalls: number[] = [];
    const result = sendWithRetry(() => true, {
      sleep: (ms) => sleepCalls.push(ms),
      maxRetries: 3,
      baseDelayMs: 100,
    });

    expect(result).toBe(true);
    expect(sleepCalls).toHaveLength(0); // No sleep on first attempt
  });

  it("retries on failure and succeeds on second attempt", () => {
    let attempts = 0;
    const sleepCalls: number[] = [];

    const result = sendWithRetry(
      () => {
        attempts++;
        return attempts >= 2;
      },
      { sleep: (ms) => sleepCalls.push(ms), maxRetries: 3, baseDelayMs: 100 },
    );

    expect(result).toBe(true);
    expect(attempts).toBe(2);
    expect(sleepCalls).toEqual([100]); // baseDelay * 2^0
  });

  it("uses exponential backoff for delays", () => {
    let attempts = 0;
    const sleepCalls: number[] = [];

    sendWithRetry(
      () => {
        attempts++;
        return attempts > 4; // Fails all 4 attempts (0..3)
      },
      { sleep: (ms) => sleepCalls.push(ms), maxRetries: 3, baseDelayMs: 100 },
    );

    // Delays: 100*2^0=100, 100*2^1=200, 100*2^2=400
    expect(sleepCalls).toEqual([100, 200, 400]);
  });

  it("returns false after exhausting all retries", () => {
    let attempts = 0;
    const result = sendWithRetry(
      () => {
        attempts++;
        return false;
      },
      { sleep: () => {}, maxRetries: 2, baseDelayMs: 50 },
    );

    expect(result).toBe(false);
    expect(attempts).toBe(3); // 1 initial + 2 retries
  });

  it("defaults to maxRetries=3 and baseDelayMs=100", () => {
    let attempts = 0;
    const sleepCalls: number[] = [];

    sendWithRetry(
      () => {
        attempts++;
        return false;
      },
      { sleep: (ms) => sleepCalls.push(ms) },
    );

    expect(attempts).toBe(4); // 1 initial + 3 retries
    expect(sleepCalls).toEqual([100, 200, 400]);
  });
});
