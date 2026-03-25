// Sentry backend: reads issues from a Sentry project via the Sentry Web API
// and maps them to TodoItem shape. Supports resolving issues and syncing status tags.

import type { TodoItem, Priority, TaskBackend, StatusSync } from "../types.ts";

/** Function signature for making HTTP requests (injectable for testing). */
export type HttpFetcher = (
  url: string,
  options: { method: string; headers: Record<string, string>; body?: string },
) => { ok: boolean; status: number; json: unknown };

/** Raw shape returned by Sentry API GET /projects/{org}/{project}/issues/ */
export interface SentryIssue {
  id: string;
  title: string;
  culprit: string;
  level: string;
  firstSeen: string;
  lastSeen: string;
  count: string;
  project: { slug: string };
  metadata: { filename?: string };
  assignedTo: { name: string } | null;
}

/** Stacktrace frame from Sentry latest event. */
export interface SentryStacktraceFrame {
  filename: string;
  absPath?: string;
  lineNo?: number;
  function?: string;
}

/** Raw shape for Sentry's latest event (subset of fields we use). */
export interface SentryLatestEvent {
  entries?: Array<{
    type: string;
    data?: {
      values?: Array<{
        stacktrace?: {
          frames?: SentryStacktraceFrame[];
        };
      }>;
    };
  }>;
}

/** Map Sentry level to a Priority. */
export function mapSentryLevel(level: string): Priority {
  switch (level) {
    case "fatal":
      return "critical";
    case "error":
      return "high";
    case "warning":
      return "medium";
    case "info":
    case "debug":
      return "low";
    default:
      return "medium";
  }
}

/** Maximum title length before truncation. */
const MAX_TITLE_LENGTH = 200;

/** Extract file paths from Sentry stacktrace frames. */
export function extractFilePaths(
  frames: SentryStacktraceFrame[] | undefined,
): string[] {
  if (!frames || frames.length === 0) return [];
  const paths = new Set<string>();
  for (const frame of frames) {
    if (frame.filename && !frame.filename.startsWith("<")) {
      paths.add(frame.filename);
    }
  }
  return [...paths];
}

/** Convert a Sentry issue to a TodoItem. */
export function issueToTodoItem(
  issue: SentryIssue,
  filePaths: string[] = [],
): TodoItem {
  const title =
    issue.title.length > MAX_TITLE_LENGTH
      ? issue.title.slice(0, MAX_TITLE_LENGTH) + "…"
      : issue.title;

  const rawLines = [
    `**Culprit:** ${issue.culprit || "unknown"}`,
    `**First seen:** ${issue.firstSeen}`,
    `**Last seen:** ${issue.lastSeen}`,
    `**Event count:** ${issue.count}`,
  ];

  return {
    id: `SNT-${issue.id}`,
    priority: mapSentryLevel(issue.level),
    title,
    domain: issue.project?.slug ?? "uncategorized",
    dependencies: [],
    bundleWith: [],
    status: "open",
    filePath: "",
    repoAlias: "",
    rawText: rawLines.join("\n"),
    filePaths,
    testPlan: "",
  };
}

/** Default Sentry API base URL. */
const SENTRY_API_BASE = "https://sentry.io/api/0";

/** Known status tags managed by the orchestrator. */
export const STATUS_TAGS = [
  "ninthwave:in-progress",
  "ninthwave:pr-open",
] as const;

/**
 * Synchronous HTTP fetch wrapper using Bun.spawnSync + curl.
 * Returns a simplified response object.
 */
function syncFetch(
  url: string,
  options: { method: string; headers: Record<string, string>; body?: string },
): { ok: boolean; status: number; json: unknown } {
  const args = [
    "-s",
    "-w",
    "\n%{http_code}",
    "-X",
    options.method,
    url,
  ];
  for (const [key, value] of Object.entries(options.headers)) {
    args.push("-H", `${key}: ${value}`);
  }
  if (options.body) {
    args.push("-d", options.body);
  }

  const result = Bun.spawnSync(["curl", ...args]);
  const output = result.stdout.toString().trim();
  const lines = output.split("\n");
  const statusCode = parseInt(lines[lines.length - 1], 10);
  const body = lines.slice(0, -1).join("\n");

  let json: unknown = null;
  try {
    json = JSON.parse(body);
  } catch {
    // Leave as null
  }

  return {
    ok: statusCode >= 200 && statusCode < 300,
    status: statusCode,
    json,
  };
}

export class SentryBackend implements TaskBackend, StatusSync {
  private apiBase: string;

  constructor(
    private org: string,
    private project: string,
    private authToken: string,
    private fetcher: HttpFetcher = syncFetch,
    apiBase?: string,
  ) {
    this.apiBase = apiBase ?? SENTRY_API_BASE;
  }

  /** Build standard headers for Sentry API requests. */
  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.authToken}`,
      "Content-Type": "application/json",
    };
  }

  /** List unresolved issues in the configured Sentry project. */
  list(): TodoItem[] {
    const url = `${this.apiBase}/projects/${encodeURIComponent(this.org)}/${encodeURIComponent(this.project)}/issues/?query=is:unresolved`;
    const result = this.fetcher(url, {
      method: "GET",
      headers: this.headers(),
    });
    if (!result.ok || !result.json) return [];
    try {
      const issues = result.json as SentryIssue[];
      if (!Array.isArray(issues)) return [];
      return issues.map((issue) => issueToTodoItem(issue));
    } catch {
      return [];
    }
  }

  /** Read a single issue by ID (format: "SNT-<id>" or plain id string). */
  read(id: string): TodoItem | undefined {
    const issueId = id.replace(/^SNT-/, "");
    const url = `${this.apiBase}/issues/${issueId}/`;
    const result = this.fetcher(url, {
      method: "GET",
      headers: this.headers(),
    });
    if (!result.ok || !result.json) return undefined;
    try {
      const issue = result.json as SentryIssue;
      // Try to fetch stacktrace from latest event
      const filePaths = this.fetchFilePaths(issueId);
      return issueToTodoItem(issue, filePaths);
    } catch {
      return undefined;
    }
  }

  /** Fetch file paths from the issue's latest event stacktrace. */
  private fetchFilePaths(issueId: string): string[] {
    const url = `${this.apiBase}/issues/${issueId}/events/latest/`;
    const result = this.fetcher(url, {
      method: "GET",
      headers: this.headers(),
    });
    if (!result.ok || !result.json) return [];
    try {
      const event = result.json as SentryLatestEvent;
      if (!event.entries) return [];
      for (const entry of event.entries) {
        if (entry.type === "exception" && entry.data?.values) {
          const allFrames: SentryStacktraceFrame[] = [];
          for (const value of entry.data.values) {
            if (value.stacktrace?.frames) {
              allFrames.push(...value.stacktrace.frames);
            }
          }
          return extractFilePaths(allFrames);
        }
      }
      return [];
    } catch {
      return [];
    }
  }

  /** Resolve an issue by setting its status to "resolved". Idempotent. */
  markDone(id: string): boolean {
    const issueId = id.replace(/^SNT-/, "");
    const url = `${this.apiBase}/issues/${issueId}/`;
    const result = this.fetcher(url, {
      method: "PUT",
      headers: this.headers(),
      body: JSON.stringify({ status: "resolved" }),
    });
    return result.ok;
  }

  /** Add a status label to an issue via assignedTo tag. Returns true on success. */
  addStatusLabel(id: string, label: string): boolean {
    const issueId = id.replace(/^SNT-/, "");
    const url = `${this.apiBase}/issues/${issueId}/`;
    const result = this.fetcher(url, {
      method: "PUT",
      headers: this.headers(),
      body: JSON.stringify({ assignedTo: label }),
    });
    return result.ok;
  }

  /**
   * Remove a status label from an issue.
   * Idempotent — returns true even if the label doesn't exist on the issue.
   */
  removeStatusLabel(id: string, _label: string): boolean {
    const issueId = id.replace(/^SNT-/, "");
    const url = `${this.apiBase}/issues/${issueId}/`;
    this.fetcher(url, {
      method: "PUT",
      headers: this.headers(),
      body: JSON.stringify({ assignedTo: "" }),
    });
    // Always return true — missing label is not an error condition
    return true;
  }

  /** Remove all known status tags from an issue. */
  removeAllStatusLabels(id: string): void {
    for (const tag of STATUS_TAGS) {
      this.removeStatusLabel(id, tag);
    }
  }
}

/**
 * Resolve Sentry configuration from environment and config file.
 * Returns { authToken, org, project } or null if not configured.
 *
 * Resolution order:
 * - Auth token: SENTRY_AUTH_TOKEN env var (required)
 * - Org: SENTRY_ORG env var → sentry_org config key → null
 * - Project: SENTRY_PROJECT env var → sentry_project config key → null
 */
export function resolveSentryConfig(
  configGetter: (key: string) => string | undefined,
): { authToken: string; org: string; project: string } | null {
  const authToken = process.env.SENTRY_AUTH_TOKEN;
  if (!authToken) return null;

  const org = process.env.SENTRY_ORG ?? configGetter("sentry_org");
  if (!org) return null;

  const project = process.env.SENTRY_PROJECT ?? configGetter("sentry_project");
  if (!project) return null;

  return { authToken, org, project };
}
