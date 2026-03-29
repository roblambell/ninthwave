// Shared helpers for scenario tests.
// Wires FakeGitHub + FakeMux into the real orchestrateLoop via dependency injection.

import { vi } from "vitest";
import {
  type OrchestratorDeps,
  type ExecutionContext,
  type Orchestrator,
} from "../../core/orchestrator.ts";
import {
  buildSnapshot,
  type OrchestrateLoopDeps,
} from "../../core/commands/orchestrate.ts";
import type { WorkItem, Priority } from "../../core/types.ts";
import { FakeGitHub } from "../fakes/fake-github.ts";
import { FakeMux } from "../fakes/fake-mux.ts";

export function makeWorkItem(
  id: string,
  deps: string[] = [],
  priority: Priority = "high",
): WorkItem {
  return {
    id,
    priority,
    title: `Item ${id}`,
    domain: "test",
    dependencies: deps,
    bundleWith: [],
    status: "open",
    filePath: `/project/.ninthwave/work/1--${id}.md`,
    repoAlias: "",
    rawText: `## ${id}\nTest item`,
    filePaths: [],
    testPlan: "",
    bootstrap: false,
  };
}

export const defaultCtx: ExecutionContext = {
  projectRoot: "/tmp/test-project",
  worktreeDir: "/tmp/test-project/.worktrees",
  workDir: "/tmp/test-project/.ninthwave/work",
  aiTool: "claude",
};

export function buildActionDeps(
  fakeGh: FakeGitHub,
  fakeMux: FakeMux,
  overrides?: Partial<OrchestratorDeps>,
): OrchestratorDeps {
  return {
    launchSingleItem: vi.fn((_item, _wd, _wtd, _pr, _ai, _bb) => {
      const ref = fakeMux.launchWorkspace("/tmp/worktree", "claude");
      return { worktreePath: "/tmp/worktree", workspaceRef: ref! };
    }),
    cleanSingleWorktree: vi.fn(() => true),
    prMerge: vi.fn((repoRoot, prNumber, options) => fakeGh.prMerge(repoRoot, prNumber, options)),
    prComment: vi.fn((repoRoot, prNumber, body) => fakeGh.prComment(repoRoot, prNumber, body)),
    sendMessage: vi.fn((ref, msg) => fakeMux.sendMessage(ref, msg)),
    closeWorkspace: vi.fn((ref) => fakeMux.closeWorkspace(ref)),
    fetchOrigin: vi.fn(),
    ffMerge: vi.fn(),
    checkPrMergeable: vi.fn(() => true),
    getMergeCommitSha: vi.fn(() => null),
    ...overrides,
  };
}

export interface ScenarioLoopDeps extends OrchestrateLoopDeps {
  /** Exposed for test assertions. */
  __logs: Array<Record<string, unknown>>;
}

export function buildLoopDeps(
  fakeGh: FakeGitHub,
  fakeMux: FakeMux,
  actionDeps: OrchestratorDeps,
): ScenarioLoopDeps {
  const logs: Array<Record<string, unknown>> = [];
  return {
    buildSnapshot: (orch, projectRoot, worktreeDir) =>
      buildSnapshot(
        orch,
        projectRoot,
        worktreeDir,
        fakeMux,
        () => new Date().toISOString(),
        fakeGh.checkPr,
        undefined,
        fakeGh.checkCommitCI,
      ),
    sleep: () => Promise.resolve(),
    log: (entry) => logs.push(entry),
    actionDeps,
    getFreeMem: () => 8 * 1024 * 1024 * 1024,
    __logs: logs,
  } as ScenarioLoopDeps;
}

/** Simulate the happy path for an item: create PR, pass CI, mark review complete. */
export function completeItem(
  id: string,
  fakeGh: FakeGitHub,
  orch: Orchestrator,
): void {
  const branch = `ninthwave/${id}`;
  fakeGh.createPR(branch, `Item ${id}`);
  fakeGh.setCIStatus(branch, "pass");
  fakeGh.setMergeable(branch, "MERGEABLE");
  fakeGh.setReviewDecision(branch, "APPROVED");
  const orchItem = orch.getItem(id);
  if (orchItem) orchItem.reviewCompleted = true;
}
