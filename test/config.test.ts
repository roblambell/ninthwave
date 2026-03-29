// Tests for project config loading (JSON format).

import { describe, it, expect, afterEach } from "vitest";
import { join } from "path";
import { mkdirSync, writeFileSync } from "fs";
import { loadConfig } from "../core/config.ts";
import { setupTempRepo, cleanupTempRepos } from "./helpers.ts";

afterEach(() => {
  cleanupTempRepos();
});

describe("loadConfig", () => {
  it("returns defaults when config file is missing", () => {
    const repo = setupTempRepo();
    const config = loadConfig(repo);
    expect(config.review_external).toBe(false);
    expect(config.schedule_enabled).toBe(false);
  });

  it("parses valid JSON with both keys", () => {
    const repo = setupTempRepo();
    const configDir = join(repo, ".ninthwave");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({ review_external: true, schedule_enabled: true }),
    );

    const config = loadConfig(repo);
    expect(config.review_external).toBe(true);
    expect(config.schedule_enabled).toBe(true);
  });

  it("defaults schedule_enabled when only review_external is set", () => {
    const repo = setupTempRepo();
    const configDir = join(repo, ".ninthwave");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({ review_external: true }),
    );

    const config = loadConfig(repo);
    expect(config.review_external).toBe(true);
    expect(config.schedule_enabled).toBe(false);
  });

  it("returns defaults for malformed JSON", () => {
    const repo = setupTempRepo();
    const configDir = join(repo, ".ninthwave");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.json"), "not valid json {{{");

    const config = loadConfig(repo);
    expect(config.review_external).toBe(false);
    expect(config.schedule_enabled).toBe(false);
  });

  it("returns defaults when JSON is an array", () => {
    const repo = setupTempRepo();
    const configDir = join(repo, ".ninthwave");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.json"), "[1, 2, 3]");

    const config = loadConfig(repo);
    expect(config.review_external).toBe(false);
    expect(config.schedule_enabled).toBe(false);
  });

  it("returns defaults when JSON is null", () => {
    const repo = setupTempRepo();
    const configDir = join(repo, ".ninthwave");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.json"), "null");

    const config = loadConfig(repo);
    expect(config.review_external).toBe(false);
    expect(config.schedule_enabled).toBe(false);
  });

  it("ignores unknown keys", () => {
    const repo = setupTempRepo();
    const configDir = join(repo, ".ninthwave");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({
        review_external: true,
        schedule_enabled: false,
        unknown_key: "ignored",
        another_unknown: 42,
      }),
    );

    const config = loadConfig(repo);
    expect(config.review_external).toBe(true);
    expect(config.schedule_enabled).toBe(false);
    // Only known keys in the result
    expect(Object.keys(config)).toEqual(["review_external", "schedule_enabled"]);
  });

  it("treats non-boolean review_external as false", () => {
    const repo = setupTempRepo();
    const configDir = join(repo, ".ninthwave");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({ review_external: "true" }),
    );

    const config = loadConfig(repo);
    // String "true" is not boolean true
    expect(config.review_external).toBe(false);
  });

  it("treats non-boolean schedule_enabled as false", () => {
    const repo = setupTempRepo();
    const configDir = join(repo, ".ninthwave");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({ schedule_enabled: 1 }),
    );

    const config = loadConfig(repo);
    expect(config.schedule_enabled).toBe(false);
  });
});
