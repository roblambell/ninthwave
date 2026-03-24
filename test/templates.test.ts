// Tests for decomposition template loading and matching (core/templates.ts).

import { describe, it, expect, afterEach } from "vitest";
import { join } from "path";
import { mkdirSync, writeFileSync, existsSync } from "fs";
import { setupTempRepo, cleanupTempRepos } from "./helpers.ts";
import {
  parseTemplate,
  loadTemplates,
  matchTemplates,
  type DecompositionTemplate,
} from "../core/templates.ts";

afterEach(() => {
  cleanupTempRepos();
});

// --- parseTemplate ---

describe("parseTemplate", () => {
  it("extracts name from H1 heading", () => {
    const content = "# API Endpoint\n\nSome description.\n\n## Keywords\n\napi, endpoint\n";
    const result = parseTemplate("api-endpoint.md", content);
    expect(result.name).toBe("API Endpoint");
  });

  it("extracts slug from filename", () => {
    const content = "# API Endpoint\n\n## Keywords\n\napi\n";
    const result = parseTemplate("api-endpoint.md", content);
    expect(result.slug).toBe("api-endpoint");
  });

  it("extracts keywords from Keywords section", () => {
    const content = "# Test\n\n## Keywords\n\napi, endpoint, route, REST\n";
    const result = parseTemplate("test.md", content);
    expect(result.keywords).toEqual(["api", "endpoint", "route", "rest"]);
  });

  it("lowercases keywords", () => {
    const content = "# Test\n\n## Keywords\n\nAPI, React, SQL\n";
    const result = parseTemplate("test.md", content);
    expect(result.keywords).toEqual(["api", "react", "sql"]);
  });

  it("handles keywords with newlines between them", () => {
    const content = "# Test\n\n## Keywords\n\napi\nendpoint\nroute\n\n## Other\n";
    const result = parseTemplate("test.md", content);
    expect(result.keywords).toEqual(["api", "endpoint", "route"]);
  });

  it("falls back to slug when no H1 heading", () => {
    const content = "Some content without a heading.\n\n## Keywords\n\napi\n";
    const result = parseTemplate("my-template.md", content);
    expect(result.name).toBe("my-template");
  });

  it("returns empty keywords when no Keywords section", () => {
    const content = "# Test\n\nNo keywords section here.\n";
    const result = parseTemplate("test.md", content);
    expect(result.keywords).toEqual([]);
  });

  it("strips Keywords section from body", () => {
    const content = "# Test\n\nFull content here.\n\n## Keywords\n\napi\n\n## Other\n\nKeep this.\n";
    const result = parseTemplate("test.md", content);
    expect(result.body).not.toContain("## Keywords");
    expect(result.body).not.toContain("api\n\n## Other");
    expect(result.body).toContain("# Test");
    expect(result.body).toContain("Full content here.");
    expect(result.body).toContain("## Other");
    expect(result.body).toContain("Keep this.");
  });

  it("preserves all non-Keywords sections in body", () => {
    const content =
      "# Template\n\nIntro paragraph.\n\n## Keywords\n\napi, endpoint\n\n## Breakdown\n\nStep 1.\n\n## Guidance\n\nBe careful.\n";
    const result = parseTemplate("test.md", content);
    expect(result.body).toContain("# Template");
    expect(result.body).toContain("Intro paragraph.");
    expect(result.body).toContain("## Breakdown");
    expect(result.body).toContain("Step 1.");
    expect(result.body).toContain("## Guidance");
    expect(result.body).toContain("Be careful.");
    expect(result.body).not.toContain("## Keywords");
    expect(result.body).not.toContain("api, endpoint");
  });

  it("handles body with no Keywords section", () => {
    const content = "# Test\n\nJust content, no keywords.\n";
    const result = parseTemplate("test.md", content);
    expect(result.body).toContain("# Test");
    expect(result.body).toContain("Just content, no keywords.");
  });

  it("handles Keywords section at end of file", () => {
    const content = "# Test\n\nContent before.\n\n## Keywords\n\napi, route\n";
    const result = parseTemplate("test.md", content);
    expect(result.body).toContain("# Test");
    expect(result.body).toContain("Content before.");
    expect(result.body).not.toContain("## Keywords");
    expect(result.body).not.toContain("api, route");
  });
});

// --- loadTemplates ---

describe("loadTemplates", () => {
  it("loads all .md files from a directory", () => {
    const tmp = setupTempRepo();
    const dir = join(tmp, "templates");
    mkdirSync(dir);
    writeFileSync(join(dir, "api.md"), "# API\n\n## Keywords\n\napi\n");
    writeFileSync(join(dir, "ui.md"), "# UI\n\n## Keywords\n\ncomponent\n");

    const templates = loadTemplates(dir);
    expect(templates).toHaveLength(2);
    expect(templates.map((t) => t.slug)).toEqual(["api", "ui"]);
  });

  it("skips non-.md files", () => {
    const tmp = setupTempRepo();
    const dir = join(tmp, "templates");
    mkdirSync(dir);
    writeFileSync(join(dir, "api.md"), "# API\n\n## Keywords\n\napi\n");
    writeFileSync(join(dir, "notes.txt"), "Not a template");
    writeFileSync(join(dir, ".DS_Store"), "");

    const templates = loadTemplates(dir);
    expect(templates).toHaveLength(1);
    expect(templates[0].slug).toBe("api");
  });

  it("returns empty array for missing directory", () => {
    const templates = loadTemplates("/nonexistent/path/templates");
    expect(templates).toEqual([]);
  });

  it("returns empty array for empty directory", () => {
    const tmp = setupTempRepo();
    const dir = join(tmp, "templates");
    mkdirSync(dir);

    const templates = loadTemplates(dir);
    expect(templates).toEqual([]);
  });

  it("sorts templates alphabetically by filename", () => {
    const tmp = setupTempRepo();
    const dir = join(tmp, "templates");
    mkdirSync(dir);
    writeFileSync(join(dir, "zebra.md"), "# Zebra\n\n## Keywords\n\nz\n");
    writeFileSync(join(dir, "alpha.md"), "# Alpha\n\n## Keywords\n\na\n");
    writeFileSync(join(dir, "middle.md"), "# Middle\n\n## Keywords\n\nm\n");

    const templates = loadTemplates(dir);
    expect(templates.map((t) => t.slug)).toEqual(["alpha", "middle", "zebra"]);
  });

  it("accepts injected readDir and readFile for testability", () => {
    const fakeDir = (_path: string) => ["fake.md"];
    const fakeRead = (_path: string) => "# Fake\n\n## Keywords\n\ntest\n";

    const templates = loadTemplates("/any/path", fakeDir, fakeRead);
    expect(templates).toHaveLength(1);
    expect(templates[0].name).toBe("Fake");
  });
});

// --- matchTemplates ---

describe("matchTemplates", () => {
  const apiTemplate: DecompositionTemplate = {
    slug: "api-endpoint",
    name: "API Endpoint",
    keywords: ["api", "endpoint", "route", "controller", "rest", "handler"],
    body: "",
  };

  const uiTemplate: DecompositionTemplate = {
    slug: "frontend-component",
    name: "Frontend Component",
    keywords: ["component", "page", "ui", "frontend", "form", "react"],
    body: "",
  };

  const dbTemplate: DecompositionTemplate = {
    slug: "database-migration",
    name: "Database Migration",
    keywords: ["migration", "schema", "database", "table", "column", "index", "sql"],
    body: "",
  };

  const allTemplates = [apiTemplate, uiTemplate, dbTemplate];

  it("matches API-related descriptions to API template", () => {
    const matches = matchTemplates(
      "Add a new REST API endpoint for user profiles",
      allTemplates,
    );
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].template.slug).toBe("api-endpoint");
  });

  it("matches frontend descriptions to UI template", () => {
    const matches = matchTemplates(
      "Build a new dashboard page component with React",
      allTemplates,
    );
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].template.slug).toBe("frontend-component");
  });

  it("matches database descriptions to migration template", () => {
    const matches = matchTemplates(
      "Add a new database migration to create the orders table with an index on user_id",
      allTemplates,
    );
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].template.slug).toBe("database-migration");
  });

  it("returns empty array when no keywords match", () => {
    const matches = matchTemplates(
      "Refactor the logging system to use structured output",
      allTemplates,
    );
    expect(matches).toEqual([]);
  });

  it("sorts matches by score descending", () => {
    // This description has both API and DB keywords
    const matches = matchTemplates(
      "Create an API endpoint with a new database table and migration",
      allTemplates,
    );
    expect(matches.length).toBeGreaterThanOrEqual(2);
    // Best match should have highest score
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1].score).toBeGreaterThanOrEqual(matches[i].score);
    }
  });

  it("is case insensitive", () => {
    const matches = matchTemplates(
      "BUILD A NEW REST API ENDPOINT",
      allTemplates,
    );
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].template.slug).toBe("api-endpoint");
  });

  it("uses word boundary matching for single keywords", () => {
    // "page" should not match "pages" in the wrong context — but it should
    // match "page" as a word boundary
    const matches = matchTemplates("Create a settings page", allTemplates);
    const uiMatch = matches.find((m) => m.template.slug === "frontend-component");
    expect(uiMatch).toBeDefined();
  });

  it("handles multi-word keywords with substring matching", () => {
    const template: DecompositionTemplate = {
      slug: "test",
      name: "Test",
      keywords: ["create table", "foreign key"],
      body: "",
    };
    const matches = matchTemplates(
      "We need to create table for orders with a foreign key to users",
      [template],
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].score).toBe(2);
  });

  it("returns correct score counts", () => {
    const matches = matchTemplates(
      "Add REST endpoint with a new route and controller",
      allTemplates,
    );
    const apiMatch = matches.find((m) => m.template.slug === "api-endpoint");
    expect(apiMatch).toBeDefined();
    // "endpoint", "route", "controller", "rest" = 4 hits
    expect(apiMatch!.score).toBe(4);
  });
});

// --- Pre-compiled keyword regexes ---

describe("parseTemplate — keywordPatterns", () => {
  it("populates keywordPatterns parallel to keywords", () => {
    const content = "# Test\n\n## Keywords\n\napi, endpoint, create table\n";
    const result = parseTemplate("test.md", content);
    expect(result.keywordPatterns).toBeDefined();
    expect(result.keywordPatterns!.length).toBe(result.keywords.length);
  });

  it("compiles RegExp for single-word keywords", () => {
    const content = "# Test\n\n## Keywords\n\napi, endpoint\n";
    const result = parseTemplate("test.md", content);
    expect(result.keywordPatterns![0]).toBeInstanceOf(RegExp);
    expect(result.keywordPatterns![1]).toBeInstanceOf(RegExp);
  });

  it("stores null for multi-word keywords", () => {
    const content = "# Test\n\n## Keywords\n\ncreate table, foreign key\n";
    const result = parseTemplate("test.md", content);
    expect(result.keywordPatterns![0]).toBeNull();
    expect(result.keywordPatterns![1]).toBeNull();
  });

  it("pre-compiled regexes produce same results as dynamic construction", () => {
    const content = "# Test\n\n## Keywords\n\napi, endpoint, route, sql\n";
    const template = parseTemplate("test.md", content);
    const description = "Add a new API endpoint with a route";

    // Match using pre-compiled patterns (normal path)
    const matchesPrecompiled = matchTemplates(description, [template]);

    // Match using templates without pre-compiled patterns (fallback path)
    const templateNoPat: DecompositionTemplate = {
      slug: template.slug,
      name: template.name,
      keywords: template.keywords,
      body: template.body,
      // keywordPatterns intentionally omitted
    };
    const matchesDynamic = matchTemplates(description, [templateNoPat]);

    expect(matchesPrecompiled.length).toBe(matchesDynamic.length);
    if (matchesPrecompiled.length > 0) {
      expect(matchesPrecompiled[0].score).toBe(matchesDynamic[0].score);
    }
  });

  it("pre-compiled regex respects word boundaries", () => {
    const content = "# Test\n\n## Keywords\n\napi\n";
    const template = parseTemplate("test.md", content);
    // "api" should match as a whole word
    expect(matchTemplates("use the api here", [template])).toHaveLength(1);
    // "api" should not match inside "capital"
    expect(matchTemplates("capital investment", [template])).toHaveLength(0);
  });

  it("returns empty keywordPatterns when no keywords", () => {
    const content = "# Test\n\nNo keywords section.\n";
    const result = parseTemplate("test.md", content);
    expect(result.keywordPatterns).toEqual([]);
  });
});

// --- Integration: loadTemplates from real templates/ dir ---

describe("loadTemplates — real templates directory", () => {
  it("loads the bundled templates from the project root", () => {
    // Resolve the real templates/ directory relative to this test file
    const projectRoot = join(import.meta.dirname, "..");
    const templatesDir = join(projectRoot, "templates");

    if (!existsSync(templatesDir)) {
      // Skip if templates/ doesn't exist (shouldn't happen in this PR)
      return;
    }

    const templates = loadTemplates(templatesDir);
    expect(templates.length).toBeGreaterThanOrEqual(3);

    const slugs = templates.map((t) => t.slug);
    expect(slugs).toContain("api-endpoint");
    expect(slugs).toContain("frontend-component");
    expect(slugs).toContain("database-migration");

    // Each template should have keywords
    for (const t of templates) {
      expect(t.keywords.length).toBeGreaterThan(0);
      expect(t.name.length).toBeGreaterThan(0);
    }
  });

  it("real templates match realistic descriptions", () => {
    const projectRoot = join(import.meta.dirname, "..");
    const templatesDir = join(projectRoot, "templates");
    const templates = loadTemplates(templatesDir);

    // API description should match api-endpoint
    const apiMatches = matchTemplates(
      "Add a new API endpoint for fetching user settings",
      templates,
    );
    expect(apiMatches.length).toBeGreaterThan(0);
    expect(apiMatches[0].template.slug).toBe("api-endpoint");

    // Frontend description should match frontend-component
    const uiMatches = matchTemplates(
      "Build a new React component for the settings page with a form",
      templates,
    );
    expect(uiMatches.length).toBeGreaterThan(0);
    expect(uiMatches[0].template.slug).toBe("frontend-component");

    // DB description should match database-migration
    const dbMatches = matchTemplates(
      "Create a new database migration to add an index on the orders table",
      templates,
    );
    expect(dbMatches.length).toBeGreaterThan(0);
    expect(dbMatches[0].template.slug).toBe("database-migration");
  });
});
