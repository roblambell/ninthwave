// Tests for core/backends/linear.ts
// Uses dependency injection (not vi.mock/vi.spyOn) to avoid Bun runtime dependency.

import { describe, it, expect, afterEach } from "vitest";
import {
  mapLinearPriority,
  issueToTodoItem,
  LinearBackend,
  resolveLinearConfig,
  STATUS_TAGS,
} from "../core/backends/linear.ts";
import type { LinearIssue, HttpFetcher } from "../core/backends/linear.ts";

/** Create a mock HttpFetcher that always returns a fixed result. */
function mockFetcher(result: {
  ok: boolean;
  status: number;
  json: unknown;
}): HttpFetcher {
  return (_url, _options) => result;
}

/** Create a mock HttpFetcher that captures calls and returns a fixed result. */
function spyFetcher(result: {
  ok: boolean;
  status: number;
  json: unknown;
}): {
  fetcher: HttpFetcher;
  calls: Array<{
    url: string;
    options: { method: string; headers: Record<string, string>; body?: string };
  }>;
} {
  const calls: Array<{
    url: string;
    options: { method: string; headers: Record<string, string>; body?: string };
  }> = [];
  const fetcher: HttpFetcher = (url, options) => {
    calls.push({ url, options });
    return result;
  };
  return { fetcher, calls };
}

/**
 * Create a multi-step HttpFetcher that returns each result in sequence.
 * The last result is repeated if more calls are made than results supplied.
 */
function multiStepFetcher(
  steps: Array<{ ok: boolean; status: number; json: unknown }>,
): {
  fetcher: HttpFetcher;
  calls: Array<{
    url: string;
    options: { method: string; headers: Record<string, string>; body?: string };
  }>;
} {
  let callIndex = 0;
  const calls: Array<{
    url: string;
    options: { method: string; headers: Record<string, string>; body?: string };
  }> = [];
  const fetcher: HttpFetcher = (url, options) => {
    calls.push({ url, options });
    const step = steps[callIndex] ?? steps[steps.length - 1];
    callIndex++;
    return step;
  };
  return { fetcher, calls };
}

/** Create a sample Linear issue for testing. */
function sampleIssue(overrides: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: "uuid-abc-123",
    identifier: "ENG-42",
    title: "Implement feature Y",
    description: "Details about feature Y",
    priority: 2, // high
    state: { name: "In Progress", type: "started" },
    team: { id: "team-uuid-1", name: "Engineering", key: "ENG" },
    project: { name: "Platform" },
    labels: { nodes: [] },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// mapLinearPriority
// ---------------------------------------------------------------------------
describe("mapLinearPriority", () => {
  it("maps 1 to critical (Urgent)", () => {
    expect(mapLinearPriority(1)).toBe("critical");
  });

  it("maps 2 to high", () => {
    expect(mapLinearPriority(2)).toBe("high");
  });

  it("maps 3 to medium", () => {
    expect(mapLinearPriority(3)).toBe("medium");
  });

  it("maps 4 to low", () => {
    expect(mapLinearPriority(4)).toBe("low");
  });

  it("maps 0 (No Priority) to medium", () => {
    expect(mapLinearPriority(0)).toBe("medium");
  });

  it("defaults to medium for unknown priority values", () => {
    expect(mapLinearPriority(99)).toBe("medium");
    expect(mapLinearPriority(-1)).toBe("medium");
  });
});

// ---------------------------------------------------------------------------
// issueToTodoItem
// ---------------------------------------------------------------------------
describe("issueToTodoItem", () => {
  it("converts a full Linear issue to TodoItem shape", () => {
    const issue = sampleIssue();
    const item = issueToTodoItem(issue);

    expect(item.id).toBe("LIN-ENG-42");
    expect(item.title).toBe("Implement feature Y");
    expect(item.priority).toBe("high");
    expect(item.domain).toBe("Engineering");
    expect(item.rawText).toBe("Details about feature Y");
    expect(item.dependencies).toEqual([]);
    expect(item.bundleWith).toEqual([]);
    expect(item.status).toBe("open");
    expect(item.filePath).toBe("");
    expect(item.repoAlias).toBe("");
    expect(item.filePaths).toEqual([]);
    expect(item.testPlan).toBe("");
    expect(item.bootstrap).toBe(false);
  });

  it("uses identifier with LIN- prefix as id", () => {
    const issue = sampleIssue({ identifier: "INFRA-7" });
    expect(issueToTodoItem(issue).id).toBe("LIN-INFRA-7");
  });

  it("defaults domain to 'uncategorized' when team is null", () => {
    const issue = sampleIssue({ team: null });
    expect(issueToTodoItem(issue).domain).toBe("uncategorized");
  });

  it("defaults priority to medium when priority is 0 (No Priority)", () => {
    const issue = sampleIssue({ priority: 0 });
    expect(issueToTodoItem(issue).priority).toBe("medium");
  });

  it("uses empty string for rawText when description is null", () => {
    const issue = sampleIssue({ description: null });
    expect(issueToTodoItem(issue).rawText).toBe("");
  });
});

// ---------------------------------------------------------------------------
// LinearBackend.list
// ---------------------------------------------------------------------------
describe("LinearBackend.list", () => {
  it("returns TodoItems from Linear GraphQL response", () => {
    const issues: LinearIssue[] = [
      sampleIssue({ identifier: "ENG-1", title: "First issue" }),
      sampleIssue({
        identifier: "ENG-2",
        title: "Second issue",
        priority: 4,
        team: null,
      }),
    ];
    const fetcher = mockFetcher({
      ok: true,
      status: 200,
      json: { data: { issues: { nodes: issues } } },
    });
    const backend = new LinearBackend(
      "lin_api_key",
      undefined,
      fetcher,
      "https://api.test",
    );
    const items = backend.list();

    expect(items).toHaveLength(2);
    expect(items[0].id).toBe("LIN-ENG-1");
    expect(items[0].title).toBe("First issue");
    expect(items[0].priority).toBe("high");
    expect(items[1].id).toBe("LIN-ENG-2");
    expect(items[1].priority).toBe("low");
    expect(items[1].domain).toBe("uncategorized");
  });

  it("constructs filter with assignee.isMe when no teamKey is set", () => {
    const { fetcher, calls } = spyFetcher({
      ok: true,
      status: 200,
      json: { data: { issues: { nodes: [] } } },
    });
    const backend = new LinearBackend(
      "lin_api_key",
      undefined,
      fetcher,
      "https://api.test",
    );
    backend.list();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.test");
    expect(calls[0].options.method).toBe("POST");

    const body = JSON.parse(calls[0].options.body!);
    expect(body.variables.filter.assignee).toEqual({ isMe: { eq: true } });
    expect(body.variables.filter.state).toEqual({
      type: { in: ["unstarted", "started"] },
    });
    expect(body.variables.filter.team).toBeUndefined();
  });

  it("constructs filter with team.key when teamKey is set", () => {
    const { fetcher, calls } = spyFetcher({
      ok: true,
      status: 200,
      json: { data: { issues: { nodes: [] } } },
    });
    const backend = new LinearBackend(
      "lin_api_key",
      "ENG",
      fetcher,
      "https://api.test",
    );
    backend.list();

    const body = JSON.parse(calls[0].options.body!);
    expect(body.variables.filter.team).toEqual({ key: { eq: "ENG" } });
    expect(body.variables.filter.assignee).toBeUndefined();
  });

  it("sends Authorization header with api key", () => {
    const { fetcher, calls } = spyFetcher({
      ok: true,
      status: 200,
      json: { data: { issues: { nodes: [] } } },
    });
    const backend = new LinearBackend(
      "lin_api_mytoken",
      undefined,
      fetcher,
      "https://api.test",
    );
    backend.list();

    expect(calls[0].options.headers.Authorization).toBe("lin_api_mytoken");
    expect(calls[0].options.headers["Content-Type"]).toBe("application/json");
  });

  it("returns empty array when API call fails (auth error)", () => {
    const fetcher = mockFetcher({
      ok: false,
      status: 401,
      json: { errors: [{ message: "Unauthorized" }] },
    });
    const backend = new LinearBackend(
      "bad_key",
      undefined,
      fetcher,
      "https://api.test",
    );
    expect(backend.list()).toEqual([]);
  });

  it("returns empty array when response has no nodes array", () => {
    const fetcher = mockFetcher({
      ok: true,
      status: 200,
      json: { data: {} },
    });
    const backend = new LinearBackend(
      "lin_api_key",
      undefined,
      fetcher,
      "https://api.test",
    );
    expect(backend.list()).toEqual([]);
  });

  it("returns empty array when json is null", () => {
    const fetcher = mockFetcher({ ok: true, status: 200, json: null });
    const backend = new LinearBackend(
      "lin_api_key",
      undefined,
      fetcher,
      "https://api.test",
    );
    expect(backend.list()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// LinearBackend.read
// ---------------------------------------------------------------------------
describe("LinearBackend.read", () => {
  it("reads a single issue by LIN-ENG-42 format", () => {
    const issue = sampleIssue({ identifier: "ENG-42" });
    const { fetcher, calls } = spyFetcher({
      ok: true,
      status: 200,
      json: { data: { issues: { nodes: [issue] } } },
    });
    const backend = new LinearBackend(
      "lin_api_key",
      undefined,
      fetcher,
      "https://api.test",
    );
    const item = backend.read("LIN-ENG-42");

    expect(item).toBeDefined();
    expect(item!.id).toBe("LIN-ENG-42");
    expect(item!.title).toBe("Implement feature Y");

    // Verify identifier was stripped for the filter
    const body = JSON.parse(calls[0].options.body!);
    expect(body.variables.filter.identifier).toEqual({ eq: "ENG-42" });
  });

  it("reads a single issue by plain identifier (no LIN- prefix)", () => {
    const issue = sampleIssue({ identifier: "INFRA-5" });
    const { fetcher, calls } = spyFetcher({
      ok: true,
      status: 200,
      json: { data: { issues: { nodes: [issue] } } },
    });
    const backend = new LinearBackend(
      "lin_api_key",
      undefined,
      fetcher,
      "https://api.test",
    );
    const item = backend.read("INFRA-5");

    expect(item).toBeDefined();
    expect(item!.id).toBe("LIN-INFRA-5");
    const body = JSON.parse(calls[0].options.body!);
    expect(body.variables.filter.identifier).toEqual({ eq: "INFRA-5" });
  });

  it("returns undefined when issue not found", () => {
    const fetcher = mockFetcher({
      ok: true,
      status: 200,
      json: { data: { issues: { nodes: [] } } },
    });
    const backend = new LinearBackend(
      "lin_api_key",
      undefined,
      fetcher,
      "https://api.test",
    );
    expect(backend.read("LIN-ENG-999")).toBeUndefined();
  });

  it("returns undefined when API call fails", () => {
    const fetcher = mockFetcher({
      ok: false,
      status: 401,
      json: { errors: [{ message: "Unauthorized" }] },
    });
    const backend = new LinearBackend(
      "bad_key",
      undefined,
      fetcher,
      "https://api.test",
    );
    expect(backend.read("LIN-ENG-1")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// LinearBackend.markDone
// ---------------------------------------------------------------------------
describe("LinearBackend.markDone", () => {
  it("transitions issue to completed state via three-step API flow", () => {
    const { fetcher, calls } = multiStepFetcher([
      // Step 1: fetch issue
      {
        ok: true,
        status: 200,
        json: {
          data: {
            issues: {
              nodes: [
                {
                  id: "uuid-issue-1",
                  team: { id: "uuid-team-1" },
                  state: { type: "started" },
                },
              ],
            },
          },
        },
      },
      // Step 2: fetch workflow states
      {
        ok: true,
        status: 200,
        json: {
          data: {
            workflowStates: {
              nodes: [{ id: "uuid-done-state" }],
            },
          },
        },
      },
      // Step 3: update issue state
      {
        ok: true,
        status: 200,
        json: { data: { issueUpdate: { success: true } } },
      },
    ]);

    const backend = new LinearBackend(
      "lin_api_key",
      undefined,
      fetcher,
      "https://api.test",
    );
    const result = backend.markDone("LIN-ENG-42");

    expect(result).toBe(true);
    expect(calls).toHaveLength(3);

    // Step 1: fetch issue by identifier
    const fetchBody = JSON.parse(calls[0].options.body!);
    expect(fetchBody.variables.filter.identifier).toEqual({ eq: "ENG-42" });

    // Step 2: fetch workflow states for team
    const statesBody = JSON.parse(calls[1].options.body!);
    expect(statesBody.variables.filter.team).toEqual({
      id: { eq: "uuid-team-1" },
    });
    expect(statesBody.variables.filter.type).toEqual({ eq: "completed" });

    // Step 3: update issue
    const updateBody = JSON.parse(calls[2].options.body!);
    expect(updateBody.variables.id).toBe("uuid-issue-1");
    expect(updateBody.variables.stateId).toBe("uuid-done-state");
  });

  it("is idempotent — already-completed issue returns true without mutation", () => {
    const { fetcher, calls } = spyFetcher({
      ok: true,
      status: 200,
      json: {
        data: {
          issues: {
            nodes: [
              {
                id: "uuid-issue-1",
                team: { id: "uuid-team-1" },
                state: { type: "completed" },
              },
            ],
          },
        },
      },
    });

    const backend = new LinearBackend(
      "lin_api_key",
      undefined,
      fetcher,
      "https://api.test",
    );
    const result = backend.markDone("LIN-ENG-10");

    expect(result).toBe(true);
    expect(calls).toHaveLength(1); // Only the fetch — no mutation
  });

  it("is idempotent — cancelled issue returns true without mutation", () => {
    const fetcher = mockFetcher({
      ok: true,
      status: 200,
      json: {
        data: {
          issues: {
            nodes: [
              {
                id: "uuid-issue-2",
                team: { id: "uuid-team-1" },
                state: { type: "cancelled" },
              },
            ],
          },
        },
      },
    });

    const backend = new LinearBackend(
      "lin_api_key",
      undefined,
      fetcher,
      "https://api.test",
    );
    expect(backend.markDone("LIN-ENG-11")).toBe(true);
  });

  it("returns false when issue is not found", () => {
    const fetcher = mockFetcher({
      ok: true,
      status: 200,
      json: { data: { issues: { nodes: [] } } },
    });
    const backend = new LinearBackend(
      "lin_api_key",
      undefined,
      fetcher,
      "https://api.test",
    );
    expect(backend.markDone("LIN-ENG-999")).toBe(false);
  });

  it("returns false when API call fails (auth error)", () => {
    const fetcher = mockFetcher({
      ok: false,
      status: 401,
      json: { errors: [{ message: "Unauthorized" }] },
    });
    const backend = new LinearBackend(
      "bad_key",
      undefined,
      fetcher,
      "https://api.test",
    );
    expect(backend.markDone("LIN-ENG-1")).toBe(false);
  });

  it("sends correct mutation body", () => {
    const { fetcher, calls } = multiStepFetcher([
      {
        ok: true,
        status: 200,
        json: {
          data: {
            issues: {
              nodes: [
                {
                  id: "uuid-42",
                  team: { id: "uuid-team-7" },
                  state: { type: "unstarted" },
                },
              ],
            },
          },
        },
      },
      {
        ok: true,
        status: 200,
        json: { data: { workflowStates: { nodes: [{ id: "uuid-done-99" }] } } },
      },
      {
        ok: true,
        status: 200,
        json: { data: { issueUpdate: { success: true } } },
      },
    ]);

    const backend = new LinearBackend(
      "lin_api_key",
      undefined,
      fetcher,
      "https://api.test",
    );
    backend.markDone("ENG-42"); // no LIN- prefix

    const updateBody = JSON.parse(calls[2].options.body!);
    expect(updateBody.variables).toEqual({
      id: "uuid-42",
      stateId: "uuid-done-99",
    });
  });
});

// ---------------------------------------------------------------------------
// LinearBackend.addStatusLabel
// ---------------------------------------------------------------------------
describe("LinearBackend.addStatusLabel", () => {
  it("finds existing label and adds it to the issue", () => {
    const { fetcher, calls } = multiStepFetcher([
      // Step 1: fetch issue (no existing labels)
      {
        ok: true,
        status: 200,
        json: {
          data: {
            issues: {
              nodes: [
                {
                  id: "uuid-issue-1",
                  team: { id: "uuid-team-1" },
                  labels: { nodes: [] },
                },
              ],
            },
          },
        },
      },
      // Step 2: search for label (found)
      {
        ok: true,
        status: 200,
        json: {
          data: {
            issueLabels: {
              nodes: [{ id: "uuid-label-ip", name: "ninthwave:in-progress" }],
            },
          },
        },
      },
      // Step 3: update issue labels
      {
        ok: true,
        status: 200,
        json: { data: { issueUpdate: { success: true } } },
      },
    ]);

    const backend = new LinearBackend(
      "lin_api_key",
      undefined,
      fetcher,
      "https://api.test",
    );
    const result = backend.addStatusLabel(
      "LIN-ENG-42",
      "ninthwave:in-progress",
    );

    expect(result).toBe(true);
    expect(calls).toHaveLength(3);

    // Step 3: verify label was added
    const updateBody = JSON.parse(calls[2].options.body!);
    expect(updateBody.variables.id).toBe("uuid-issue-1");
    expect(updateBody.variables.labelIds).toEqual(["uuid-label-ip"]);
  });

  it("is idempotent — adding an already-present label skips the update", () => {
    const { fetcher, calls } = spyFetcher({
      ok: true,
      status: 200,
      json: {
        data: {
          issues: {
            nodes: [
              {
                id: "uuid-issue-1",
                team: { id: "uuid-team-1" },
                labels: {
                  nodes: [
                    { id: "uuid-label-ip", name: "ninthwave:in-progress" },
                  ],
                },
              },
            ],
          },
        },
      },
    });

    const backend = new LinearBackend(
      "lin_api_key",
      undefined,
      fetcher,
      "https://api.test",
    );
    const result = backend.addStatusLabel(
      "LIN-ENG-42",
      "ninthwave:in-progress",
    );

    expect(result).toBe(true);
    expect(calls).toHaveLength(1); // Only the fetch — no label search/update
  });

  it("creates label when not found and adds it to issue", () => {
    const { fetcher, calls } = multiStepFetcher([
      // Step 1: fetch issue
      {
        ok: true,
        status: 200,
        json: {
          data: {
            issues: {
              nodes: [
                {
                  id: "uuid-issue-1",
                  team: { id: "uuid-team-1" },
                  labels: { nodes: [] },
                },
              ],
            },
          },
        },
      },
      // Step 2: search for label (not found)
      {
        ok: true,
        status: 200,
        json: { data: { issueLabels: { nodes: [] } } },
      },
      // Step 3: create label
      {
        ok: true,
        status: 200,
        json: {
          data: {
            issueLabelCreate: {
              success: true,
              issueLabel: { id: "uuid-new-label" },
            },
          },
        },
      },
      // Step 4: update issue labels
      {
        ok: true,
        status: 200,
        json: { data: { issueUpdate: { success: true } } },
      },
    ]);

    const backend = new LinearBackend(
      "lin_api_key",
      undefined,
      fetcher,
      "https://api.test",
    );
    const result = backend.addStatusLabel("LIN-ENG-1", "ninthwave:pr-open");

    expect(result).toBe(true);
    expect(calls).toHaveLength(4);

    // Verify label create was called with correct input
    const createBody = JSON.parse(calls[2].options.body!);
    expect(createBody.variables.input.name).toBe("ninthwave:pr-open");
    expect(createBody.variables.input.teamId).toBe("uuid-team-1");
  });

  it("returns false when API call fails (auth error)", () => {
    const fetcher = mockFetcher({
      ok: false,
      status: 401,
      json: { errors: [{ message: "Unauthorized" }] },
    });
    const backend = new LinearBackend(
      "bad_key",
      undefined,
      fetcher,
      "https://api.test",
    );
    expect(
      backend.addStatusLabel("LIN-ENG-1", "ninthwave:in-progress"),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// LinearBackend.removeStatusLabel
// ---------------------------------------------------------------------------
describe("LinearBackend.removeStatusLabel", () => {
  it("removes a label from the issue", () => {
    const { fetcher, calls } = multiStepFetcher([
      // Step 1: fetch issue with label
      {
        ok: true,
        status: 200,
        json: {
          data: {
            issues: {
              nodes: [
                {
                  id: "uuid-issue-1",
                  team: { id: "uuid-team-1" },
                  labels: {
                    nodes: [
                      { id: "uuid-label-ip", name: "ninthwave:in-progress" },
                      { id: "uuid-label-other", name: "bug" },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
      // Step 2: update issue labels (without removed label)
      {
        ok: true,
        status: 200,
        json: { data: { issueUpdate: { success: true } } },
      },
    ]);

    const backend = new LinearBackend(
      "lin_api_key",
      undefined,
      fetcher,
      "https://api.test",
    );
    const result = backend.removeStatusLabel(
      "LIN-ENG-42",
      "ninthwave:in-progress",
    );

    expect(result).toBe(true);
    expect(calls).toHaveLength(2);

    // Step 2: verify label was removed (only "bug" remains)
    const updateBody = JSON.parse(calls[1].options.body!);
    expect(updateBody.variables.labelIds).toEqual(["uuid-label-other"]);
  });

  it("is idempotent — removing a missing label returns true without update", () => {
    const { fetcher, calls } = spyFetcher({
      ok: true,
      status: 200,
      json: {
        data: {
          issues: {
            nodes: [
              {
                id: "uuid-issue-1",
                team: { id: "uuid-team-1" },
                labels: { nodes: [{ id: "uuid-other", name: "bug" }] },
              },
            ],
          },
        },
      },
    });

    const backend = new LinearBackend(
      "lin_api_key",
      undefined,
      fetcher,
      "https://api.test",
    );
    const result = backend.removeStatusLabel(
      "LIN-ENG-42",
      "ninthwave:in-progress",
    );

    expect(result).toBe(true);
    expect(calls).toHaveLength(1); // Only the fetch — no update
  });

  it("returns true even when fetch fails (graceful)", () => {
    const fetcher = mockFetcher({
      ok: false,
      status: 401,
      json: { errors: [{ message: "Unauthorized" }] },
    });
    const backend = new LinearBackend(
      "bad_key",
      undefined,
      fetcher,
      "https://api.test",
    );
    // removeStatusLabel always returns true (idempotent)
    expect(
      backend.removeStatusLabel("LIN-ENG-1", "ninthwave:in-progress"),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// LinearBackend.removeAllStatusLabels
// ---------------------------------------------------------------------------
describe("LinearBackend.removeAllStatusLabels", () => {
  it("calls removeStatusLabel for each STATUS_TAG", () => {
    // Each removeStatusLabel call makes one fetch (label not found → early return)
    const { fetcher, calls } = spyFetcher({
      ok: true,
      status: 200,
      json: {
        data: {
          issues: {
            nodes: [
              {
                id: "uuid-issue-1",
                team: { id: "uuid-team-1" },
                labels: { nodes: [] },
              },
            ],
          },
        },
      },
    });

    const backend = new LinearBackend(
      "lin_api_key",
      undefined,
      fetcher,
      "https://api.test",
    );
    backend.removeAllStatusLabels("LIN-ENG-5");

    expect(calls).toHaveLength(STATUS_TAGS.length);
  });
});

// ---------------------------------------------------------------------------
// STATUS_TAGS constant
// ---------------------------------------------------------------------------
describe("STATUS_TAGS", () => {
  it("includes expected tags", () => {
    expect(STATUS_TAGS).toContain("ninthwave:in-progress");
    expect(STATUS_TAGS).toContain("ninthwave:pr-open");
  });
});

// ---------------------------------------------------------------------------
// resolveLinearConfig
// ---------------------------------------------------------------------------
describe("resolveLinearConfig", () => {
  const origLinearApiKey = process.env.LINEAR_API_KEY;
  const origLinearTeamKey = process.env.LINEAR_TEAM_KEY;

  afterEach(() => {
    if (origLinearApiKey !== undefined) {
      process.env.LINEAR_API_KEY = origLinearApiKey;
    } else {
      delete process.env.LINEAR_API_KEY;
    }
    if (origLinearTeamKey !== undefined) {
      process.env.LINEAR_TEAM_KEY = origLinearTeamKey;
    } else {
      delete process.env.LINEAR_TEAM_KEY;
    }
  });

  it("returns config when LINEAR_API_KEY env var is set", () => {
    process.env.LINEAR_API_KEY = "lin_api_test";
    delete process.env.LINEAR_TEAM_KEY;

    const result = resolveLinearConfig(() => undefined);

    expect(result).toEqual({ apiKey: "lin_api_test", teamKey: undefined });
  });

  it("falls back to config getter for api key", () => {
    delete process.env.LINEAR_API_KEY;

    const result = resolveLinearConfig((key) =>
      key === "linear_api_key" ? "lin_api_from_config" : undefined,
    );

    expect(result).toEqual({ apiKey: "lin_api_from_config", teamKey: undefined });
  });

  it("env var takes priority over config getter for api key", () => {
    process.env.LINEAR_API_KEY = "lin_api_env";

    const result = resolveLinearConfig((key) =>
      key === "linear_api_key" ? "lin_api_config" : undefined,
    );

    expect(result!.apiKey).toBe("lin_api_env");
  });

  it("returns teamKey from LINEAR_TEAM_KEY env var", () => {
    process.env.LINEAR_API_KEY = "lin_api_test";
    process.env.LINEAR_TEAM_KEY = "ENG";

    const result = resolveLinearConfig(() => undefined);

    expect(result!.teamKey).toBe("ENG");
  });

  it("falls back to config getter for team key", () => {
    process.env.LINEAR_API_KEY = "lin_api_test";
    delete process.env.LINEAR_TEAM_KEY;

    const result = resolveLinearConfig((key) =>
      key === "linear_team_key" ? "INFRA" : undefined,
    );

    expect(result!.teamKey).toBe("INFRA");
  });

  it("returns teamKey as undefined when not configured", () => {
    process.env.LINEAR_API_KEY = "lin_api_test";
    delete process.env.LINEAR_TEAM_KEY;

    const result = resolveLinearConfig(() => undefined);

    expect(result!.teamKey).toBeUndefined();
  });

  it("returns null when neither env var nor config provides api key", () => {
    delete process.env.LINEAR_API_KEY;

    const result = resolveLinearConfig(() => undefined);

    expect(result).toBeNull();
  });
});
