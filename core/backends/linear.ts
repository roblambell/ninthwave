// Linear backend: reads issues from Linear via the GraphQL API
// and maps them to TodoItem shape. Supports transitioning issues to Done
// and syncing status labels.

import type { TodoItem, Priority, TaskBackend, StatusSync } from "../types.ts";

/** Function signature for making HTTP requests (injectable for testing). */
export type HttpFetcher = (
  url: string,
  options: { method: string; headers: Record<string, string>; body?: string },
) => { ok: boolean; status: number; json: unknown };

/** Raw shape returned by Linear GraphQL API for an issue. */
export interface LinearIssue {
  id: string; // UUID
  identifier: string; // e.g., "ENG-123"
  title: string;
  description: string | null;
  priority: number; // 0=None, 1=Urgent, 2=High, 3=Medium, 4=Low
  state: { name: string; type: string };
  team: { id: string; name: string; key: string } | null;
  project: { name: string } | null;
  labels: { nodes: Array<{ id: string; name: string }> };
}

/** Raw shape for a Linear issue label. */
export interface LinearLabel {
  id: string;
  name: string;
}

/** Map Linear priority integer to a Priority. Falls back to "medium" for no-priority (0). */
export function mapLinearPriority(priority: number): Priority {
  switch (priority) {
    case 1:
      return "critical"; // Urgent
    case 2:
      return "high";
    case 3:
      return "medium";
    case 4:
      return "low";
    default:
      return "medium"; // 0 = No Priority
  }
}

/** Convert a Linear issue to a TodoItem. */
export function issueToTodoItem(issue: LinearIssue): TodoItem {
  return {
    id: `LIN-${issue.identifier}`,
    priority: mapLinearPriority(issue.priority),
    title: issue.title,
    domain: issue.team?.name ?? "uncategorized",
    dependencies: [],
    bundleWith: [],
    status: "open",
    filePath: "",
    repoAlias: "",
    rawText: issue.description ?? "",
    filePaths: [],
    testPlan: "",
    bootstrap: false,
  };
}

/** Default Linear GraphQL API endpoint. */
const LINEAR_API_BASE = "https://api.linear.app/graphql";

/** Known status labels managed by the orchestrator. */
export const STATUS_TAGS = [
  "ninthwave:in-progress",
  "ninthwave:pr-open",
] as const;

/** GraphQL fields to fetch for an issue. */
const ISSUE_FIELDS = `
  id
  identifier
  title
  description
  priority
  state { name type }
  team { id name key }
  project { name }
  labels { nodes { id name } }
`;

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

export class LinearBackend implements TaskBackend, StatusSync {
  private apiBase: string;

  constructor(
    private apiKey: string,
    private teamKey?: string,
    private fetcher: HttpFetcher = syncFetch,
    apiBase?: string,
  ) {
    this.apiBase = apiBase ?? LINEAR_API_BASE;
  }

  /** Build standard headers for Linear GraphQL requests. */
  private headers(): Record<string, string> {
    return {
      Authorization: this.apiKey,
      "Content-Type": "application/json",
    };
  }

  /** Execute a GraphQL query/mutation against the Linear API. */
  private gql(
    query: string,
    variables?: Record<string, unknown>,
  ): { ok: boolean; status: number; json: unknown } {
    return this.fetcher(this.apiBase, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ query, variables }),
    });
  }

  /**
   * List open Linear issues.
   * Filters by team key (if configured) or by the authenticated user's assignments.
   * Only returns issues in "unstarted" or "started" workflow states.
   */
  list(): TodoItem[] {
    const filter: Record<string, unknown> = {
      state: { type: { in: ["unstarted", "started"] } },
    };
    if (this.teamKey) {
      filter.team = { key: { eq: this.teamKey } };
    } else {
      filter.assignee = { isMe: { eq: true } };
    }

    const query = `
      query IssueList($filter: IssueFilter) {
        issues(filter: $filter) {
          nodes { ${ISSUE_FIELDS} }
        }
      }
    `;

    const result = this.gql(query, { filter });
    if (!result.ok || !result.json) return [];
    try {
      const data = result.json as {
        data?: { issues?: { nodes?: LinearIssue[] } };
      };
      const nodes = data.data?.issues?.nodes;
      if (!Array.isArray(nodes)) return [];
      return nodes.map(issueToTodoItem);
    } catch {
      return [];
    }
  }

  /** Read a single issue by ID (format: "LIN-ENG-123" or "ENG-123"). */
  read(id: string): TodoItem | undefined {
    const identifier = id.replace(/^LIN-/, "");

    const query = `
      query IssueRead($filter: IssueFilter) {
        issues(filter: $filter) {
          nodes { ${ISSUE_FIELDS} }
        }
      }
    `;

    const result = this.gql(query, {
      filter: { identifier: { eq: identifier } },
    });
    if (!result.ok || !result.json) return undefined;
    try {
      const data = result.json as {
        data?: { issues?: { nodes?: LinearIssue[] } };
      };
      const issue = data.data?.issues?.nodes?.[0];
      if (!issue) return undefined;
      return issueToTodoItem(issue);
    } catch {
      return undefined;
    }
  }

  /**
   * Transition a Linear issue to a "Done" (completed) state.
   * Idempotent — already-completed or cancelled issues return true.
   */
  markDone(id: string): boolean {
    const identifier = id.replace(/^LIN-/, "");

    // Fetch the issue to get its UUID, team ID, and current state
    const fetchQuery = `
      query IssueForDone($filter: IssueFilter) {
        issues(filter: $filter) {
          nodes { id team { id } state { type } }
        }
      }
    `;
    const fetchResult = this.gql(fetchQuery, {
      filter: { identifier: { eq: identifier } },
    });
    if (!fetchResult.ok || !fetchResult.json) return false;

    type MinIssue = {
      id: string;
      team: { id: string } | null;
      state: { type: string };
    };
    const fetchData = fetchResult.json as {
      data?: { issues?: { nodes?: MinIssue[] } };
    };
    const issue = fetchData.data?.issues?.nodes?.[0];
    if (!issue) return false;

    // Already done — idempotent
    if (issue.state.type === "completed" || issue.state.type === "cancelled") {
      return true;
    }

    const teamId = issue.team?.id;
    if (!teamId) return false;

    // Find a "completed" workflow state for this team
    const statesQuery = `
      query WorkflowStates($filter: WorkflowStateFilter) {
        workflowStates(filter: $filter) {
          nodes { id name }
        }
      }
    `;
    const statesResult = this.gql(statesQuery, {
      filter: {
        team: { id: { eq: teamId } },
        type: { eq: "completed" },
      },
    });
    if (!statesResult.ok || !statesResult.json) return false;

    const statesData = statesResult.json as {
      data?: { workflowStates?: { nodes?: Array<{ id: string }> } };
    };
    const doneStateId =
      statesData.data?.workflowStates?.nodes?.[0]?.id;
    if (!doneStateId) return false;

    // Transition the issue to the done state
    const mutation = `
      mutation IssueMarkDone($id: String!, $stateId: String!) {
        issueUpdate(id: $id, input: { stateId: $stateId }) {
          success
        }
      }
    `;
    const updateResult = this.gql(mutation, {
      id: issue.id,
      stateId: doneStateId,
    });
    if (!updateResult.ok || !updateResult.json) return false;

    const updateData = updateResult.json as {
      data?: { issueUpdate?: { success: boolean } };
    };
    return updateData.data?.issueUpdate?.success ?? false;
  }

  /**
   * Add a status label to a Linear issue.
   * Idempotent — adding an already-present label is a no-op.
   */
  addStatusLabel(id: string, label: string): boolean {
    return this.manageLabel(id.replace(/^LIN-/, ""), label, "add");
  }

  /**
   * Remove a status label from a Linear issue.
   * Idempotent — removing a missing label returns true.
   */
  removeStatusLabel(id: string, label: string): boolean {
    this.manageLabel(id.replace(/^LIN-/, ""), label, "remove");
    return true;
  }

  /** Remove all known orchestrator status labels from an issue. */
  removeAllStatusLabels(id: string): void {
    for (const tag of STATUS_TAGS) {
      this.removeStatusLabel(id, tag);
    }
  }

  /** Add or remove a label from an issue by identifier. */
  private manageLabel(
    identifier: string,
    labelName: string,
    action: "add" | "remove",
  ): boolean {
    // Fetch the issue UUID, team ID, and current labels
    const fetchQuery = `
      query IssueForLabel($filter: IssueFilter) {
        issues(filter: $filter) {
          nodes { id team { id } labels { nodes { id name } } }
        }
      }
    `;
    const fetchResult = this.gql(fetchQuery, {
      filter: { identifier: { eq: identifier } },
    });
    if (!fetchResult.ok || !fetchResult.json) return false;

    type IssueForLabel = {
      id: string;
      team: { id: string } | null;
      labels: { nodes: Array<{ id: string; name: string }> };
    };
    const fetchData = fetchResult.json as {
      data?: { issues?: { nodes?: IssueForLabel[] } };
    };
    const issue = fetchData.data?.issues?.nodes?.[0];
    if (!issue) return false;

    const currentLabels = issue.labels.nodes;

    if (action === "add") {
      // Idempotent: already has this label
      if (currentLabels.some((l) => l.name === labelName)) return true;

      const labelId = this.findOrCreateLabel(labelName, issue.team?.id);
      if (!labelId) return false;

      return this.updateIssueLabels(issue.id, [
        ...currentLabels.map((l) => l.id),
        labelId,
      ]);
    } else {
      const filtered = currentLabels.filter((l) => l.name !== labelName);
      // Idempotent: label wasn't present
      if (filtered.length === currentLabels.length) return true;

      return this.updateIssueLabels(
        issue.id,
        filtered.map((l) => l.id),
      );
    }
  }

  /** Find an existing label by name (team-scoped), or create it if missing. */
  private findOrCreateLabel(
    name: string,
    teamId?: string,
  ): string | null {
    const filter: Record<string, unknown> = { name: { eq: name } };
    if (teamId) filter.team = { id: { eq: teamId } };

    const searchQuery = `
      query LabelSearch($filter: IssueLabelFilter) {
        issueLabels(filter: $filter) {
          nodes { id name }
        }
      }
    `;
    const searchResult = this.gql(searchQuery, { filter });
    if (searchResult.ok && searchResult.json) {
      const searchData = searchResult.json as {
        data?: { issueLabels?: { nodes?: LinearLabel[] } };
      };
      const existing = searchData.data?.issueLabels?.nodes?.[0];
      if (existing) return existing.id;
    }

    // Can't create a label without a team ID
    if (!teamId) return null;

    const createMutation = `
      mutation LabelCreate($input: IssueLabelCreateInput!) {
        issueLabelCreate(input: $input) {
          success
          issueLabel { id }
        }
      }
    `;
    const createResult = this.gql(createMutation, {
      input: { name, teamId, color: "#6366f1" },
    });
    if (!createResult.ok || !createResult.json) return null;

    const createData = createResult.json as {
      data?: {
        issueLabelCreate?: { success: boolean; issueLabel?: { id: string } };
      };
    };
    return createData.data?.issueLabelCreate?.issueLabel?.id ?? null;
  }

  /** Update an issue's full label set to the given label IDs. */
  private updateIssueLabels(
    issueId: string,
    labelIds: string[],
  ): boolean {
    const mutation = `
      mutation LabelUpdate($id: String!, $labelIds: [String!]) {
        issueUpdate(id: $id, input: { labelIds: $labelIds }) {
          success
        }
      }
    `;
    const result = this.gql(mutation, { id: issueId, labelIds });
    if (!result.ok || !result.json) return false;

    const data = result.json as {
      data?: { issueUpdate?: { success: boolean } };
    };
    return data.data?.issueUpdate?.success ?? false;
  }
}

/**
 * Resolve Linear configuration from environment and config file.
 * Returns { apiKey, teamKey? } or null if not configured.
 *
 * Resolution order:
 * - API key: LINEAR_API_KEY env var → linear_api_key config key (required)
 * - Team key: LINEAR_TEAM_KEY env var → linear_team_key config key (optional)
 */
export function resolveLinearConfig(
  configGetter: (key: string) => string | undefined,
): { apiKey: string; teamKey?: string } | null {
  const apiKey =
    process.env.LINEAR_API_KEY ?? configGetter("linear_api_key");
  if (!apiKey) return null;

  const teamKey =
    process.env.LINEAR_TEAM_KEY ?? configGetter("linear_team_key");

  return { apiKey, teamKey: teamKey || undefined };
}
