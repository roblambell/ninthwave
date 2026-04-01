// Tests for core/tui-keyboard.ts -- keyboard handler, controls overlay,
// WIP +/- shortcuts, and runtime control state management.

import { describe, it, expect, vi } from "vitest";
import {
  setupKeyboardShortcuts,
  pushLogBuffer,
  filterLogsByLevel,
  LOG_BUFFER_MAX,
  LOG_LEVEL_CYCLE,
  REVIEW_MODE_CYCLE,
  COLLABORATION_MODE_CYCLE,
  STRATEGY_DEBOUNCE_MS,
  type TuiState,
  type LogLevelFilter,
} from "../core/tui-keyboard.ts";
import type { MergeStrategy } from "../core/orchestrator.ts";
import {
  buildStatusLayout,
  getStatusVisibleLineRange,
  type ViewOptions,
  type PanelMode,
  type StatusItem,
  type LogEntry as PanelLogEntry,
} from "../core/status-render.ts";
import { EventEmitter } from "events";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Create a fake TTY stdin that supports raw mode and data events. */
function makeFakeStdin(): EventEmitter & { isTTY: boolean; setRawMode: ReturnType<typeof vi.fn>; resume: ReturnType<typeof vi.fn>; setEncoding: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn> } {
  const emitter = new EventEmitter() as any;
  emitter.isTTY = true;
  emitter.setRawMode = vi.fn();
  emitter.resume = vi.fn();
  emitter.setEncoding = vi.fn();
  emitter.pause = vi.fn();
  return emitter;
}

/** Create a minimal TuiState for testing. */
function makeTuiState(overrides: Partial<TuiState> = {}): TuiState {
  return {
    scrollOffset: 0,
    viewOptions: { showBlockerDetail: true },
    mergeStrategy: "manual" as MergeStrategy,
    pendingStrategy: undefined,
    pendingStrategyDeadlineMs: undefined,
    pendingStrategyTimer: undefined,
    pendingStrategyCountdownTimer: undefined,
    bypassEnabled: false,
    ctrlCPending: false,
    ctrlCTimestamp: 0,
    showHelp: false,
    showControls: false,
    controlsRowIndex: 0,
    collaborationMode: "local",
    reviewMode: "off",
    panelMode: "status-only" as PanelMode,
    logBuffer: [],
    logScrollOffset: 0,
    logLevelFilter: "all" as LogLevelFilter,
    selectedIndex: 0,
    detailItemId: null,
    detailScrollOffset: 0,
    detailContentLines: 0,
    savedLogScrollOffset: 0,
    ...overrides,
  };
}

function makeStatusItem(overrides: Partial<StatusItem> & Pick<StatusItem, "id">): StatusItem {
  return {
    ...overrides,
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    state: overrides.state ?? "implementing",
    prNumber: overrides.prNumber ?? null,
    ageMs: overrides.ageMs ?? 60_000,
    repoLabel: overrides.repoLabel ?? "ninthwave",
    dependencies: overrides.dependencies ?? [],
  };
}

function makeStatusNavigationState(
  items: StatusItem[],
  overrides: Partial<TuiState> = {},
  viewOptions: ViewOptions = { showBlockerDetail: true },
): TuiState {
  const statusLayout = buildStatusLayout(items, 100, undefined, false, viewOptions);
  const selectableItemIds = statusLayout.visibleLayout?.selectableItemIds ?? [];
  return makeTuiState({
    panelMode: "status-only",
    viewOptions,
    statusLayout,
    getItemCount: () => selectableItemIds.length,
    getSelectedItemId: (index) => selectableItemIds[index],
    ...overrides,
  });
}

// ── Log ring buffer ──────────────────────────────────────────────────────────

describe("pushLogBuffer", () => {
  it("appends entries up to LOG_BUFFER_MAX", () => {
    const buffer: PanelLogEntry[] = [];
    for (let i = 0; i < LOG_BUFFER_MAX + 10; i++) {
      pushLogBuffer(buffer, { timestamp: `t${i}`, itemId: `I-${i}`, message: `msg ${i}` });
    }
    expect(buffer.length).toBe(LOG_BUFFER_MAX);
    expect(buffer[0]!.message).toBe(`msg 10`);
  });
});

describe("filterLogsByLevel", () => {
  const buffer: PanelLogEntry[] = [
    { timestamp: "t1", itemId: "I-1", message: "[error] something failed" },
    { timestamp: "t2", itemId: "I-2", message: "[warn] something off" },
    { timestamp: "t3", itemId: "I-3", message: "[info] all good" },
    { timestamp: "t4", itemId: "I-4", message: "no prefix" },
  ];

  it("returns all entries for 'all' filter", () => {
    expect(filterLogsByLevel(buffer, "all")).toHaveLength(4);
  });

  it("filters by error level", () => {
    expect(filterLogsByLevel(buffer, "error")).toHaveLength(1);
    expect(filterLogsByLevel(buffer, "error")[0]!.message).toContain("error");
  });

  it("filters by warn level (includes error)", () => {
    expect(filterLogsByLevel(buffer, "warn")).toHaveLength(2);
  });

  it("filters by info level (includes warn, error, and untagged)", () => {
    expect(filterLogsByLevel(buffer, "info")).toHaveLength(4);
  });
});

// ── Type exports ─────────────────────────────────────────────────────────────

describe("runtime control type cycle arrays", () => {
  it("REVIEW_MODE_CYCLE contains all three modes", () => {
    expect(REVIEW_MODE_CYCLE).toEqual(["off", "ninthwave-prs", "all-prs"]);
  });

  it("COLLABORATION_MODE_CYCLE contains all three modes", () => {
    expect(COLLABORATION_MODE_CYCLE).toEqual(["local", "shared", "joined"]);
  });
});

// ── Keyboard shortcuts ───────────────────────────────────────────────────────

describe("setupKeyboardShortcuts", () => {
  it("returns a noop cleanup when stdin is not a TTY", () => {
    const ac = new AbortController();
    const cleanup = setupKeyboardShortcuts(ac, () => {}, { isTTY: false } as any);
    expect(typeof cleanup).toBe("function");
    cleanup();
    expect(ac.signal.aborted).toBe(false);
  });

  it("q key triggers abort", () => {
    const ac = new AbortController();
    const stdin = makeFakeStdin();
    const cleanup = setupKeyboardShortcuts(ac, () => {}, stdin as any);
    stdin.emit("data", "q");
    expect(ac.signal.aborted).toBe(true);
    cleanup();
  });

  it("? key toggles help overlay", () => {
    const ac = new AbortController();
    const stdin = makeFakeStdin();
    const state = makeTuiState();
    const cleanup = setupKeyboardShortcuts(ac, () => {}, stdin as any, state);

    stdin.emit("data", "?");
    expect(state.showHelp).toBe(true);
    expect(state.viewOptions.showHelp).toBe(true);

    stdin.emit("data", "?");
    expect(state.showHelp).toBe(false);
    cleanup();
  });

  it("c key toggles controls overlay", () => {
    const ac = new AbortController();
    const stdin = makeFakeStdin();
    const state = makeTuiState();
    const cleanup = setupKeyboardShortcuts(ac, () => {}, stdin as any, state);

    stdin.emit("data", "c");
    expect(state.showControls).toBe(true);
    expect(state.viewOptions.showControls).toBe(true);

    stdin.emit("data", "c");
    expect(state.showControls).toBe(false);
    expect(state.viewOptions.showControls).toBe(false);
    cleanup();
  });

  it("c key closes help when opening controls", () => {
    const ac = new AbortController();
    const stdin = makeFakeStdin();
    const state = makeTuiState({ showHelp: true });
    state.viewOptions.showHelp = true;
    const cleanup = setupKeyboardShortcuts(ac, () => {}, stdin as any, state);

    stdin.emit("data", "c");
    expect(state.showControls).toBe(true);
    expect(state.showHelp).toBe(false);
    cleanup();
  });

  it("? key closes controls when opening help", () => {
    const ac = new AbortController();
    const stdin = makeFakeStdin();
    const state = makeTuiState({ showControls: true });
    state.viewOptions.showControls = true;
    const cleanup = setupKeyboardShortcuts(ac, () => {}, stdin as any, state);

    stdin.emit("data", "?");
    expect(state.showHelp).toBe(true);
    expect(state.showControls).toBe(false);
    cleanup();
  });

  it("Escape dismisses controls overlay", () => {
    const ac = new AbortController();
    const stdin = makeFakeStdin();
    const state = makeTuiState({ showControls: true });
    state.viewOptions.showControls = true;
    const cleanup = setupKeyboardShortcuts(ac, () => {}, stdin as any, state);

    stdin.emit("data", "\x1b");
    expect(state.showControls).toBe(false);
    expect(state.viewOptions.showControls).toBe(false);
    cleanup();
  });

  it("Escape dismisses help overlay before controls", () => {
    const ac = new AbortController();
    const stdin = makeFakeStdin();
    const state = makeTuiState({ showHelp: true });
    state.viewOptions.showHelp = true;
    const cleanup = setupKeyboardShortcuts(ac, () => {}, stdin as any, state);

    stdin.emit("data", "\x1b");
    expect(state.showHelp).toBe(false);
    cleanup();
  });

  it("+ and = increase WIP via onWipChange", () => {
    const ac = new AbortController();
    const stdin = makeFakeStdin();
    const onWipChange = vi.fn();
    const state = makeTuiState({ onWipChange });
    const cleanup = setupKeyboardShortcuts(ac, () => {}, stdin as any, state);

    stdin.emit("data", "+");
    expect(onWipChange).toHaveBeenCalledWith(1);

    stdin.emit("data", "=");
    expect(onWipChange).toHaveBeenCalledTimes(2);
    expect(onWipChange).toHaveBeenLastCalledWith(1);
    cleanup();
  });

  it("- and _ decrease WIP via onWipChange", () => {
    const ac = new AbortController();
    const stdin = makeFakeStdin();
    const onWipChange = vi.fn();
    const state = makeTuiState({ onWipChange });
    const cleanup = setupKeyboardShortcuts(ac, () => {}, stdin as any, state);

    stdin.emit("data", "-");
    expect(onWipChange).toHaveBeenCalledWith(-1);

    stdin.emit("data", "_");
    expect(onWipChange).toHaveBeenCalledTimes(2);
    expect(onWipChange).toHaveBeenLastCalledWith(-1);
    cleanup();
  });

  it("+/- work while controls overlay is open", () => {
    const ac = new AbortController();
    const stdin = makeFakeStdin();
    const onWipChange = vi.fn();
    const state = makeTuiState({ showControls: true, onWipChange });
    const cleanup = setupKeyboardShortcuts(ac, () => {}, stdin as any, state);

    stdin.emit("data", "+");
    expect(onWipChange).toHaveBeenCalledWith(1);

    stdin.emit("data", "-");
    expect(onWipChange).toHaveBeenCalledWith(-1);
    cleanup();
  });

  it("Tab toggles between exactly two panel modes", () => {
    const ac = new AbortController();
    const stdin = makeFakeStdin();
    const onPanelModeChange = vi.fn();
    const state = makeTuiState({ panelMode: "status-only", onPanelModeChange });
    const cleanup = setupKeyboardShortcuts(ac, () => {}, stdin as any, state);

    stdin.emit("data", "\t");
    expect(state.panelMode).toBe("logs-only");
    expect(onPanelModeChange).toHaveBeenLastCalledWith("logs-only");

    stdin.emit("data", "\t");
    expect(state.panelMode).toBe("status-only");
    expect(onPanelModeChange).toHaveBeenLastCalledWith("status-only");

    cleanup();
  });

  it("Up/Down wrap through the visible selectable order on the status page", () => {
    const ac = new AbortController();
    const stdin = makeFakeStdin();
    const state = makeStatusNavigationState([
      makeStatusItem({ id: "B-2", state: "queued", dependencies: ["A-1"] }),
      makeStatusItem({ id: "C-3", state: "review" }),
      makeStatusItem({ id: "A-1", state: "implementing" }),
    ], {
      selectedIndex: 0,
    });
    const cleanup = setupKeyboardShortcuts(ac, () => {}, stdin as any, state);

    stdin.emit("data", "\x1b[A");
    expect(state.selectedIndex).toBe(2);
    expect(state.getSelectedItemId?.(state.selectedIndex ?? -1)).toBe("B-2");

    stdin.emit("data", "\x1b[B");
    expect(state.selectedIndex).toBe(0);
    expect(state.getSelectedItemId?.(state.selectedIndex ?? -1)).toBe("A-1");

    cleanup();
  });

  it("j/k use the same status-mode movement rules as arrow keys", () => {
    const ac = new AbortController();
    const arrowStdin = makeFakeStdin();
    const vimStdin = makeFakeStdin();
    const items = [
      makeStatusItem({ id: "B-2", state: "queued", dependencies: ["A-1"] }),
      makeStatusItem({ id: "C-3", state: "review" }),
      makeStatusItem({ id: "A-1", state: "implementing" }),
    ];
    const arrowState = makeStatusNavigationState(items, { selectedIndex: 0 });
    const vimState = makeStatusNavigationState(items, { selectedIndex: 0 });
    const arrowCleanup = setupKeyboardShortcuts(ac, () => {}, arrowStdin as any, arrowState);
    const vimCleanup = setupKeyboardShortcuts(ac, () => {}, vimStdin as any, vimState);

    arrowStdin.emit("data", "\x1b[A");
    vimStdin.emit("data", "k");
    expect(vimState.selectedIndex).toBe(arrowState.selectedIndex);
    expect(vimState.scrollOffset).toBe(arrowState.scrollOffset);

    arrowStdin.emit("data", "\x1b[B");
    vimStdin.emit("data", "j");
    expect(vimState.selectedIndex).toBe(arrowState.selectedIndex);
    expect(vimState.scrollOffset).toBe(arrowState.scrollOffset);

    arrowCleanup();
    vimCleanup();
  });

  it("Up/Down scroll logs on the logs page", () => {
    const ac = new AbortController();
    const stdin = makeFakeStdin();
    const state = makeTuiState({
      panelMode: "logs-only",
      logScrollOffset: 2,
      selectedIndex: 1,
      getItemCount: () => 4,
    });
    const cleanup = setupKeyboardShortcuts(ac, () => {}, stdin as any, state);

    stdin.emit("data", "\x1b[A");
    expect(state.logScrollOffset).toBe(1);
    expect(state.selectedIndex).toBe(1);

    stdin.emit("data", "\x1b[B");
    expect(state.logScrollOffset).toBe(2);
    expect(state.selectedIndex).toBe(1);

    cleanup();
  });

  it("j/k remain log scroll aliases on the logs page", () => {
    const ac = new AbortController();
    const stdin = makeFakeStdin();
    const state = makeTuiState({ panelMode: "logs-only", logScrollOffset: 1 });
    const cleanup = setupKeyboardShortcuts(ac, () => {}, stdin as any, state);

    stdin.emit("data", "j");
    expect(state.logScrollOffset).toBe(2);

    stdin.emit("data", "k");
    expect(state.logScrollOffset).toBe(1);

    cleanup();
  });

  it("status scrolling follows rendered line spans when blocker detail adds extra lines", () => {
    const ac = new AbortController();
    const stdin = makeFakeStdin();
    const items = [
      makeStatusItem({ id: "A-1", state: "implementing", dependencies: [] }),
      ...Array.from({ length: 7 }, (_, index) => makeStatusItem({
        id: `B-${index + 2}`,
        state: "review",
        dependencies: ["A-1"],
      })),
    ];
    const originalRows = process.stdout.rows;
    Object.defineProperty(process.stdout, "rows", { value: 12, configurable: true });
    try {
      const state = makeStatusNavigationState(items, {
        selectedIndex: 0,
        scrollOffset: 0,
      });
      const cleanup = setupKeyboardShortcuts(ac, () => {}, stdin as any, state);
      try {
        for (let i = 0; i < 7; i++) {
          stdin.emit("data", "\x1b[B");
        }

        const selectedItemId = state.getSelectedItemId?.(state.selectedIndex ?? -1);
        const span = state.statusLayout?.visibleLayout?.renderedLineSpans[selectedItemId ?? ""];
        const visibleRange = getStatusVisibleLineRange(state.statusLayout!, process.stdout.rows ?? 24, state.scrollOffset);

        expect(selectedItemId).toBe("B-8");
        expect(span).toBeDefined();
        expect(span!.startLineIndex).toBeGreaterThan(state.selectedIndex ?? 0);
        expect(state.scrollOffset).toBeGreaterThan(state.selectedIndex ?? 0);
        expect(span!.startLineIndex).toBeGreaterThanOrEqual(visibleRange.visibleStartLineIndex);
        expect(span!.endLineIndex).toBeLessThanOrEqual(visibleRange.visibleEndLineIndex);
      } finally {
        cleanup();
      }
    } finally {
      Object.defineProperty(process.stdout, "rows", { value: originalRows, configurable: true });
    }
  });
});

// ── Controls overlay row navigation ─────────────────────────────────────────

describe("controls overlay row navigation", () => {
  it("Up/Down move between setting rows", () => {
    const ac = new AbortController();
    const stdin = makeFakeStdin();
    const state = makeTuiState({ showControls: true, controlsRowIndex: 0 });
    const cleanup = setupKeyboardShortcuts(ac, () => {}, stdin as any, state);

    stdin.emit("data", "\x1b[B");
    expect(state.controlsRowIndex).toBe(1);

    stdin.emit("data", "\x1b[B");
    expect(state.controlsRowIndex).toBe(2);

    stdin.emit("data", "\x1b[A");
    expect(state.controlsRowIndex).toBe(1);

    stdin.emit("data", "\x1b[A");
    stdin.emit("data", "\x1b[A");
    expect(state.controlsRowIndex).toBe(0);
    cleanup();
  });

  it("Left/Right change collaboration mode on the active row", () => {
    const ac = new AbortController();
    const stdin = makeFakeStdin();
    const onCollaborationChange = vi.fn();
    const onUpdate = vi.fn();
    const state = makeTuiState({
      showControls: true,
      controlsRowIndex: 0,
      collaborationMode: "local",
      onCollaborationChange,
      onUpdate,
    });
    state.viewOptions.collaborationMode = "local";
    const cleanup = setupKeyboardShortcuts(ac, () => {}, stdin as any, state);

    stdin.emit("data", "\x1b[C");
    expect(state.collaborationMode).toBe("shared");
    expect(state.viewOptions.collaborationMode).toBe("shared");
    expect(onCollaborationChange).toHaveBeenCalledWith("shared");
    expect(onUpdate).toHaveBeenCalled();

    stdin.emit("data", "\x1b[D");
    expect(state.collaborationMode).toBe("local");
    expect(onCollaborationChange).toHaveBeenCalledWith("local");
    cleanup();
  });

  it("Left/Right change review mode on the active row", () => {
    const ac = new AbortController();
    const stdin = makeFakeStdin();
    const onReviewChange = vi.fn();
    const state = makeTuiState({
      showControls: true,
      controlsRowIndex: 1,
      reviewMode: "off",
      onReviewChange,
    });
    state.viewOptions.reviewMode = "off";
    const cleanup = setupKeyboardShortcuts(ac, () => {}, stdin as any, state);

    stdin.emit("data", "\x1b[C");
    expect(state.reviewMode).toBe("ninthwave-prs");
    expect(state.viewOptions.reviewMode).toBe("ninthwave-prs");
    expect(onReviewChange).toHaveBeenCalledWith("ninthwave-prs");

    stdin.emit("data", "\x1b[C");
    expect(state.reviewMode).toBe("all-prs");
    expect(onReviewChange).toHaveBeenCalledWith("all-prs");

    stdin.emit("data", "\x1b[D");
    expect(state.reviewMode).toBe("ninthwave-prs");
    cleanup();
  });

  it("Left/Right queue merge strategy changes on the active row", () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    const stdin = makeFakeStdin();
    const onStrategyChange = vi.fn();
    const state = makeTuiState({
      showControls: true,
      controlsRowIndex: 2,
      mergeStrategy: "manual",
      onStrategyChange,
    });
    state.viewOptions.mergeStrategy = "manual";
    const cleanup = setupKeyboardShortcuts(ac, () => {}, stdin as any, state);

    stdin.emit("data", "\x1b[C");
    expect(state.mergeStrategy).toBe("manual");
    expect(state.pendingStrategy).toBe("auto");
    expect(onStrategyChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(STRATEGY_DEBOUNCE_MS + 1);
    expect(state.mergeStrategy).toBe("auto");
    expect(state.pendingStrategy).toBeUndefined();
    expect(onStrategyChange).toHaveBeenCalledWith("auto");

    cleanup();
    vi.useRealTimers();
  });

  it("Left/Right adjust WIP limit on the active row", () => {
    const ac = new AbortController();
    const stdin = makeFakeStdin();
    const onWipChange = vi.fn();
    const state = makeTuiState({
      showControls: true,
      controlsRowIndex: 3,
      onWipChange,
    });
    const cleanup = setupKeyboardShortcuts(ac, () => {}, stdin as any, state);

    stdin.emit("data", "\x1b[C");
    expect(onWipChange).toHaveBeenCalledWith(1);

    stdin.emit("data", "\x1b[D");
    expect(onWipChange).toHaveBeenCalledWith(-1);
    cleanup();
  });

  it("Enter dismisses the controls overlay", () => {
    const ac = new AbortController();
    const stdin = makeFakeStdin();
    const state = makeTuiState({ showControls: true });
    state.viewOptions.showControls = true;
    const cleanup = setupKeyboardShortcuts(ac, () => {}, stdin as any, state);

    stdin.emit("data", "\r");
    expect(state.showControls).toBe(false);
    expect(state.viewOptions.showControls).toBe(false);
    cleanup();
  });

  it("number keys do nothing even while controls are open", () => {
    const ac = new AbortController();
    const stdin = makeFakeStdin();
    const onCollaborationChange = vi.fn();
    const state = makeTuiState({
      showControls: true,
      collaborationMode: "local",
      onCollaborationChange,
    });
    const cleanup = setupKeyboardShortcuts(ac, () => {}, stdin as any, state);

    stdin.emit("data", "2");
    expect(state.collaborationMode).toBe("local");
    expect(onCollaborationChange).not.toHaveBeenCalled();
    cleanup();
  });
});

// ── Shift+Tab merge strategy cycle ───────────────────────────────────────────

describe("Shift+Tab merge strategy cycle", () => {
  it("sets pending strategy without applying immediately", () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    const stdin = makeFakeStdin();
    const onStrategyChange = vi.fn();
    const state = makeTuiState({
      mergeStrategy: "auto",
      bypassEnabled: false,
      onStrategyChange,
    });
    const cleanup = setupKeyboardShortcuts(ac, () => {}, stdin as any, state);

    stdin.emit("data", "\x1B[Z"); // Shift+Tab
    expect(state.mergeStrategy).toBe("auto");
    expect(state.pendingStrategy).toBe("manual");
    expect(state.viewOptions.pendingStrategy).toBe("manual");
    expect(state.viewOptions.pendingStrategyCountdownSeconds).toBe(5);
    expect(onStrategyChange).not.toHaveBeenCalled();

    cleanup();
    vi.useRealTimers();
  });

  it("resets the debounce timer on rapid Shift+Tab presses", () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    const stdin = makeFakeStdin();
    const onStrategyChange = vi.fn();
    const state = makeTuiState({
      mergeStrategy: "auto",
      bypassEnabled: false,
      onStrategyChange,
    });
    const cleanup = setupKeyboardShortcuts(ac, () => {}, stdin as any, state);

    stdin.emit("data", "\x1B[Z");
    vi.advanceTimersByTime(STRATEGY_DEBOUNCE_MS - 1000);

    stdin.emit("data", "\x1B[Z");
    expect(state.pendingStrategy).toBeUndefined();
    expect(state.mergeStrategy).toBe("auto");

    vi.advanceTimersByTime(1000);
    expect(onStrategyChange).not.toHaveBeenCalled();
    expect(state.mergeStrategy).toBe("auto");

    cleanup();
    vi.useRealTimers();
  });

  it("applies the final strategy after the debounce period", () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    const stdin = makeFakeStdin();
    const onStrategyChange = vi.fn();
    const state = makeTuiState({
      mergeStrategy: "auto",
      bypassEnabled: true,
      onStrategyChange,
    });
    const cleanup = setupKeyboardShortcuts(ac, () => {}, stdin as any, state);

    stdin.emit("data", "\x1B[Z");
    stdin.emit("data", "\x1B[Z");
    expect(state.pendingStrategy).toBe("bypass");

    vi.advanceTimersByTime(STRATEGY_DEBOUNCE_MS + 1);
    expect(state.mergeStrategy).toBe("bypass");
    expect(state.pendingStrategy).toBeUndefined();
    expect(onStrategyChange).toHaveBeenCalledTimes(1);
    expect(onStrategyChange).toHaveBeenCalledWith("bypass");

    cleanup();
    vi.useRealTimers();
  });

  it("updates the pending strategy countdown and clears it after apply", () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    const stdin = makeFakeStdin();
    const onStrategyChange = vi.fn();
    const countdowns: Array<number | undefined> = [];
    let state!: TuiState;
    const onUpdate = () => {
      countdowns.push(state.viewOptions.pendingStrategyCountdownSeconds);
    };
    state = makeTuiState({
      mergeStrategy: "auto",
      bypassEnabled: false,
      onStrategyChange,
      onUpdate,
    });
    const cleanup = setupKeyboardShortcuts(ac, () => {}, stdin as any, state);

    stdin.emit("data", "\x1B[Z");
    expect(state.pendingStrategy).toBe("manual");
    expect(state.viewOptions.pendingStrategyCountdownSeconds).toBe(5);

    vi.advanceTimersByTime(1000);
    expect(state.viewOptions.pendingStrategyCountdownSeconds).toBe(4);
    vi.advanceTimersByTime(1000);
    expect(state.viewOptions.pendingStrategyCountdownSeconds).toBe(3);
    vi.advanceTimersByTime(1000);
    expect(state.viewOptions.pendingStrategyCountdownSeconds).toBe(2);
    vi.advanceTimersByTime(1000);
    expect(state.viewOptions.pendingStrategyCountdownSeconds).toBe(1);
    vi.advanceTimersByTime(1000);

    expect(countdowns).toContain(0);
    expect(state.mergeStrategy).toBe("auto");
    expect(state.pendingStrategy).toBe("manual");
    expect(state.viewOptions.pendingStrategy).toBe("manual");
    expect(state.viewOptions.pendingStrategyCountdownSeconds).toBe(0);

    vi.advanceTimersByTime(1);

    expect(state.mergeStrategy).toBe("manual");
    expect(state.pendingStrategy).toBeUndefined();
    expect(state.viewOptions.pendingStrategy).toBeUndefined();
    expect(state.viewOptions.pendingStrategyCountdownSeconds).toBeUndefined();
    expect(onStrategyChange).toHaveBeenCalledWith("manual");

    cleanup();
    vi.useRealTimers();
  });

  it("includes bypass in cycle when enabled", () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    const stdin = makeFakeStdin();
    const state = makeTuiState({
      mergeStrategy: "manual",
      bypassEnabled: true,
    });
    const cleanup = setupKeyboardShortcuts(ac, () => {}, stdin as any, state);

    stdin.emit("data", "\x1B[Z");
    expect(state.pendingStrategy).toBe("bypass");
    vi.advanceTimersByTime(STRATEGY_DEBOUNCE_MS + 1);
    expect(state.mergeStrategy).toBe("bypass");

    stdin.emit("data", "\x1B[Z");
    vi.advanceTimersByTime(STRATEGY_DEBOUNCE_MS + 1);
    expect(state.mergeStrategy).toBe("auto");
    cleanup();
    vi.useRealTimers();
  });
});

// ── Cleanup ──────────────────────────────────────────────────────────────────

describe("cleanup function", () => {
  it("restores terminal state and pauses stdin", () => {
    const ac = new AbortController();
    const stdin = makeFakeStdin();
    const state = makeTuiState();
    const cleanup = setupKeyboardShortcuts(ac, () => {}, stdin as any, state);

    cleanup();
    expect(stdin.setRawMode).toHaveBeenCalledWith(false);
    expect(stdin.pause).toHaveBeenCalled();
  });

  it("clears the pending strategy timer on cleanup", () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    const stdin = makeFakeStdin();
    const onStrategyChange = vi.fn();
    const state = makeTuiState({
      mergeStrategy: "auto",
      onStrategyChange,
    });
    const cleanup = setupKeyboardShortcuts(ac, () => {}, stdin as any, state);

    stdin.emit("data", "\x1B[Z");
    expect(state.pendingStrategyTimer).toBeDefined();

    cleanup();
    vi.advanceTimersByTime(STRATEGY_DEBOUNCE_MS);

    expect(state.pendingStrategyCountdownTimer).toBeUndefined();
    expect(state.pendingStrategyDeadlineMs).toBeUndefined();
    expect(state.pendingStrategyTimer).toBeUndefined();
    expect(state.pendingStrategy).toBeUndefined();
    expect(state.viewOptions.pendingStrategyCountdownSeconds).toBeUndefined();
    expect(onStrategyChange).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

// ── Detail overlay scroll ────────────────────────────────────────────────────

describe("detail overlay scroll keys", () => {
  it("down arrow scrolls detail content when overlay is open", () => {
    const ac = new AbortController();
    const stdin = makeFakeStdin();
    const state = makeTuiState({
      detailItemId: "X-1",
      detailScrollOffset: 0,
      detailContentLines: 500, // enough to overflow any terminal
    });
    const cleanup = setupKeyboardShortcuts(ac, () => {}, stdin as any, state);

    stdin.emit("data", "\x1b[B"); // Down arrow
    expect(state.detailScrollOffset).toBe(1);
    // Selection should NOT have moved
    expect(state.selectedIndex).toBe(0);
    cleanup();
  });

  it("up arrow scrolls detail content up when overlay is open", () => {
    const ac = new AbortController();
    const stdin = makeFakeStdin();
    const state = makeTuiState({
      detailItemId: "X-1",
      detailScrollOffset: 5,
      detailContentLines: 500,
    });
    const cleanup = setupKeyboardShortcuts(ac, () => {}, stdin as any, state);

    stdin.emit("data", "\x1b[A"); // Up arrow
    expect(state.detailScrollOffset).toBe(4);
    cleanup();
  });

  it("up arrow does not scroll below 0", () => {
    const ac = new AbortController();
    const stdin = makeFakeStdin();
    const state = makeTuiState({
      detailItemId: "X-1",
      detailScrollOffset: 0,
      detailContentLines: 500,
    });
    const cleanup = setupKeyboardShortcuts(ac, () => {}, stdin as any, state);

    stdin.emit("data", "\x1b[A");
    expect(state.detailScrollOffset).toBe(0);
    cleanup();
  });

  it("j scrolls detail content down when overlay is open", () => {
    const ac = new AbortController();
    const stdin = makeFakeStdin();
    const state = makeTuiState({
      detailItemId: "X-1",
      detailScrollOffset: 2,
      detailContentLines: 500,
    });
    const cleanup = setupKeyboardShortcuts(ac, () => {}, stdin as any, state);

    stdin.emit("data", "j");
    expect(state.detailScrollOffset).toBe(3);
    // Log panel should not have scrolled
    expect(state.logScrollOffset).toBe(0);
    cleanup();
  });

  it("k scrolls detail content up when overlay is open", () => {
    const ac = new AbortController();
    const stdin = makeFakeStdin();
    const state = makeTuiState({
      detailItemId: "X-1",
      detailScrollOffset: 3,
      detailContentLines: 500,
    });
    const cleanup = setupKeyboardShortcuts(ac, () => {}, stdin as any, state);

    stdin.emit("data", "k");
    expect(state.detailScrollOffset).toBe(2);
    cleanup();
  });

  it("G jumps to end of detail content when overlay is open", () => {
    const ac = new AbortController();
    const stdin = makeFakeStdin();
    const state = makeTuiState({
      detailItemId: "X-1",
      detailScrollOffset: 0,
      detailContentLines: 500,
    });
    const cleanup = setupKeyboardShortcuts(ac, () => {}, stdin as any, state);

    stdin.emit("data", "G");
    expect(state.detailScrollOffset).toBeGreaterThan(0);
    cleanup();
  });

  it("Escape closes detail overlay and resets scroll offset", () => {
    const ac = new AbortController();
    const stdin = makeFakeStdin();
    const state = makeTuiState({
      detailItemId: "X-1",
      detailScrollOffset: 10,
      savedLogScrollOffset: 5,
    });
    const cleanup = setupKeyboardShortcuts(ac, () => {}, stdin as any, state);

    stdin.emit("data", "\x1b");
    expect(state.detailItemId).toBeNull();
    expect(state.detailScrollOffset).toBe(0);
    expect(state.logScrollOffset).toBe(5); // restored
    cleanup();
  });

  it("Enter opens detail and resets detailScrollOffset to 0", () => {
    const ac = new AbortController();
    const stdin = makeFakeStdin();
    const state = makeTuiState({
      selectedIndex: 0,
      detailItemId: null,
      detailScrollOffset: 5, // stale from previous open
      getSelectedItemId: () => "X-2",
    });
    const cleanup = setupKeyboardShortcuts(ac, () => {}, stdin as any, state);

    stdin.emit("data", "\r");
    expect(state.detailItemId).toBe("X-2");
    expect(state.detailScrollOffset).toBe(0);
    cleanup();
  });

  it("closing overlay restores list navigation (arrows move selection, not detail scroll)", () => {
    const ac = new AbortController();
    const stdin = makeFakeStdin();
    const state = makeTuiState({
      detailItemId: "X-1",
      detailScrollOffset: 3,
      selectedIndex: 1,
      getItemCount: () => 5,
    });
    const cleanup = setupKeyboardShortcuts(ac, () => {}, stdin as any, state);

    // Close overlay
    stdin.emit("data", "\x1b");
    expect(state.detailItemId).toBeNull();

    // Now arrows should move selection
    stdin.emit("data", "\x1b[B"); // Down
    expect(state.selectedIndex).toBe(2);
    cleanup();
  });

  it("down arrow does not scroll if content fits in viewport (no overflow)", () => {
    const ac = new AbortController();
    const stdin = makeFakeStdin();
    const state = makeTuiState({
      detailItemId: "X-1",
      detailScrollOffset: 0,
      detailContentLines: 5, // very short, fits in any terminal
    });
    const cleanup = setupKeyboardShortcuts(ac, () => {}, stdin as any, state);

    stdin.emit("data", "\x1b[B");
    expect(state.detailScrollOffset).toBe(0);
    cleanup();
  });
});
