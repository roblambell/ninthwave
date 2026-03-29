// Scenario test: single work item from queued -> done.
// Exercises the real orchestrateLoop, buildSnapshot, processTransitions, and executeAction
// with FakeGitHub and FakeMux injected at the external boundaries.

import { describe, it, expect } from "vitest";
import { Orchestrator } from "../../core/orchestrator.ts";
import { orchestrateLoop } from "../../core/commands/orchestrate.ts";
import { FakeGitHub } from "../fakes/fake-github.ts";
import { FakeMux } from "../fakes/fake-mux.ts";
import {
  makeWorkItem,
  defaultCtx,
  buildActionDeps,
  buildLoopDeps,
} from "./helpers.ts";

describe("scenario: full lifecycle", () => {
  it("single item: queued -> ready -> launching -> implementing -> pr-open -> ci-passed -> merging -> merged -> done", async () => {
    const fakeGh = new FakeGitHub();
    const fakeMux = new FakeMux();

    const orch = new Orchestrator({
      wipLimit: 5,
      mergeStrategy: "auto",
      bypassEnabled: false,
      maxCiRetries: 3,
      maxRetries: 3,
      enableStacking: false,
      verifyMain: false,
      reviewWipLimit: 0,
    });

    orch.addItem(makeWorkItem("H-1"));

    const actionDeps = buildActionDeps(fakeGh, fakeMux);
    const loopDeps = buildLoopDeps(fakeGh, fakeMux, actionDeps);

    let cycle = 0;
    loopDeps.sleep = async () => {
      cycle++;

      // Cycle 2: worker creates a PR with pending CI
      if (cycle === 2) {
        fakeGh.createPR("ninthwave/H-1", "Item H-1");
        fakeGh.setCIStatus("ninthwave/H-1", "pending");
        fakeGh.setMergeable("ninthwave/H-1", "MERGEABLE");
      }

      // Cycle 3: CI passes, review pre-approved (review lifecycle tested separately)
      if (cycle === 3) {
        fakeGh.setCIStatus("ninthwave/H-1", "pass");
        fakeGh.setReviewDecision("ninthwave/H-1", "APPROVED");
        const orchItem = orch.getItem("H-1");
        if (orchItem) orchItem.reviewCompleted = true;
      }
    };

    await orchestrateLoop(orch, defaultCtx, loopDeps, { maxIterations: 20 });

    const finalItem = orch.getItem("H-1");
    expect(finalItem).toBeDefined();
    expect(finalItem!.state).toBe("done");
    expect(actionDeps.launchSingleItem).toHaveBeenCalledTimes(1);
    expect(actionDeps.prMerge).toHaveBeenCalled();
    expect(fakeGh.getPR("ninthwave/H-1")!.state).toBe("merged");
  });

  it("item with no PR stays implementing until PR appears", async () => {
    const fakeGh = new FakeGitHub();
    const fakeMux = new FakeMux();

    const orch = new Orchestrator({
      wipLimit: 5,
      mergeStrategy: "auto",
      bypassEnabled: false,
      enableStacking: false,
      verifyMain: false,
      reviewWipLimit: 0,
    });

    orch.addItem(makeWorkItem("H-2"));

    const actionDeps = buildActionDeps(fakeGh, fakeMux);
    const loopDeps = buildLoopDeps(fakeGh, fakeMux, actionDeps);

    await orchestrateLoop(orch, defaultCtx, loopDeps, { maxIterations: 5 });

    const finalItem = orch.getItem("H-2");
    expect(finalItem).toBeDefined();
    // Not stuck yet -- within timeout, just no PR created
    expect(["launching", "implementing"]).toContain(finalItem!.state);
  });

  it("CI failure increments ciFailCount and moves to ci-failed", async () => {
    const fakeGh = new FakeGitHub();
    const fakeMux = new FakeMux();

    const orch = new Orchestrator({
      wipLimit: 5,
      mergeStrategy: "auto",
      bypassEnabled: false,
      enableStacking: false,
      verifyMain: false,
      reviewWipLimit: 0,
    });

    orch.addItem(makeWorkItem("H-3"));

    const actionDeps = buildActionDeps(fakeGh, fakeMux);
    const loopDeps = buildLoopDeps(fakeGh, fakeMux, actionDeps);

    let cycle = 0;
    loopDeps.sleep = async () => {
      cycle++;
      if (cycle === 2) {
        fakeGh.createPR("ninthwave/H-3", "Item H-3");
        fakeGh.setCIStatus("ninthwave/H-3", "fail");
        fakeGh.setMergeable("ninthwave/H-3", "MERGEABLE");
      }
    };

    await orchestrateLoop(orch, defaultCtx, loopDeps, { maxIterations: 8 });

    const finalItem = orch.getItem("H-3");
    expect(finalItem).toBeDefined();
    expect(finalItem!.state).toBe("ci-failed");
    expect(finalItem!.ciFailCount).toBeGreaterThanOrEqual(1);
  });
});
