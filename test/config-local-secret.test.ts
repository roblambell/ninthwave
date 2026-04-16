// Tests for the local-only storage of `broker_secret`.
//
// `broker_secret` is always generated into the gitignored
// `.ninthwave/config.local.json` so a random secret never lands in version
// control. Teammates who want to share a broker namespace pass the value
// out of band and paste it into their own `config.local.json`. The loader
// still accepts a `broker_secret` supplied in either file (local wins), so
// migrations and hand-edited configs resolve correctly. This file
// documents and enforces that default and the override precedence.

import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  loadConfig,
  loadLocalConfig,
  loadMergedProjectConfig,
  loadOrGenerateProjectIdentity,
} from "../core/config.ts";
import { setupTempRepo, cleanupTempRepos } from "./helpers.ts";

afterEach(() => {
  cleanupTempRepos();
});

const ZERO_SECRET_A = "A".repeat(43) + "=";
// Base64 for 32 bytes of 0xFF: `/`.repeat(42) + `/w==` doesn't fit our
// format, so we use another canonical round-trip value: 32 bytes of 0x10
// encodes to "EBAQ..." -- computing a canonical 44-char value here keeps
// the test independent of any generator.
// 32 bytes of 0xFF → base64 "/////////////////////////////////////////w==" (44 chars with "==" pad)
// That has "==" padding, which doesn't match our {43}=$ regex, so we
// instead use 32 bytes of 0x08, which yields 43 non-pad chars + single "=".
// Easier: pick a value produced by Node's Buffer on a fixed 32-byte input.
const THIRTY_TWO_EIGHTS_SECRET = Buffer.from(new Uint8Array(32).fill(0x08)).toString("base64");

describe("broker_secret override via config.local.json", () => {
  it("the secret in config.local.json wins over the committed value", () => {
    const repo = setupTempRepo();
    const configDir = join(repo, ".ninthwave");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({
        project_id: "00000000-0000-4000-8000-000000000001",
        broker_secret: ZERO_SECRET_A,
      }),
    );
    writeFileSync(
      join(configDir, "config.local.json"),
      JSON.stringify({
        broker_secret: THIRTY_TWO_EIGHTS_SECRET,
      }),
    );

    // The committed file is untouched by the overlay.
    const shared = loadConfig(repo);
    expect(shared.broker_secret).toBe(ZERO_SECRET_A);

    // The local overlay is parsed independently.
    const local = loadLocalConfig(repo);
    expect(local.broker_secret).toBe(THIRTY_TWO_EIGHTS_SECRET);
    // `project_id` was not overridden locally, so it must not appear in the
    // local overlay's parsed result.
    expect(local.project_id).toBeUndefined();

    // The merged view prefers the local overlay for broker_secret and keeps
    // the committed project_id.
    const merged = loadMergedProjectConfig(repo);
    expect(merged.broker_secret).toBe(THIRTY_TWO_EIGHTS_SECRET);
    expect(merged.project_id).toBe("00000000-0000-4000-8000-000000000001");
  });

  it("a malformed broker_secret in config.local.json is ignored and the config.json value is used", () => {
    const repo = setupTempRepo();
    const configDir = join(repo, ".ninthwave");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({
        broker_secret: ZERO_SECRET_A,
      }),
    );
    writeFileSync(
      join(configDir, "config.local.json"),
      JSON.stringify({
        broker_secret: "too-short",
      }),
    );

    const merged = loadMergedProjectConfig(repo);
    expect(merged.broker_secret).toBe(ZERO_SECRET_A);
  });

  it("a broker_secret in config.local.json with no counterpart in config.json still takes effect", () => {
    const repo = setupTempRepo();
    const configDir = join(repo, ".ninthwave");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.local.json"),
      JSON.stringify({
        broker_secret: THIRTY_TWO_EIGHTS_SECRET,
      }),
    );

    const merged = loadMergedProjectConfig(repo);
    expect(merged.broker_secret).toBe(THIRTY_TWO_EIGHTS_SECRET);
  });

  it("explicit identity generation writes broker_secret into config.local.json and leaves config.json secret-free", () => {
    const repo = setupTempRepo();
    const configDir = join(repo, ".ninthwave");
    mkdirSync(configDir, { recursive: true });
    // Committed config carries only the public project_id.
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({ project_id: "00000000-0000-4000-8000-000000000002" }),
    );

    const identity = loadOrGenerateProjectIdentity(repo);

    // broker_secret must NOT have landed in the committed file.
    const sharedRaw = JSON.parse(
      readFileSync(join(configDir, "config.json"), "utf-8"),
    );
    expect(sharedRaw).not.toHaveProperty("broker_secret");

    // It must have landed in the gitignored overlay.
    const localPath = join(configDir, "config.local.json");
    expect(existsSync(localPath)).toBe(true);
    const localRaw = JSON.parse(readFileSync(localPath, "utf-8"));
    expect(localRaw.broker_secret).toBe(identity.broker_secret);
    expect(identity.project_id).toBe("00000000-0000-4000-8000-000000000002");
  });

  it("does not rewrite either file when both identity fields are already present", () => {
    const repo = setupTempRepo();
    const configDir = join(repo, ".ninthwave");
    mkdirSync(configDir, { recursive: true });
    const sharedPath = join(configDir, "config.json");
    const localPath = join(configDir, "config.local.json");
    writeFileSync(
      sharedPath,
      JSON.stringify({ project_id: "00000000-0000-4000-8000-000000000003" }),
    );
    writeFileSync(
      localPath,
      JSON.stringify({ broker_secret: THIRTY_TWO_EIGHTS_SECRET }),
    );

    const sharedBefore = readFileSync(sharedPath, "utf-8");
    const localBefore = readFileSync(localPath, "utf-8");
    loadOrGenerateProjectIdentity(repo);
    expect(readFileSync(sharedPath, "utf-8")).toBe(sharedBefore);
    expect(readFileSync(localPath, "utf-8")).toBe(localBefore);
  });

  it("tolerates JSONC comments in .ninthwave/config.json", () => {
    const repo = setupTempRepo();
    const configDir = join(repo, ".ninthwave");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      `// header comment explaining the file\n{\n  "project_id": "00000000-0000-4000-8000-000000000004"\n}\n`,
    );

    const shared = loadConfig(repo);
    expect(shared.project_id).toBe("00000000-0000-4000-8000-000000000004");
  });
});
