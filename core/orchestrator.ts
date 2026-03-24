// Orchestrator state machine for parallel TODO processing.
// Pure — processTransitions takes a snapshot and returns actions, no side effects.

import type { TodoItem } from "./types.ts";

// ── State types ──────────────────────────────────────────────────────

export type OrchestratorItemState =
  | "queued"
  | "ready"
  | "launching"
  | "implementing"
  | "pr-open"
  | "ci-pending"
  | "ci-passed"
  | "ci-failed"
  | "review-pending"
  | "merging"
  | "merged"
  | "done"
  | "stuck";

export type MergeStrategy = "asap" | "approved" | "ask";

// ── Interfaces ───────────────────────────────────────────────────────

export interface OrchestratorItem {
  id: string;
  todo: TodoItem;
  state: OrchestratorItemState;
  prNumber?: number;
  partition?: number;
  /** Timestamp of last state change (ISO string). */
  lastTransition: string;
  /** Number of times CI has failed for this item. */
  ciFailCount: number;
}

export interface OrchestratorConfig {
  /** Max concurrent items in launching/implementing/pr-open/ci-pending/ci-passed/ci-failed/review-pending states. */
  wipLimit: number;
  /** When to auto-merge: asap (CI pass), approved (CI + review), ask (never auto). */
  mergeStrategy: MergeStrategy;
  /** Max CI failures before marking stuck. */
  maxCiRetries: number;
}

// ── Poll snapshot ────────────────────────────────────────────────────

/** External state for a single item, gathered from gh/cmux polling. */
export interface ItemSnapshot {
  id: string;
  prNumber?: number;
  /** CI status from GitHub checks. */
  ciStatus?: "pass" | "fail" | "pending" | "unknown";
  /** Review decision from GitHub. */
  reviewDecision?: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | "";
  /** PR state from GitHub. */
  prState?: "open" | "closed" | "merged";
  /** Whether the PR is mergeable. */
  isMergeable?: boolean;
  /** Whether the worker session is alive. */
  workerAlive?: boolean;
}

export interface PollSnapshot {
  items: ItemSnapshot[];
  /** IDs of items whose dependencies are all in 'done' state. */
  readyIds: string[];
}

// ── Actions ──────────────────────────────────────────────────────────

export type ActionType = "launch" | "merge" | "notify" | "clean" | "rebase";

export interface Action {
  type: ActionType;
  itemId: string;
  /** For merge actions, the PR number. */
  prNumber?: number;
  /** For notify actions, the message to send. */
  message?: string;
}

// ── Default config ───────────────────────────────────────────────────

export const DEFAULT_CONFIG: OrchestratorConfig = {
  wipLimit: 4,
  mergeStrategy: "asap",
  maxCiRetries: 2,
};

// ── WIP states: states that count toward the WIP limit ───────────────

const WIP_STATES: Set<OrchestratorItemState> = new Set([
  "launching",
  "implementing",
  "pr-open",
  "ci-pending",
  "ci-passed",
  "ci-failed",
  "review-pending",
  "merging",
]);

// ── Orchestrator class ───────────────────────────────────────────────

export class Orchestrator {
  readonly config: OrchestratorConfig;
  private items: Map<string, OrchestratorItem> = new Map();

  constructor(config: Partial<OrchestratorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Add a TODO item to orchestration. Starts in 'queued' state. */
  addItem(todo: TodoItem, partition?: number): void {
    this.items.set(todo.id, {
      id: todo.id,
      todo,
      state: "queued",
      partition,
      lastTransition: new Date().toISOString(),
      ciFailCount: 0,
    });
  }

  /** Get the current state of an item. */
  getItem(id: string): OrchestratorItem | undefined {
    return this.items.get(id);
  }

  /** Get all items. */
  getAllItems(): OrchestratorItem[] {
    return Array.from(this.items.values());
  }

  /** Get items in a specific state. */
  getItemsByState(state: OrchestratorItemState): OrchestratorItem[] {
    return this.getAllItems().filter((item) => item.state === state);
  }

  /** Directly set an item's state (for external updates like launch confirmation). */
  setState(id: string, state: OrchestratorItemState): void {
    const item = this.items.get(id);
    if (!item) return;
    item.state = state;
    item.lastTransition = new Date().toISOString();
  }

  /** Count of items in WIP states (counts toward limit). */
  get wipCount(): number {
    return this.getAllItems().filter((item) => WIP_STATES.has(item.state))
      .length;
  }

  /** How many more items can be launched without exceeding WIP limit. */
  get wipSlots(): number {
    return Math.max(0, this.config.wipLimit - this.wipCount);
  }

  /**
   * Pure state machine transition function.
   * Takes a poll snapshot (external state) and returns actions to execute.
   * Does NOT execute the actions — the caller is responsible for that.
   */
  processTransitions(snapshot: PollSnapshot): Action[] {
    const actions: Action[] = [];

    // Build lookup for snapshot items
    const snapshotMap = new Map<string, ItemSnapshot>();
    for (const s of snapshot.items) {
      snapshotMap.set(s.id, s);
    }

    // Process each tracked item against the snapshot
    for (const item of this.getAllItems()) {
      const snap = snapshotMap.get(item.id);
      const newActions = this.transitionItem(item, snap);
      actions.push(...newActions);
    }

    // Promote queued → ready for items whose deps are met
    for (const item of this.getItemsByState("queued")) {
      if (snapshot.readyIds.includes(item.id)) {
        this.transition(item, "ready");
      }
    }

    // Launch ready items up to WIP limit
    const launchActions = this.launchReadyItems();
    actions.push(...launchActions);

    return actions;
  }

  // ── Private helpers ────────────────────────────────────────────

  /** Set state and update timestamp. */
  private transition(item: OrchestratorItem, state: OrchestratorItemState): void {
    item.state = state;
    item.lastTransition = new Date().toISOString();
  }

  /** Transition a single item based on its snapshot. Returns actions. */
  private transitionItem(
    item: OrchestratorItem,
    snap: ItemSnapshot | undefined,
  ): Action[] {
    switch (item.state) {
      case "queued":
      case "ready":
        // Handled in bulk in processTransitions
        return [];

      case "launching":
        if (snap?.workerAlive) {
          this.transition(item, "implementing");
        }
        return [];

      case "implementing":
        return this.handleImplementing(item, snap);

      case "pr-open":
      case "ci-pending":
      case "ci-passed":
      case "ci-failed":
        return this.handlePrLifecycle(item, snap);

      case "review-pending":
        return this.handleReviewPending(item, snap);

      case "merging":
        return this.handleMerging(item, snap);

      case "merged":
        this.transition(item, "done");
        return [];

      case "done":
      case "stuck":
        return [];
    }
  }

  /** Handle implementing state. */
  private handleImplementing(
    item: OrchestratorItem,
    snap: ItemSnapshot | undefined,
  ): Action[] {
    // If a PR appeared, move to pr-open
    if (snap?.prNumber && snap.prState === "open") {
      item.prNumber = snap.prNumber;
      this.transition(item, "pr-open");
      // Fall through to handle CI status in the same cycle
      return this.handlePrLifecycle(item, snap);
    }
    // If worker died without a PR, mark stuck
    if (snap && snap.workerAlive === false && !snap.prNumber) {
      this.transition(item, "stuck");
    }
    return [];
  }

  /**
   * Unified handler for pr-open / ci-pending / ci-passed / ci-failed.
   * Chains transitions within a single cycle so CI pass → merge happens immediately.
   */
  private handlePrLifecycle(
    item: OrchestratorItem,
    snap: ItemSnapshot | undefined,
  ): Action[] {
    const actions: Action[] = [];

    // Check for external merge first (takes priority)
    if (snap?.prState === "merged") {
      this.transition(item, "merged");
      actions.push({ type: "clean", itemId: item.id });
      return actions;
    }

    // Resolve the effective CI status from the snapshot
    const ciStatus = snap?.ciStatus;

    // Handle ci-failed special cases first
    if (item.state === "ci-failed") {
      if (item.ciFailCount > this.config.maxCiRetries) {
        this.transition(item, "stuck");
        return [];
      }
      // If CI recovered, transition and continue processing
      if (ciStatus === "pass") {
        this.transition(item, "ci-passed");
      } else if (ciStatus === "pending") {
        this.transition(item, "ci-pending");
        return [];
      } else {
        return []; // Still failing, no action needed
      }
    }

    // Determine the new CI-based state
    if (ciStatus === "fail") {
      this.transition(item, "ci-failed");
      item.ciFailCount++;
      actions.push({
        type: "notify",
        itemId: item.id,
        prNumber: item.prNumber,
        message: "CI failed — please investigate and fix.",
      });
      return actions;
    }

    if (ciStatus === "pending" && item.state !== "ci-pending") {
      this.transition(item, "ci-pending");
      return [];
    }

    if (ciStatus === "pass") {
      if (item.state !== "ci-passed") {
        this.transition(item, "ci-passed");
      }
      // CI passed — evaluate merge strategy
      actions.push(...this.evaluateMerge(item, snap));
      return actions;
    }

    // No CI status change or unknown — stay in current state
    // But if we're already in ci-passed, re-evaluate merge
    if (item.state === "ci-passed") {
      actions.push(...this.evaluateMerge(item, snap));
    }

    return actions;
  }

  /** Handle review-pending state. */
  private handleReviewPending(
    item: OrchestratorItem,
    snap: ItemSnapshot | undefined,
  ): Action[] {
    const actions: Action[] = [];

    // Check for external merge
    if (snap?.prState === "merged") {
      this.transition(item, "merged");
      actions.push({ type: "clean", itemId: item.id });
      return actions;
    }

    // If review approved and CI still passes, evaluate merge
    if (snap?.reviewDecision === "APPROVED" && snap?.ciStatus === "pass") {
      actions.push(...this.evaluateMerge(item, snap));
    }

    return actions;
  }

  /** Handle merging state. */
  private handleMerging(
    item: OrchestratorItem,
    snap: ItemSnapshot | undefined,
  ): Action[] {
    const actions: Action[] = [];

    if (snap?.prState === "merged") {
      this.transition(item, "merged");
      actions.push({ type: "clean", itemId: item.id });
    }

    return actions;
  }

  /** Evaluate whether to merge based on merge strategy. */
  private evaluateMerge(
    item: OrchestratorItem,
    snap: ItemSnapshot | undefined,
  ): Action[] {
    const actions: Action[] = [];

    switch (this.config.mergeStrategy) {
      case "asap":
        // Merge as soon as CI passes
        this.transition(item, "merging");
        actions.push({
          type: "merge",
          itemId: item.id,
          prNumber: item.prNumber,
        });
        break;

      case "approved":
        // Need review approval before merging
        if (snap?.reviewDecision === "APPROVED") {
          this.transition(item, "merging");
          actions.push({
            type: "merge",
            itemId: item.id,
            prNumber: item.prNumber,
          });
        } else if (item.state !== "review-pending") {
          // Move to review-pending to wait for approval
          this.transition(item, "review-pending");
        }
        break;

      case "ask":
        // Never auto-merge — just move to review-pending
        if (item.state !== "review-pending") {
          this.transition(item, "review-pending");
        }
        break;
    }

    return actions;
  }

  /** Launch ready items up to WIP limit. Returns launch actions. */
  private launchReadyItems(): Action[] {
    const actions: Action[] = [];
    const readyItems = this.getItemsByState("ready");
    const slotsAvailable = this.wipSlots;

    for (let i = 0; i < Math.min(readyItems.length, slotsAvailable); i++) {
      const item = readyItems[i]!;
      this.transition(item, "launching");
      actions.push({ type: "launch", itemId: item.id });
    }

    return actions;
  }
}
