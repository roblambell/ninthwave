// Tests for core/backends/sentry.ts
// Uses dependency injection (not vi.mock/vi.spyOn) to avoid Bun runtime dependency.

import { describe, it, expect, afterEach } from "vitest";
import {
  mapSentryLevel,
  issueToTodoItem,
  extractFilePaths,
  SentryBackend,
  resolveSentryConfig,
  STATUS_TAGS,
} from "../core/backends/sentry.ts";
import type {
  SentryIssue,
  SentryStacktraceFrame,
  HttpFetcher,
} from "../core/backends/sentry.ts";

/** Create a mock HttpFetcher that returns a fixed result. */
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

/** Create a mock HttpFetcher that returns different results per call index. */
function sequenceFetcher(
  results: Array<{ ok: boolean; status: number; json: unknown }>,
): {
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
  let idx = 0;
  const fetcher: HttpFetcher = (url, options) => {
    calls.push({ url, options });
    const result = results[idx] ?? results[results.length - 1];
    idx++;
    return result;
  };
  return { fetcher, calls };
}

/** Create a sample Sentry issue for testing. */
function sampleIssue(overrides: Partial<SentryIssue> = {}): SentryIssue {
  return {
    id: "12345",
    title: "TypeError: Cannot read property 'foo' of undefined",
    culprit: "app.controllers.main in handle_request",
    level: "error",
    firstSeen: "2026-03-20T10:00:00Z",
    lastSeen: "2026-03-25T14:30:00Z",
    count: "42",
    project: { slug: "my-project" },
    metadata: { filename: "app/controllers/main.py" },
    assignedTo: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// mapSentryLevel
// ---------------------------------------------------------------------------
describe("mapSentryLevel", () => {
  it("maps fatal to critical", () => {
    expect(mapSentryLevel("fatal")).toBe("critical");
  });

  it("maps error to high", () => {
    expect(mapSentryLevel("error")).toBe("high");
  });

  it("maps warning to medium", () => {
    expect(mapSentryLevel("warning")).toBe("medium");
  });

  it("maps info to low", () => {
    expect(mapSentryLevel("info")).toBe("low");
  });

  it("maps debug to low", () => {
    expect(mapSentryLevel("debug")).toBe("low");
  });

  it("defaults to medium for unknown level", () => {
    expect(mapSentryLevel("unknown")).toBe("medium");
  });

  it("defaults to medium for empty string", () => {
    expect(mapSentryLevel("")).toBe("medium");
  });
});

// ---------------------------------------------------------------------------
// extractFilePaths
// ---------------------------------------------------------------------------
describe("extractFilePaths", () => {
  it("extracts unique file paths from stacktrace frames", () => {
    const frames: SentryStacktraceFrame[] = [
      { filename: "app/main.py", lineNo: 42 },
      { filename: "app/utils.py", lineNo: 10 },
      { filename: "app/main.py", lineNo: 50 }, // duplicate
    ];
    const paths = extractFilePaths(frames);
    expect(paths).toEqual(["app/main.py", "app/utils.py"]);
  });

  it("filters out internal frames starting with <", () => {
    const frames: SentryStacktraceFrame[] = [
      { filename: "<frozen importlib._bootstrap>" },
      { filename: "app/real.py" },
      { filename: "<string>" },
    ];
    const paths = extractFilePaths(frames);
    expect(paths).toEqual(["app/real.py"]);
  });

  it("returns empty array for undefined frames", () => {
    expect(extractFilePaths(undefined)).toEqual([]);
  });

  it("returns empty array for empty frames array", () => {
    expect(extractFilePaths([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// issueToTodoItem
// ---------------------------------------------------------------------------
describe("issueToTodoItem", () => {
  it("converts a full Sentry issue to TodoItem shape", () => {
    const issue = sampleIssue();
    const item = issueToTodoItem(issue);

    expect(item.id).toBe("SNT-12345");
    expect(item.title).toBe(
      "TypeError: Cannot read property 'foo' of undefined",
    );
    expect(item.priority).toBe("high");
    expect(item.domain).toBe("my-project");
    expect(item.rawText).toContain("**Culprit:**");
    expect(item.rawText).toContain("app.controllers.main in handle_request");
    expect(item.rawText).toContain("**Event count:** 42");
    expect(item.dependencies).toEqual([]);
    expect(item.bundleWith).toEqual([]);
    expect(item.status).toBe("open");
    expect(item.filePath).toBe("");
    expect(item.repoAlias).toBe("");
    expect(item.filePaths).toEqual([]);
    expect(item.testPlan).toBe("");
  });

  it("includes file paths when provided", () => {
    const issue = sampleIssue();
    const item = issueToTodoItem(issue, ["app/main.py", "app/utils.py"]);
    expect(item.filePaths).toEqual(["app/main.py", "app/utils.py"]);
  });

  it("truncates very long titles", () => {
    const longTitle = "A".repeat(250);
    const issue = sampleIssue({ title: longTitle });
    const item = issueToTodoItem(issue);
    expect(item.title.length).toBe(201); // 200 chars + "…"
    expect(item.title.endsWith("…")).toBe(true);
  });

  it("handles issue with no project (uncategorized domain)", () => {
    const issue = sampleIssue({
      project: undefined as unknown as SentryIssue["project"],
    });
    const item = issueToTodoItem(issue);
    expect(item.domain).toBe("uncategorized");
  });

  it("handles issue with empty culprit", () => {
    const issue = sampleIssue({ culprit: "" });
    const item = issueToTodoItem(issue);
    expect(item.rawText).toContain("**Culprit:** unknown");
  });

  it("maps all severity levels correctly", () => {
    expect(issueToTodoItem(sampleIssue({ level: "fatal" })).priority).toBe(
      "critical",
    );
    expect(issueToTodoItem(sampleIssue({ level: "error" })).priority).toBe(
      "high",
    );
    expect(issueToTodoItem(sampleIssue({ level: "warning" })).priority).toBe(
      "medium",
    );
    expect(issueToTodoItem(sampleIssue({ level: "info" })).priority).toBe(
      "low",
    );
    expect(issueToTodoItem(sampleIssue({ level: "debug" })).priority).toBe(
      "low",
    );
  });
});

// ---------------------------------------------------------------------------
// SentryBackend.list
// ---------------------------------------------------------------------------
describe("SentryBackend.list", () => {
  it("returns TodoItems from Sentry API response", () => {
    const issues: SentryIssue[] = [
      sampleIssue({ id: "100", title: "First error" }),
      sampleIssue({
        id: "200",
        title: "Second error",
        level: "fatal",
        project: { slug: "other-project" },
      }),
    ];

    const fetcher = mockFetcher({ ok: true, status: 200, json: issues });
    const backend = new SentryBackend(
      "my-org",
      "my-proj",
      "token123",
      fetcher,
      "https://api.test",
    );
    const items = backend.list();

    expect(items).toHaveLength(2);
    expect(items[0].id).toBe("SNT-100");
    expect(items[0].title).toBe("First error");
    expect(items[0].priority).toBe("high");
    expect(items[1].id).toBe("SNT-200");
    expect(items[1].priority).toBe("critical");
    expect(items[1].domain).toBe("other-project");
  });

  it("passes correct URL with org and project", () => {
    const { fetcher, calls } = spyFetcher({
      ok: true,
      status: 200,
      json: [],
    });

    const backend = new SentryBackend(
      "my-org",
      "my-proj",
      "token123",
      fetcher,
      "https://api.test",
    );
    backend.list();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://api.test/projects/my-org/my-proj/issues/?query=is:unresolved",
    );
    expect(calls[0].options.method).toBe("GET");
    expect(calls[0].options.headers.Authorization).toBe("Bearer token123");
    expect(calls[0].options.headers["Content-Type"]).toBe("application/json");
  });

  it("returns empty array when API call fails", () => {
    const fetcher = mockFetcher({
      ok: false,
      status: 401,
      json: { detail: "unauthorized" },
    });
    const backend = new SentryBackend(
      "my-org",
      "my-proj",
      "bad_token",
      fetcher,
      "https://api.test",
    );
    const items = backend.list();
    expect(items).toEqual([]);
  });

  it("returns empty array when response is not an array", () => {
    const fetcher = mockFetcher({
      ok: true,
      status: 200,
      json: { detail: "not found" },
    });
    const backend = new SentryBackend(
      "my-org",
      "my-proj",
      "token123",
      fetcher,
      "https://api.test",
    );
    const items = backend.list();
    expect(items).toEqual([]);
  });

  it("returns empty array when json is null (malformed response)", () => {
    const fetcher = mockFetcher({ ok: true, status: 200, json: null });
    const backend = new SentryBackend(
      "my-org",
      "my-proj",
      "token123",
      fetcher,
      "https://api.test",
    );
    const items = backend.list();
    expect(items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SentryBackend.read
// ---------------------------------------------------------------------------
describe("SentryBackend.read", () => {
  it("reads a single issue by SNT-N format", () => {
    const issue = sampleIssue({ id: "789" });
    const latestEvent = {
      entries: [
        {
          type: "exception",
          data: {
            values: [
              {
                stacktrace: {
                  frames: [
                    { filename: "app/main.py", lineNo: 42 },
                    { filename: "app/utils.py", lineNo: 10 },
                  ],
                },
              },
            ],
          },
        },
      ],
    };

    const { fetcher, calls } = sequenceFetcher([
      { ok: true, status: 200, json: issue },
      { ok: true, status: 200, json: latestEvent },
    ]);

    const backend = new SentryBackend(
      "my-org",
      "my-proj",
      "token123",
      fetcher,
      "https://api.test",
    );
    const item = backend.read("SNT-789");

    expect(item).toBeDefined();
    expect(item!.id).toBe("SNT-789");
    expect(item!.filePaths).toEqual(["app/main.py", "app/utils.py"]);

    // Verify the SNT- prefix was stripped for the API call
    expect(calls[0].url).toBe("https://api.test/issues/789/");
    expect(calls[1].url).toBe("https://api.test/issues/789/events/latest/");
  });

  it("reads a single issue by plain id string", () => {
    const issue = sampleIssue({ id: "plain123" });
    const { fetcher } = sequenceFetcher([
      { ok: true, status: 200, json: issue },
      { ok: true, status: 200, json: { entries: [] } },
    ]);

    const backend = new SentryBackend(
      "my-org",
      "my-proj",
      "token123",
      fetcher,
      "https://api.test",
    );
    const item = backend.read("plain123");

    expect(item).toBeDefined();
    expect(item!.id).toBe("SNT-plain123");
  });

  it("returns undefined when issue not found", () => {
    const fetcher = mockFetcher({
      ok: false,
      status: 404,
      json: { detail: "not found" },
    });
    const backend = new SentryBackend(
      "my-org",
      "my-proj",
      "token123",
      fetcher,
      "https://api.test",
    );
    const item = backend.read("SNT-missing");
    expect(item).toBeUndefined();
  });

  it("returns undefined when json is null", () => {
    const fetcher = mockFetcher({ ok: true, status: 200, json: null });
    const backend = new SentryBackend(
      "my-org",
      "my-proj",
      "token123",
      fetcher,
      "https://api.test",
    );
    const item = backend.read("SNT-x");
    expect(item).toBeUndefined();
  });

  it("returns empty filePaths when latest event fetch fails", () => {
    const issue = sampleIssue({ id: "456" });
    const { fetcher } = sequenceFetcher([
      { ok: true, status: 200, json: issue },
      { ok: false, status: 500, json: null }, // event fetch fails
    ]);

    const backend = new SentryBackend(
      "my-org",
      "my-proj",
      "token123",
      fetcher,
      "https://api.test",
    );
    const item = backend.read("SNT-456");

    expect(item).toBeDefined();
    expect(item!.filePaths).toEqual([]);
  });

  it("returns empty filePaths when no stacktrace in event", () => {
    const issue = sampleIssue({ id: "456" });
    const { fetcher } = sequenceFetcher([
      { ok: true, status: 200, json: issue },
      { ok: true, status: 200, json: { entries: [{ type: "message" }] } },
    ]);

    const backend = new SentryBackend(
      "my-org",
      "my-proj",
      "token123",
      fetcher,
      "https://api.test",
    );
    const item = backend.read("SNT-456");

    expect(item).toBeDefined();
    expect(item!.filePaths).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SentryBackend.markDone
// ---------------------------------------------------------------------------
describe("SentryBackend.markDone", () => {
  it("sends PUT with status=resolved to correct issue URL", () => {
    const { fetcher, calls } = spyFetcher({
      ok: true,
      status: 200,
      json: {},
    });
    const backend = new SentryBackend(
      "my-org",
      "my-proj",
      "token123",
      fetcher,
      "https://api.test",
    );

    const result = backend.markDone("SNT-42");

    expect(result).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.test/issues/42/");
    expect(calls[0].options.method).toBe("PUT");
    expect(calls[0].options.body).toBe(
      JSON.stringify({ status: "resolved" }),
    );
  });

  it("strips SNT- prefix from id", () => {
    const { fetcher, calls } = spyFetcher({
      ok: true,
      status: 200,
      json: {},
    });
    const backend = new SentryBackend(
      "my-org",
      "my-proj",
      "token123",
      fetcher,
      "https://api.test",
    );

    backend.markDone("SNT-abc");
    expect(calls[0].url).toBe("https://api.test/issues/abc/");
  });

  it("accepts plain id string", () => {
    const { fetcher, calls } = spyFetcher({
      ok: true,
      status: 200,
      json: {},
    });
    const backend = new SentryBackend(
      "my-org",
      "my-proj",
      "token123",
      fetcher,
      "https://api.test",
    );

    backend.markDone("plain456");
    expect(calls[0].url).toBe("https://api.test/issues/plain456/");
  });

  it("returns false when API call fails", () => {
    const fetcher = mockFetcher({
      ok: false,
      status: 500,
      json: { detail: "server error" },
    });
    const backend = new SentryBackend(
      "my-org",
      "my-proj",
      "token123",
      fetcher,
      "https://api.test",
    );
    expect(backend.markDone("SNT-x")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SentryBackend.addStatusLabel
// ---------------------------------------------------------------------------
describe("SentryBackend.addStatusLabel", () => {
  it("PUTs assignedTo to correct issue URL", () => {
    const { fetcher, calls } = spyFetcher({
      ok: true,
      status: 200,
      json: {},
    });
    const backend = new SentryBackend(
      "my-org",
      "my-proj",
      "token123",
      fetcher,
      "https://api.test",
    );

    const result = backend.addStatusLabel("SNT-10", "ninthwave:in-progress");

    expect(result).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.test/issues/10/");
    expect(calls[0].options.method).toBe("PUT");
    expect(calls[0].options.body).toBe(
      JSON.stringify({ assignedTo: "ninthwave:in-progress" }),
    );
  });

  it("returns false when API call fails", () => {
    const fetcher = mockFetcher({
      ok: false,
      status: 400,
      json: { detail: "bad request" },
    });
    const backend = new SentryBackend(
      "my-org",
      "my-proj",
      "token123",
      fetcher,
      "https://api.test",
    );
    expect(
      backend.addStatusLabel("SNT-x", "ninthwave:pr-open"),
    ).toBe(false);
  });

  it("is idempotent — adding same label twice succeeds", () => {
    const { fetcher, calls } = spyFetcher({
      ok: true,
      status: 200,
      json: {},
    });
    const backend = new SentryBackend(
      "my-org",
      "my-proj",
      "token123",
      fetcher,
      "https://api.test",
    );

    backend.addStatusLabel("SNT-10", "ninthwave:in-progress");
    backend.addStatusLabel("SNT-10", "ninthwave:in-progress");

    expect(calls).toHaveLength(2);
    // Both calls should succeed (idempotent)
  });
});

// ---------------------------------------------------------------------------
// SentryBackend.removeStatusLabel
// ---------------------------------------------------------------------------
describe("SentryBackend.removeStatusLabel", () => {
  it("PUTs empty assignedTo to correct issue URL", () => {
    const { fetcher, calls } = spyFetcher({
      ok: true,
      status: 200,
      json: {},
    });
    const backend = new SentryBackend(
      "my-org",
      "my-proj",
      "token123",
      fetcher,
      "https://api.test",
    );

    const result = backend.removeStatusLabel("SNT-10", "ninthwave:in-progress");

    expect(result).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.test/issues/10/");
    expect(calls[0].options.method).toBe("PUT");
    expect(calls[0].options.body).toBe(JSON.stringify({ assignedTo: "" }));
  });

  it("returns true even when label does not exist (graceful skip)", () => {
    const fetcher = mockFetcher({
      ok: false,
      status: 404,
      json: { detail: "not found" },
    });
    const backend = new SentryBackend(
      "my-org",
      "my-proj",
      "token123",
      fetcher,
      "https://api.test",
    );
    expect(
      backend.removeStatusLabel("SNT-x", "ninthwave:nonexistent"),
    ).toBe(true);
  });

  it("is idempotent — removing same label twice succeeds", () => {
    const { fetcher, calls } = spyFetcher({
      ok: true,
      status: 200,
      json: {},
    });
    const backend = new SentryBackend(
      "my-org",
      "my-proj",
      "token123",
      fetcher,
      "https://api.test",
    );

    backend.removeStatusLabel("SNT-10", "ninthwave:in-progress");
    backend.removeStatusLabel("SNT-10", "ninthwave:in-progress");

    expect(calls).toHaveLength(2);
    // Both calls return true (idempotent)
  });
});

// ---------------------------------------------------------------------------
// SentryBackend.removeAllStatusLabels
// ---------------------------------------------------------------------------
describe("SentryBackend.removeAllStatusLabels", () => {
  it("removes all known status tags", () => {
    const { fetcher, calls } = spyFetcher({
      ok: true,
      status: 200,
      json: {},
    });
    const backend = new SentryBackend(
      "my-org",
      "my-proj",
      "token123",
      fetcher,
      "https://api.test",
    );

    backend.removeAllStatusLabels("SNT-8");

    expect(calls).toHaveLength(STATUS_TAGS.length);
    for (const call of calls) {
      expect(call.url).toBe("https://api.test/issues/8/");
      expect(call.options.method).toBe("PUT");
      expect(call.options.body).toBe(JSON.stringify({ assignedTo: "" }));
    }
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
// resolveSentryConfig
// ---------------------------------------------------------------------------
describe("resolveSentryConfig", () => {
  const originalToken = process.env.SENTRY_AUTH_TOKEN;
  const originalOrg = process.env.SENTRY_ORG;
  const originalProject = process.env.SENTRY_PROJECT;

  afterEach(() => {
    // Restore original env vars
    if (originalToken !== undefined) {
      process.env.SENTRY_AUTH_TOKEN = originalToken;
    } else {
      delete process.env.SENTRY_AUTH_TOKEN;
    }
    if (originalOrg !== undefined) {
      process.env.SENTRY_ORG = originalOrg;
    } else {
      delete process.env.SENTRY_ORG;
    }
    if (originalProject !== undefined) {
      process.env.SENTRY_PROJECT = originalProject;
    } else {
      delete process.env.SENTRY_PROJECT;
    }
  });

  it("returns config when all env vars are set", () => {
    process.env.SENTRY_AUTH_TOKEN = "test_token";
    process.env.SENTRY_ORG = "my-org";
    process.env.SENTRY_PROJECT = "my-proj";

    const result = resolveSentryConfig(() => undefined);

    expect(result).toEqual({
      authToken: "test_token",
      org: "my-org",
      project: "my-proj",
    });
  });

  it("falls back to config getter for org and project", () => {
    process.env.SENTRY_AUTH_TOKEN = "test_token";
    delete process.env.SENTRY_ORG;
    delete process.env.SENTRY_PROJECT;

    const result = resolveSentryConfig((key) => {
      if (key === "sentry_org") return "config-org";
      if (key === "sentry_project") return "config-proj";
      return undefined;
    });

    expect(result).toEqual({
      authToken: "test_token",
      org: "config-org",
      project: "config-proj",
    });
  });

  it("prefers env vars over config", () => {
    process.env.SENTRY_AUTH_TOKEN = "test_token";
    process.env.SENTRY_ORG = "env-org";
    process.env.SENTRY_PROJECT = "env-proj";

    const result = resolveSentryConfig((key) => {
      if (key === "sentry_org") return "config-org";
      if (key === "sentry_project") return "config-proj";
      return undefined;
    });

    expect(result).toEqual({
      authToken: "test_token",
      org: "env-org",
      project: "env-proj",
    });
  });

  it("returns null when auth token is not set", () => {
    delete process.env.SENTRY_AUTH_TOKEN;
    process.env.SENTRY_ORG = "my-org";
    process.env.SENTRY_PROJECT = "my-proj";

    const result = resolveSentryConfig(() => undefined);
    expect(result).toBeNull();
  });

  it("returns null when org is not available from either source", () => {
    process.env.SENTRY_AUTH_TOKEN = "test_token";
    delete process.env.SENTRY_ORG;
    process.env.SENTRY_PROJECT = "my-proj";

    const result = resolveSentryConfig(() => undefined);
    expect(result).toBeNull();
  });

  it("returns null when project is not available from either source", () => {
    process.env.SENTRY_AUTH_TOKEN = "test_token";
    process.env.SENTRY_ORG = "my-org";
    delete process.env.SENTRY_PROJECT;

    const result = resolveSentryConfig(() => undefined);
    expect(result).toBeNull();
  });
});
