// Pure send-message logic, separated from cmux.ts so it can be tested
// without vi.mock leaks from other test files (bun test doesn't isolate mocks).

import type { RunResult } from "./types.ts";
import { checkDelivery, sendWithRetry } from "./delivery.ts";

export type Runner = (cmd: string, args: string[]) => RunResult;
export type Sleeper = (ms: number) => void;

/** Injectable dependencies for sendMessage (testing seam). */
export interface SendMessageDeps {
  runner: Runner;
  sleep: Sleeper;
  maxRetries?: number;
  baseDelayMs?: number;
}

/**
 * Send a message to a cmux workspace. Returns true on success.
 *
 * Uses paste-then-submit to avoid the race condition where `cmux send`
 * types text character-by-character and fires Return before the text is
 * fully entered. Verifies delivery and retries with exponential backoff.
 */
export function sendMessageImpl(
  workspaceRef: string,
  message: string,
  deps: SendMessageDeps,
): boolean {
  const { runner, sleep, maxRetries = 3, baseDelayMs = 100 } = deps;

  return sendWithRetry(
    () => attemptSend(workspaceRef, message, runner, sleep),
    { sleep, maxRetries, baseDelayMs },
  );
}

/** Single delivery attempt: paste text, send Return, verify. */
function attemptSend(
  workspaceRef: string,
  message: string,
  runner: Runner,
  sleep: Sleeper,
): boolean {
  // 1. Load message into a paste buffer (atomic -- avoids keystroke race)
  const buf = runner("cmux", ["set-buffer", "--name", "_nw_send", message]);
  if (buf.exitCode !== 0) return false;

  // 2. Paste buffer into the workspace's active surface
  const paste = runner("cmux", [
    "paste-buffer",
    "--name",
    "_nw_send",
    "--workspace",
    workspaceRef,
  ]);

  if (paste.exitCode !== 0) {
    // Paste failed -- surface is likely a TUI (e.g., Claude Code), not a raw
    // terminal. Fall back to `cmux send` which delivers via keystrokes.
    return attemptDirectSend(workspaceRef, message, runner, sleep);
  }

  // 3. Let the terminal process the pasted text
  sleep(50);

  // 4. Press Return to submit
  const key = runner("cmux", [
    "send-key",
    "--workspace",
    workspaceRef,
    "Return",
  ]);
  if (key.exitCode !== 0) return false;

  // 5. Verify delivery
  sleep(100);
  return verifyDelivery(workspaceRef, message, runner, true);
}

/** Fallback: use `cmux send` for non-terminal surfaces (TUIs like Claude Code). */
function attemptDirectSend(
  workspaceRef: string,
  message: string,
  runner: Runner,
  sleep: Sleeper,
): boolean {
  // Send the message text (without trailing newline -- we submit separately)
  const text = message.replace(/\n+$/, "");
  const result = runner("cmux", [
    "send",
    "--workspace",
    workspaceRef,
    text,
  ]);
  if (result.exitCode !== 0) return false;

  // Wait for keystrokes to be processed by the TUI input handler.
  // cmux send returns after queuing keystrokes, but delivery to the target
  // surface is asynchronous. 500ms provides generous headroom for Copilot
  // and other TUIs to process the full message before we send Return.
  sleep(500);

  // Submit with send-key Return (same pattern as the paste-buffer path)
  const key = runner("cmux", [
    "send-key",
    "--workspace",
    workspaceRef,
    "Return",
  ]);
  if (key.exitCode !== 0) return false;

  // Brief wait then verify
  sleep(100);
  return verifyDelivery(workspaceRef, message, runner, false);
}

/**
 * Check that the message was submitted (not stuck in the input field).
 *
 * Reads the last few screen lines via cmux and delegates to the shared
 * checkDelivery logic. When the screen can't be read, returns
 * `usedPasteBuffer` -- the paste-buffer path is inherently reliable,
 * but the keystroke fallback (attemptDirectSend) is not, so we can't
 * assume success for unverifiable keystroke deliveries.
 */
export function verifyDelivery(
  workspaceRef: string,
  message: string,
  runner: Runner,
  usedPasteBuffer: boolean = true,
): boolean {
  const screen = runner("cmux", [
    "read-screen",
    "--workspace",
    workspaceRef,
    "--lines",
    "3",
  ]);

  if (screen.exitCode !== 0) {
    // Can't verify -- only trust paste-buffer delivery (inherently reliable).
    // Keystroke delivery (attemptDirectSend) can drop or interleave keys.
    return usedPasteBuffer;
  }

  return checkDelivery(screen.stdout, message);
}
