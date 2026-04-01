// TUI keyboard handling: raw-mode stdin listener, scroll/strategy/panel key bindings.
// Also houses log ring-buffer utilities and LogLevelFilter type used by the TUI log panel.
// Extracted from core/commands/orchestrate.ts for modularity.

import type { MergeStrategy } from "./orchestrator.ts";
import type { LogEntry } from "./types.ts";
import {
  type ViewOptions,
  type PanelMode,
  type LogEntry as PanelLogEntry,
  getTerminalHeight,
  clampScrollOffset,
  detailOverlayMaxScroll,
} from "./status-render.ts";
import {
  TUI_SETTINGS_ROWS,
  runtimeOptionsForSettingsRow,
  type CollaborationMode,
  type ReviewMode,
} from "./tui-settings.ts";

// ── Log ring buffer ────────────────────────────────────────────────

/** Maximum number of log entries retained in the ring buffer for the TUI log panel. */
export const LOG_BUFFER_MAX = 500;

/** Log level filter cycle order for the `l` keyboard shortcut. */
export type LogLevelFilter = "info" | "warn" | "error" | "all";

/** The cycle order for log level filter. */
export const LOG_LEVEL_CYCLE: LogLevelFilter[] = ["info", "warn", "error", "all"];

/** Severity ordering for log level filtering. */
const LOG_LEVEL_SEVERITY: Record<string, number> = {
  error: 3,
  warn: 2,
  info: 1,
  debug: 0,
};

/**
 * Push a log entry into the ring buffer, dropping the oldest entry when at capacity.
 * Mutates the buffer in-place for efficiency.
 */
export function pushLogBuffer(buffer: PanelLogEntry[], entry: PanelLogEntry): void {
  buffer.push(entry);
  if (buffer.length > LOG_BUFFER_MAX) {
    buffer.splice(0, buffer.length - LOG_BUFFER_MAX);
  }
}

/**
 * Filter log entries by level.
 * "all" returns everything. Otherwise returns entries at or above the given severity.
 */
export function filterLogsByLevel(buffer: PanelLogEntry[], filter: LogLevelFilter): PanelLogEntry[] {
  if (filter === "all") return buffer;
  const minSeverity = LOG_LEVEL_SEVERITY[filter] ?? 0;
  // PanelLogEntry doesn't have a level field -- we encode it in the message prefix.
  // We'll match by checking if the message starts with a level tag like "[error]" or "[warn]".
  // If no tag is found, assume "info" level.
  return buffer.filter((entry) => {
    const level = extractLogLevel(entry.message);
    return (LOG_LEVEL_SEVERITY[level] ?? 1) >= minSeverity;
  });
}

/**
 * Extract the log level from a message string.
 * Messages may be prefixed with [error], [warn], [info], [debug].
 * Falls back to "info" if no prefix found.
 */
function extractLogLevel(message: string): string {
  const match = message.match(/^\[(error|warn|info|debug)\]\s*/);
  return match ? match[1]! : "info";
}

// Re-export runtime control types from status-render for consumers
export type { CollaborationMode, ReviewMode } from "./tui-settings.ts";
export { REVIEW_MODE_CYCLE, COLLABORATION_MODE_CYCLE } from "./tui-settings.ts";

/** Debounce window for merge strategy changes triggered from the TUI. */
export const STRATEGY_DEBOUNCE_MS = 5000;

// ── TUI keyboard state ────────────────────────────────────────────

/** Shared mutable state for TUI keyboard shortcuts and scroll. */
export interface TuiState {
  scrollOffset: number;
  viewOptions: ViewOptions;
  /** Current merge strategy (per-daemon, cycled via Shift+Tab). */
  mergeStrategy: MergeStrategy;
  /** Pending merge strategy selection waiting for debounce to settle. */
  pendingStrategy?: MergeStrategy;
  /** Absolute deadline for the pending strategy debounce window. */
  pendingStrategyDeadlineMs?: number;
  /** Timer for the pending merge strategy debounce window. */
  pendingStrategyTimer?: ReturnType<typeof setTimeout>;
  /** Once-per-second ticker for the pending strategy countdown. */
  pendingStrategyCountdownTimer?: ReturnType<typeof setInterval>;
  /** Whether bypass is available in the cycle (from --dangerously-bypass). */
  bypassEnabled: boolean;
  /** First Ctrl+C pressed -- waiting for confirmation. */
  ctrlCPending: boolean;
  /** Timestamp of the first Ctrl+C press (for 2s timeout). */
  ctrlCTimestamp: number;
  /** Whether the help overlay is visible. */
  showHelp: boolean;
  /** Whether the controls overlay is visible. */
  showControls: boolean;
  /** Active row cursor within the controls overlay (0-based). */
  controlsRowIndex?: number;
  /** Current collaboration mode (per-run, not persisted). */
  collaborationMode: CollaborationMode;
  /** Current AI review mode (per-run, not persisted). */
  reviewMode: ReviewMode;
  /** Active page mode: status-only or logs-only. */
  panelMode: PanelMode;
  /** Ring buffer of log entries for the TUI log panel (max LOG_BUFFER_MAX). */
  logBuffer: PanelLogEntry[];
  /** Scroll offset within the log panel. */
  logScrollOffset: number;
  /** Current log level filter. */
  logLevelFilter: LogLevelFilter;
  /** Selected item index in the visible item list (0-based). Defaults to 0. */
  selectedIndex?: number;
  /** Item ID currently shown in the detail panel (null = log panel visible). */
  detailItemId?: string | null;
  /** Scroll offset within the detail overlay content (0 = top). */
  detailScrollOffset?: number;
  /** Saved log scroll offset, restored when returning from detail view. */
  savedLogScrollOffset?: number;
  /** Total content lines in the current detail overlay (set by render loop for clamping). */
  detailContentLines?: number;
  /** Called after a debounced merge strategy change is applied. */
  onStrategyChange?: (strategy: MergeStrategy) => void;
  /** Called when the user cycles panel mode via Tab (for preference persistence). */
  onPanelModeChange?: (mode: PanelMode) => void;
  /** Called when the user presses +/- to adjust WIP limit. Receives the delta (+1 or -1). */
  onWipChange?: (delta: number) => void;
  /** Called when the review mode changes from the controls overlay. */
  onReviewChange?: (mode: ReviewMode) => void;
  /** Called when the collaboration mode changes from the controls overlay. */
  onCollaborationChange?: (mode: CollaborationMode) => void;
  /** Called after any key that should trigger an immediate re-render. */
  onUpdate?: () => void;
  /** Resolve item ID at the given index in the visible item list. */
  getSelectedItemId?: (index: number) => string | undefined;
  /** Extend timeout for the currently selected item in grace period. */
  onExtendTimeout?: (itemId: string) => boolean;
  /** Get total number of items for clamping selectedIndex. */
  getItemCount?: () => number;
  /** Session code (if sharing via ninthwave.sh). Shown in help overlay. */
  sessionCode?: string;
  /** Tmux session name (when running outside tmux). Shown in help overlay. */
  tmuxSessionName?: string;
}

/**
 * Set up raw-mode stdin to capture individual keystrokes in TUI mode.
 *
 * - `q` triggers graceful shutdown via the AbortController
 * - Ctrl-C (0x03) triggers the same graceful shutdown
 * - `m` toggles metrics panel
 * - `d` toggles deps detail view
 * - `?` toggles full-screen help overlay
 * - Escape dismisses help overlay (raw `\x1b`, not arrow key sequences)
 * - Up/Down arrows are page-aware: navigate items or scroll logs
 *
 * Returns a cleanup function that restores terminal state.
 * Only call this when tuiMode is true and stdin is a TTY.
 */
export function setupKeyboardShortcuts(
  abortController: AbortController,
  log: (entry: LogEntry) => void,
  stdin: NodeJS.ReadStream = process.stdin,
  tuiState?: TuiState,
): () => void {
  if (!stdin.isTTY || !stdin.setRawMode) {
    return () => {};
  }

  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  // Timer for Ctrl+C double-tap timeout (clear ctrlCPending after ~2s)
  let ctrlCTimer: ReturnType<typeof setTimeout> | null = null;

  const pendingStrategyCountdownSeconds = (deadlineMs: number) => Math.max(0, Math.ceil((deadlineMs - Date.now()) / 1000));

  const clearPendingStrategyTimer = () => {
    if (tuiState?.pendingStrategyTimer) {
      clearTimeout(tuiState.pendingStrategyTimer);
      tuiState.pendingStrategyTimer = undefined;
    }
  };

  const clearPendingStrategyCountdownTimer = () => {
    if (tuiState?.pendingStrategyCountdownTimer) {
      clearInterval(tuiState.pendingStrategyCountdownTimer);
      tuiState.pendingStrategyCountdownTimer = undefined;
    }
  };

  const clearPendingStrategy = () => {
    clearPendingStrategyTimer();
    clearPendingStrategyCountdownTimer();
    if (tuiState) {
      tuiState.pendingStrategy = undefined;
      tuiState.pendingStrategyDeadlineMs = undefined;
      tuiState.viewOptions.pendingStrategy = undefined;
      tuiState.viewOptions.pendingStrategyCountdownSeconds = undefined;
    }
  };

  const queueStrategyChange = (newStrategy: MergeStrategy) => {
    if (!tuiState) return;

    if (newStrategy === tuiState.mergeStrategy) {
      clearPendingStrategy();
      return;
    }

    clearPendingStrategyTimer();
    clearPendingStrategyCountdownTimer();
    const deadlineMs = Date.now() + STRATEGY_DEBOUNCE_MS;
    tuiState.pendingStrategy = newStrategy;
    tuiState.pendingStrategyDeadlineMs = deadlineMs;
    tuiState.viewOptions.pendingStrategy = newStrategy;
    tuiState.viewOptions.pendingStrategyCountdownSeconds = pendingStrategyCountdownSeconds(deadlineMs);
    tuiState.pendingStrategyCountdownTimer = setInterval(() => {
      if (!tuiState.pendingStrategy || tuiState.pendingStrategyDeadlineMs === undefined) return;
      const nextCountdownSeconds = pendingStrategyCountdownSeconds(tuiState.pendingStrategyDeadlineMs);
      if (nextCountdownSeconds !== tuiState.viewOptions.pendingStrategyCountdownSeconds) {
        tuiState.viewOptions.pendingStrategyCountdownSeconds = nextCountdownSeconds;
        tuiState.onUpdate?.();
      }
    }, 1000);
    tuiState.pendingStrategyTimer = setTimeout(() => {
      clearPendingStrategyTimer();
      clearPendingStrategyCountdownTimer();
      tuiState.pendingStrategyDeadlineMs = undefined;
      tuiState.viewOptions.pendingStrategyCountdownSeconds = 0;
      tuiState.onUpdate?.();
      tuiState.pendingStrategyTimer = setTimeout(() => {
        const pendingStrategy = tuiState.pendingStrategy;
        clearPendingStrategy();
        if (!pendingStrategy || pendingStrategy === tuiState.mergeStrategy) {
          tuiState.onUpdate?.();
          return;
        }
        tuiState.mergeStrategy = pendingStrategy;
        tuiState.viewOptions.mergeStrategy = pendingStrategy;
        tuiState.onStrategyChange?.(pendingStrategy);
        tuiState.onUpdate?.();
      }, 1);
    }, STRATEGY_DEBOUNCE_MS);
  };

  const clampControlsRowIndex = () => {
    if (!tuiState) return;
    tuiState.controlsRowIndex = Math.max(0, Math.min(tuiState.controlsRowIndex ?? 0, TUI_SETTINGS_ROWS.length - 1));
  };

  const dismissControls = () => {
    if (!tuiState) return;
    tuiState.showControls = false;
    tuiState.viewOptions.showControls = false;
  };

  const moveControlsRow = (delta: number) => {
    if (!tuiState) return;
    clampControlsRowIndex();
    tuiState.controlsRowIndex = Math.max(
      0,
      Math.min((tuiState.controlsRowIndex ?? 0) + delta, TUI_SETTINGS_ROWS.length - 1),
    );
  };

  const adjustControlsValue = (delta: -1 | 1) => {
    if (!tuiState) return;
    clampControlsRowIndex();
    const row = TUI_SETTINGS_ROWS[tuiState.controlsRowIndex ?? 0] ?? TUI_SETTINGS_ROWS[0]!;
    if (row.kind === "number") {
      tuiState.onWipChange?.(delta);
      return;
    }

    const options = runtimeOptionsForSettingsRow(row, tuiState.bypassEnabled);
    const currentValue = row.id === "collaboration_mode"
      ? tuiState.collaborationMode
      : row.id === "review_mode"
        ? tuiState.reviewMode
        : (tuiState.pendingStrategy ?? tuiState.mergeStrategy);
    const currentIdx = options.findIndex((option) => option.runtimeValue === currentValue);
    if (currentIdx < 0) return;
    const nextIdx = Math.max(0, Math.min(currentIdx + delta, options.length - 1));
    if (nextIdx === currentIdx) return;
    const nextOption = options[nextIdx]!;

    if (row.id === "collaboration_mode") {
      const newMode = nextOption.runtimeValue as CollaborationMode;
      tuiState.collaborationMode = newMode;
      tuiState.viewOptions.collaborationMode = newMode;
      tuiState.onCollaborationChange?.(newMode);
      return;
    }

    if (row.id === "review_mode") {
      const oldMode = tuiState.reviewMode;
      const newMode = nextOption.runtimeValue as ReviewMode;
      tuiState.reviewMode = newMode;
      tuiState.viewOptions.reviewMode = newMode;
      log({
        ts: new Date().toISOString(),
        level: "info",
        event: "review_mode_change",
        oldMode,
        newMode,
      });
      tuiState.onReviewChange?.(newMode);
      return;
    }

    const newStrategy = nextOption.runtimeValue as MergeStrategy;
    const oldStrategy = tuiState.pendingStrategy ?? tuiState.mergeStrategy;
    log({
      ts: new Date().toISOString(),
      level: "info",
      event: "strategy_cycle",
      oldStrategy,
      newStrategy,
    });
    queueStrategyChange(newStrategy);
  };

  const onData = (key: string) => {
    // q still exits immediately (discoverable via ? help overlay)
    if (key === "q") {
      log({ ts: new Date().toISOString(), level: "info", event: "keyboard_quit", key: "q" });
      abortController.abort();
      return;
    }

    // Ctrl+C: double-tap to exit
    if (key === "\x03") {
      if (tuiState?.ctrlCPending && Date.now() - tuiState.ctrlCTimestamp < 2000) {
        // Second press within 2s -- exit
        if (ctrlCTimer) clearTimeout(ctrlCTimer);
        log({ ts: new Date().toISOString(), level: "info", event: "keyboard_quit", key: "ctrl-c" });
        abortController.abort();
        return;
      }
      if (tuiState) {
        // First press -- show confirmation footer
        tuiState.ctrlCPending = true;
        tuiState.ctrlCTimestamp = Date.now();
        tuiState.viewOptions.ctrlCPending = true;
        tuiState.onUpdate?.();
        // Clear after ~2s
        if (ctrlCTimer) clearTimeout(ctrlCTimer);
        ctrlCTimer = setTimeout(() => {
          tuiState.ctrlCPending = false;
          tuiState.viewOptions.ctrlCPending = false;
          tuiState.onUpdate?.();
        }, 2000);
        return;
      }
      // No tuiState -- fall through to immediate abort
      log({ ts: new Date().toISOString(), level: "info", event: "keyboard_quit", key: "ctrl-c" });
      abortController.abort();
      return;
    }

    if (!tuiState) return;

    // Any non-Ctrl+C key clears the ctrlCPending state
    if (tuiState.ctrlCPending) {
      tuiState.ctrlCPending = false;
      tuiState.viewOptions.ctrlCPending = false;
      if (ctrlCTimer) { clearTimeout(ctrlCTimer); ctrlCTimer = null; }
    }

    let handled = true;

    if (tuiState.showControls) {
      switch (key) {
        case "\x1b[A":
          moveControlsRow(-1);
          tuiState.onUpdate?.();
          return;
        case "\x1b[B":
          moveControlsRow(1);
          tuiState.onUpdate?.();
          return;
        case "\x1b[D":
          adjustControlsValue(-1);
          tuiState.onUpdate?.();
          return;
        case "\x1b[C":
          adjustControlsValue(1);
          tuiState.onUpdate?.();
          return;
        case "\r":
        case "\x1b":
          dismissControls();
          tuiState.onUpdate?.();
          return;
      }
    }

    switch (key) {
      case "?":
        tuiState.showHelp = !tuiState.showHelp;
        tuiState.viewOptions.showHelp = tuiState.showHelp;
        // Close controls if help is opening
        if (tuiState.showHelp) {
          tuiState.showControls = false;
          tuiState.viewOptions.showControls = false;
        }
        break;
      case "c": // Toggle controls overlay
        tuiState.showControls = !tuiState.showControls;
        tuiState.viewOptions.showControls = tuiState.showControls;
        // Close help if controls is opening
        if (tuiState.showControls) {
          tuiState.showHelp = false;
          tuiState.viewOptions.showHelp = false;
          clampControlsRowIndex();
        }
        break;
      case "\x1b": // Raw Escape (length 1) -- dismiss help, controls, or detail panel
        // Only treat single-byte \x1b as Escape. Arrow keys send \x1b[A etc.
        // which are longer sequences and won't match this case.
        if (tuiState.showHelp) {
          tuiState.showHelp = false;
          tuiState.viewOptions.showHelp = false;
        } else if (tuiState.showControls) {
          dismissControls();
        } else if (tuiState.detailItemId) {
          // Return from detail view to log panel, restore scroll offset
          tuiState.detailItemId = null;
          tuiState.detailScrollOffset = 0;
          tuiState.logScrollOffset = tuiState.savedLogScrollOffset ?? 0;
        } else {
          handled = false;
        }
        break;
      case "d":
        tuiState.viewOptions.showBlockerDetail = !tuiState.viewOptions.showBlockerDetail;
        break;
      case "x": {
        if (tuiState.showHelp || tuiState.detailItemId) {
          handled = false;
          break;
        }
        const selIdx = tuiState.selectedIndex ?? 0;
        const itemId = tuiState.getSelectedItemId?.(selIdx);
        handled = itemId ? (tuiState.onExtendTimeout?.(itemId) ?? false) : false;
        break;
      }
      case "\r": // Enter -- open detail panel for selected item
      case "i": { // i -- open detail panel for selected item
        const selIdx = tuiState.selectedIndex ?? 0;
        if (selIdx >= 0 && !tuiState.detailItemId) {
          const itemId = tuiState.getSelectedItemId?.(selIdx);
          if (itemId) {
            tuiState.savedLogScrollOffset = tuiState.logScrollOffset;
            tuiState.detailItemId = itemId;
            tuiState.detailScrollOffset = 0;
          }
        }
        break;
      }
      case "\x1b[A": { // Up arrow
        if (tuiState.detailItemId) {
          // Scroll detail overlay up
          tuiState.detailScrollOffset = Math.max(0, (tuiState.detailScrollOffset ?? 0) - 1);
        } else if (tuiState.panelMode === "logs-only") {
          tuiState.logScrollOffset = Math.max(0, tuiState.logScrollOffset - 1);
        } else {
          if ((tuiState.selectedIndex ?? 0) > 0) {
            tuiState.selectedIndex = (tuiState.selectedIndex ?? 0) - 1;
          }
          // Scroll follows selection: keep selected item in view
          tuiState.scrollOffset = Math.min(tuiState.scrollOffset, tuiState.selectedIndex ?? 0);
        }
        break;
      }
      case "\x1b[B": { // Down arrow
        if (tuiState.detailItemId) {
          // Scroll detail overlay down
          const maxScroll = detailOverlayMaxScroll(tuiState.detailContentLines ?? 0, getTerminalHeight());
          tuiState.detailScrollOffset = Math.min(maxScroll, (tuiState.detailScrollOffset ?? 0) + 1);
        } else if (tuiState.panelMode === "logs-only") {
          tuiState.logScrollOffset += 1;
        } else {
          const maxIdx = (tuiState.getItemCount?.() ?? 0) - 1;
          const curIdx = tuiState.selectedIndex ?? 0;
          if (curIdx < maxIdx) {
            tuiState.selectedIndex = curIdx + 1;
          }
          // Scroll follows selection: ensure selected item stays visible
          tuiState.scrollOffset = tuiState.selectedIndex ?? 0;
        }
        break;
      }
      case "\t": { // Tab -- cycle panel mode (status-only <-> logs-only)
        const modes: PanelMode[] = ["status-only", "logs-only"];
        const currentIdx = modes.indexOf(tuiState.panelMode);
        const nextIdx = (currentIdx + 1) % modes.length;
        tuiState.panelMode = modes[nextIdx]!;
        tuiState.onPanelModeChange?.(tuiState.panelMode);
        break;
      }
      case "j": // Scroll down (detail overlay or log panel)
        if (tuiState.detailItemId) {
          const maxScroll = detailOverlayMaxScroll(tuiState.detailContentLines ?? 0, getTerminalHeight());
          tuiState.detailScrollOffset = Math.min(maxScroll, (tuiState.detailScrollOffset ?? 0) + 1);
        } else if (tuiState.panelMode === "logs-only") {
          tuiState.logScrollOffset += 1;
        } else {
          handled = false;
        }
        break;
      case "k": // Scroll up (detail overlay or log panel)
        if (tuiState.detailItemId) {
          tuiState.detailScrollOffset = Math.max(0, (tuiState.detailScrollOffset ?? 0) - 1);
        } else if (tuiState.panelMode === "logs-only") {
          tuiState.logScrollOffset = Math.max(0, tuiState.logScrollOffset - 1);
        } else {
          handled = false;
        }
        break;
      case "l": { // Cycle log level filter (info -> warn -> error -> all)
        const currentIdx = LOG_LEVEL_CYCLE.indexOf(tuiState.logLevelFilter);
        const nextIdx = (currentIdx + 1) % LOG_LEVEL_CYCLE.length;
        tuiState.logLevelFilter = LOG_LEVEL_CYCLE[nextIdx]!;
        // Reset scroll when filter changes
        tuiState.logScrollOffset = 0;
        break;
      }
      case "G": { // Jump to end (detail overlay or log)
        if (tuiState.detailItemId) {
          const maxScroll = detailOverlayMaxScroll(tuiState.detailContentLines ?? 0, getTerminalHeight());
          tuiState.detailScrollOffset = maxScroll;
        } else if (tuiState.panelMode === "logs-only") {
          const filtered = filterLogsByLevel(tuiState.logBuffer, tuiState.logLevelFilter);
          const termRows = getTerminalHeight();
          const viewportHeight = Math.max(1, termRows - 10); // approximate
          tuiState.logScrollOffset = Math.max(0, filtered.length - viewportHeight);
        } else {
          handled = false;
        }
        break;
      }
      case "\x1B[Z": { // Shift+Tab -- cycle merge strategy
        const strategies: MergeStrategy[] = tuiState.bypassEnabled
          ? ["auto", "manual", "bypass"]
          : ["auto", "manual"];
        const currentIdx = strategies.indexOf(tuiState.pendingStrategy ?? tuiState.mergeStrategy);
        const nextIdx = (currentIdx + 1) % strategies.length;
        const oldStrategy = tuiState.pendingStrategy ?? tuiState.mergeStrategy;
        const nextStrategy = strategies[nextIdx]!;
        log({
          ts: new Date().toISOString(),
          level: "info",
          event: "strategy_cycle",
          oldStrategy,
          newStrategy: nextStrategy,
        });
        queueStrategyChange(nextStrategy);
        break;
      }
      case "+":
      case "=": { // + (or = without shift) -- increase WIP limit
        tuiState.onWipChange?.(1);
        break;
      }
      case "-":
      case "_": { // - (or _ with shift) -- decrease WIP limit
        tuiState.onWipChange?.(-1);
        break;
      }
      default:
        handled = false;
    }

    if (handled) tuiState.onUpdate?.();
  };

  // Handle terminal resize: clamp scroll offset
  const onResize = () => {
    if (tuiState) {
      const termRows = getTerminalHeight();
      const viewportHeight = Math.max(1, termRows - 10); // approximate
      tuiState.scrollOffset = clampScrollOffset(tuiState.scrollOffset, 999, viewportHeight);
      // Also clamp log scroll offset on resize
      const filtered = filterLogsByLevel(tuiState.logBuffer, tuiState.logLevelFilter);
      tuiState.logScrollOffset = clampScrollOffset(tuiState.logScrollOffset, filtered.length, viewportHeight);
      tuiState.onUpdate?.();
    }
  };

  stdin.on("data", onData);
  process.stdout.on("resize", onResize);

  return () => {
    if (ctrlCTimer) clearTimeout(ctrlCTimer);
    clearPendingStrategy();
    stdin.removeListener("data", onData);
    process.stdout.removeListener("resize", onResize);
    if (stdin.isTTY && stdin.setRawMode) {
      stdin.setRawMode(false);
    }
    stdin.pause();
  };
}
