import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "fs";
import { join } from "path";
import { TEST_LAUNCH_OVERRIDE_COMMAND_ENV } from "../../core/commands/launch.ts";
import { cleanupTempRepos, waitFor } from "../helpers.ts";
import { CliHarness } from "./helpers/cli-harness.ts";
import {
  DEFAULT_FAKE_AI_SCRIPT,
  FAKE_AI_RUN_ID_ENV,
  FAKE_AI_SCENARIO_ENV,
  createFakeAiRun,
  fakeAiSuccessScenario,
  readFakeAiContext,
  readFakeAiState,
} from "./helpers/fake-ai-scenario.ts";

const TEST_BIN_DIR = join(import.meta.dirname, "..", "bin");

const SELECTED_ITEM = `
## Watch CLI

### Complete selected item through headless watch (H-WCL-1)
**Priority:** High
**Source:** Test
**Domain:** watch-system-tests
**Lineage:** aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1

Selected-item watch startup coverage.

Acceptance: Selected watch startup launches the item through the real CLI.

Key files: \`test/system/watch-cli.test.ts\`
`;

const FUTURE_ITEM = `
## Watch CLI

### Discover future item through armed watch startup (H-WCL-2)
**Priority:** High
**Source:** Test
**Domain:** watch-system-tests
**Lineage:** bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2

Future-only watch startup coverage.

Acceptance: Future-only startup discovers a new item and runs it through the real CLI.

Key files: \`test/system/watch-cli.test.ts\`
`;

function buildCliEnv(harness: CliHarness, runId: string, scenarioPath: string): Record<string, string> {
  return {
    PATH: `${TEST_BIN_DIR}:${process.env.PATH ?? ""}`,
    [TEST_LAUNCH_OVERRIDE_COMMAND_ENV]: DEFAULT_FAKE_AI_SCRIPT,
    [FAKE_AI_SCENARIO_ENV]: scenarioPath,
    [FAKE_AI_RUN_ID_ENV]: runId,
    NINTHWAVE_FAKE_GH_STATE_PATH: join(harness.stateDir, "fake-gh.json"),
    NINTHWAVE_FAKE_GH_REPO: "ninthwave-sh/ninthwave-system-test",
    NINTHWAVE_MUX: "headless",
  };
}

describe("system: watch CLI", () => {
  afterEach(() => {
    cleanupTempRepos();
  });

  it("covers selected-item watch startup through queued, implementing, and done", async () => {
    const harness = new CliHarness();
    harness.writeWorkItems(SELECTED_ITEM);
    harness.commitAndPushWorkItems("Add selected watch-cli test item");

    const run = createFakeAiRun(
      harness.projectRoot,
      fakeAiSuccessScenario({
        sleepMs: 4_000,
        stdout: ["selected worker started", "selected worker finished"],
        heartbeat: { progress: 1.0, label: "PR created", prNumber: 1 },
      }),
      { runId: "watch-cli-selected" },
    );

    const processHandle = harness.start([
      "--items", "H-WCL-1",
      "--watch",
      "--tool", "codex",
      "--merge-strategy", "auto",
      "--no-review",
      "--skip-preflight",
      "--poll-interval", "0",
      "--watch-interval", "0",
    ], {
      env: buildCliEnv(harness, run.runId, run.scenarioPath),
    });

    const workspaceRef = "headless:H-WCL-1";
    const worktreePath = join(harness.worktreeDir, "ninthwave-H-WCL-1");

    try {
      const queuedState = await harness.waitForOrchestratorState((state) => {
        const item = state.items.find((entry) => entry.id === "H-WCL-1");
        return item?.state === "queued" ? state : false;
      });
      expect(queuedState.items).toHaveLength(1);

      await waitFor(() => existsSync(worktreePath) ? worktreePath : false, {
        description: "selected worktree creation",
      });
      await waitFor(() => existsSync(harness.headlessPidPath(workspaceRef)) ? workspaceRef : false, {
        description: "selected headless pid file",
      });

      await harness.waitForOrchestratorState((state) => {
        const item = state.items.find((entry) => entry.id === "H-WCL-1");
        return item?.state === "implementing" ? item : false;
      });

      await harness.waitForHeadlessLog(workspaceRef, "selected worker finished");
      await harness.waitForHeadlessExit(workspaceRef);

      const doneState = await harness.waitForOrchestratorState((state) => {
        const item = state.items.find((entry) => entry.id === "H-WCL-1");
        return item?.state === "done" ? state : false;
      }, 10_000);
      const doneItem = doneState.items.find((entry) => entry.id === "H-WCL-1");

      await harness.waitForProcessOutput(processHandle, /"event":"watch_mode_waiting"/);
      await waitFor(() => !existsSync(worktreePath), {
        timeoutMs: 10_000,
        description: "selected worktree cleanup",
      });

      expect(doneItem?.prNumber).toBe(1);
      expect(readFakeAiState(harness.stateDir, run.runId).status).toBe("completed");
      expect(readFakeAiContext(harness.stateDir, run.runId).mode).toBe("headless");
      expect(processHandle.stdout).toContain("Headless worker detached for H-WCL-1");
      expect(processHandle.stdout).toContain("\"event\":\"watch_mode_waiting\"");
      expect(existsSync(harness.headlessPidPath(workspaceRef))).toBe(false);
    } finally {
      await harness.stop(processHandle);
    }
  }, 20_000);

  it("covers future-only startup discovering and completing a newly pushed item", async () => {
    const harness = new CliHarness();
    const run = createFakeAiRun(
      harness.projectRoot,
      fakeAiSuccessScenario({
        sleepMs: 4_000,
        stdout: ["future worker started", "future worker finished"],
        heartbeat: { progress: 1.0, label: "PR created", prNumber: 1 },
      }),
      { runId: "watch-cli-future" },
    );

    const processHandle = harness.start([
      "--watch",
      "--future-only-startup",
      "--tool", "codex",
      "--merge-strategy", "auto",
      "--no-review",
      "--skip-preflight",
      "--poll-interval", "0",
      "--watch-interval", "0",
    ], {
      env: buildCliEnv(harness, run.runId, run.scenarioPath),
    });

    const workspaceRef = "headless:H-WCL-2";
    const worktreePath = join(harness.worktreeDir, "ninthwave-H-WCL-2");

    try {
      const armedState = await harness.waitForOrchestratorState((state) => {
        return state.emptyState === "watch-armed" && state.items.length === 0
          ? state
          : false;
      });
      expect(armedState.items).toHaveLength(0);
      await harness.waitForProcessOutput(processHandle, /"event":"watch_mode_waiting"/);

      harness.writeWorkItems(FUTURE_ITEM);
      harness.commitAndPushWorkItems("Add future watch-cli test item");

      await harness.waitForProcessOutput(processHandle, /"event":"watch_new_items"/);
      await waitFor(() => existsSync(worktreePath) ? worktreePath : false, {
        description: "future worktree creation",
      });
      await waitFor(() => existsSync(harness.headlessPidPath(workspaceRef)) ? workspaceRef : false, {
        description: "future headless pid file",
      });

      await harness.waitForOrchestratorState((state) => {
        const item = state.items.find((entry) => entry.id === "H-WCL-2");
        return item?.state === "implementing" ? item : false;
      }, 10_000);

      await harness.waitForHeadlessLog(workspaceRef, "future worker finished");
      await harness.waitForHeadlessExit(workspaceRef);

      const doneState = await harness.waitForOrchestratorState((state) => {
        const item = state.items.find((entry) => entry.id === "H-WCL-2");
        return item?.state === "done" ? state : false;
      }, 10_000);
      const doneItem = doneState.items.find((entry) => entry.id === "H-WCL-2");

      await waitFor(() => !existsSync(worktreePath), {
        timeoutMs: 10_000,
        description: "future worktree cleanup",
      });

      expect(doneItem?.prNumber).toBe(1);
      expect(readFakeAiState(harness.stateDir, run.runId).status).toBe("completed");
      expect(readFakeAiContext(harness.stateDir, run.runId).itemId).toBe("H-WCL-2");
      expect(processHandle.stdout).toContain("\"event\":\"watch_new_items\"");
      expect(existsSync(harness.headlessPidPath(workspaceRef))).toBe(false);
    } finally {
      await harness.stop(processHandle);
    }
  }, 20_000);
});
