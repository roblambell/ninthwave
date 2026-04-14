// feedback-done command: workers signal "feedback addressed without code changes".
// Usage: nw feedback-done
//
// Auto-detects the work item ID from the current git branch (ninthwave/{ID}).
// Writes a one-shot signal file that the orchestrator daemon consumes on its
// next poll cycle, clearing the pending human-feedback state and resuming the
// normal review/merge loop without requiring a new commit.

import { die } from "../output.ts";
import {
  writeFeedbackDoneSignal,
  type DaemonIO,
} from "../daemon.ts";
import { extractItemId } from "./heartbeat.ts";

// ── Types ────────────────────────────────────────────────────────────

export interface FeedbackDoneDeps {
  io: DaemonIO;
  getBranch: () => string | null;
}

const defaultDeps: FeedbackDoneDeps = {
  io: {
    writeFileSync: (await import("fs")).writeFileSync,
    readFileSync: (await import("fs")).readFileSync,
    unlinkSync: (await import("fs")).unlinkSync,
    existsSync: (await import("fs")).existsSync,
    mkdirSync: (await import("fs")).mkdirSync,
    renameSync: (await import("fs")).renameSync,
  },
  getBranch: () => {
    try {
      const result = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], { stdout: "pipe", stderr: "pipe" });
      return result.exitCode === 0 ? result.stdout.toString().trim() : null;
    } catch {
      return null;
    }
  },
};

// ── Command implementation ───────────────────────────────────────────

/**
 * Write a feedback-done signal file for the current worker.
 * Auto-detects the item ID from the current git branch (ninthwave/{ID}).
 * Returns a status message.
 */
export function cmdFeedbackDone(
  _args: string[],
  projectRoot: string,
  deps: FeedbackDoneDeps = defaultDeps,
): string {
  const branch = deps.getBranch();
  if (!branch) {
    die("Could not detect current git branch");
    return ""; // unreachable
  }

  const id = extractItemId(branch);
  if (!id) {
    die(`Not on an item branch (expected "ninthwave/<ID>", got "${branch}")`);
    return ""; // unreachable
  }

  writeFeedbackDoneSignal(projectRoot, id, deps.io);

  const msg = `Feedback-done signal written for ${id}`;
  console.log(msg);
  return msg;
}
