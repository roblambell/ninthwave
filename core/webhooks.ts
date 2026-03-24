// Webhook support for orchestrator lifecycle events.
// Fire-and-forget JSON POST to a configured URL on key events.
// Supports Slack and Discord incoming webhook formats.

import { loadConfig } from "./config.ts";

// ── Types ──────────────────────────────────────────────────────────────

export type WebhookEvent =
  | "batch_complete"
  | "pr_merged"
  | "ci_failed"
  | "orchestrate_complete";

export interface WebhookItemSummary {
  id: string;
  state: string;
  prNumber?: number;
}

export interface WebhookPayload {
  /** Human-readable message (Slack `text` / Discord-compatible). */
  text: string;
  /** Machine-readable event type. */
  event: WebhookEvent;
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** Items involved in this event. */
  items?: WebhookItemSummary[];
  /** Aggregate stats. */
  summary?: { done: number; stuck: number; total: number };
  /** Specific item this event relates to (ci_failed, pr_merged). */
  itemId?: string;
  /** PR number (ci_failed, pr_merged). */
  prNumber?: number;
  /** Error details (ci_failed). */
  error?: string;
}

/** Injectable fetch signature matching globalThis.fetch. */
export type WebhookFetchFn = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number }>;

/** Callback signature for the notifier returned by createWebhookNotifier. */
export type WebhookNotifyFn = (
  event: WebhookEvent,
  data: Omit<WebhookPayload, "text" | "event" | "timestamp">,
) => void;

// ── URL resolution ──────────────────────────────────────────────────────

/**
 * Resolve webhook URL from environment variable or project config.
 * Precedence: NINTHWAVE_WEBHOOK_URL env var > .ninthwave/config webhook_url field.
 *
 * @param projectRoot - Project root for config file lookup (optional).
 * @param env - Environment variables (injectable for testing).
 * @param configLoader - Config loader function (injectable for testing).
 */
export function resolveWebhookUrl(
  projectRoot?: string,
  env: Record<string, string | undefined> = process.env,
  configLoader: (root: string) => Record<string, string> = loadConfig,
): string | null {
  const envUrl = env.NINTHWAVE_WEBHOOK_URL;
  if (envUrl) return envUrl;

  if (projectRoot) {
    try {
      const config = configLoader(projectRoot);
      if (config.webhook_url) return config.webhook_url;
    } catch {
      // Config load failure is non-fatal
    }
  }

  return null;
}

// ── Text formatting ─────────────────────────────────────────────────────

/** Format a human-readable message for Slack/Discord display. */
export function formatWebhookText(
  event: WebhookEvent,
  data: Partial<WebhookPayload>,
): string {
  switch (event) {
    case "batch_complete": {
      const s = data.summary;
      const itemIds = data.items?.map((i) => i.id).join(", ") ?? "";
      return `✅ *Batch complete* — ${s?.done ?? 0} done, ${s?.stuck ?? 0} stuck of ${s?.total ?? 0} total\nItems: ${itemIds}`;
    }
    case "pr_merged":
      return `🔀 *PR #${data.prNumber ?? "?"}* merged for \`${data.itemId ?? "?"}\``;
    case "ci_failed":
      return `❌ *CI failed* for \`${data.itemId ?? "?"}\` (PR #${data.prNumber ?? "?"})`;
    case "orchestrate_complete": {
      const s = data.summary;
      const itemList =
        data.items
          ?.map(
            (i) => `• \`${i.id}\`: ${i.state}${i.prNumber ? ` (PR #${i.prNumber})` : ""}`,
          )
          .join("\n") ?? "";
      return `🏁 *Orchestration complete* — ${s?.done ?? 0} done, ${s?.stuck ?? 0} stuck of ${s?.total ?? 0} total\n${itemList}`;
    }
  }
}

// ── Fire webhook ────────────────────────────────────────────────────────

/**
 * POST a JSON payload to the webhook URL. Fire-and-forget.
 * Logs errors but never throws — webhook failures must not block orchestration.
 *
 * @param url - Webhook endpoint URL.
 * @param payload - JSON payload to send.
 * @param fetchFn - Injectable fetch function (defaults to globalThis.fetch).
 * @param logError - Optional error logger.
 */
export async function fireWebhook(
  url: string,
  payload: WebhookPayload,
  fetchFn: WebhookFetchFn = globalThis.fetch,
  logError?: (msg: string) => void,
): Promise<void> {
  try {
    const response = await fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      logError?.(`Webhook returned HTTP ${response.status}`);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logError?.(`Webhook delivery failed: ${msg}`);
  }
}

// ── Notifier factory ────────────────────────────────────────────────────

/**
 * Create a fire-and-forget webhook notifier.
 * Returns a no-op function when URL is null (webhook not configured).
 *
 * @param url - Webhook URL (null = disabled).
 * @param fetchFn - Injectable fetch function.
 * @param logError - Optional error logger.
 */
export function createWebhookNotifier(
  url: string | null,
  fetchFn: WebhookFetchFn = globalThis.fetch,
  logError?: (msg: string) => void,
): WebhookNotifyFn {
  if (!url) return () => {};

  return (event, data) => {
    const payload: WebhookPayload = {
      ...data,
      event,
      timestamp: new Date().toISOString(),
      text: formatWebhookText(event, data),
    };
    // Fire-and-forget — intentionally not awaited
    fireWebhook(url, payload, fetchFn, logError).catch(() => {});
  };
}
