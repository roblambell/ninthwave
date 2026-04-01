import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { lookupCommand } from "../core/help.ts";
import {
  cmdLineageToken,
  generateLineageToken,
} from "../core/commands/lineage-token.ts";
import { LINEAGE_TOKEN_PATTERN } from "../core/types.ts";

describe("generateLineageToken", () => {
  it("returns an opaque UUIDv4 token", () => {
    const token = generateLineageToken({
      randomUUID: () => "123e4567-e89b-42d3-a456-426614174000",
      randomBytes: () => Buffer.alloc(16, 0),
    });

    expect(token).toBe("123e4567-e89b-42d3-a456-426614174000");
    expect(LINEAGE_TOKEN_PATTERN.test(token)).toBe(true);
  });

  it("falls back to crypto randomBytes when randomUUID throws", () => {
    const token = generateLineageToken({
      randomUUID: () => {
        throw new Error("unavailable");
      },
      randomBytes: () => Buffer.from("00112233445566778899aabbccddeeff", "hex"),
    });

    expect(token).toBe("00112233-4455-4677-8899-aabbccddeeff");
    expect(LINEAGE_TOKEN_PATTERN.test(token)).toBe(true);
  });
});

describe("cmdLineageToken", () => {
  it("prints a generated lineage token", () => {
    const stdout: string[] = [];
    const original = console.log;
    console.log = (msg?: unknown) => {
      stdout.push(String(msg ?? ""));
    };

    try {
      const token = cmdLineageToken([], {
        randomUUID: () => "123e4567-e89b-42d3-a456-426614174000",
        randomBytes: () => Buffer.alloc(16, 0),
      });
      expect(token).toBe("123e4567-e89b-42d3-a456-426614174000");
      expect(stdout).toEqual(["123e4567-e89b-42d3-a456-426614174000"]);
    } finally {
      console.log = original;
    }
  });

  it("is registered in the CLI help registry", () => {
    const entry = lookupCommand("lineage-token");
    expect(entry).toBeDefined();
    expect(entry!.usage).toBe("lineage-token");
  });

  it("documents lineage-token usage in canonical work-item writers", () => {
    const projectRoot = join(import.meta.dir, "..");
    const decompose = readFileSync(join(projectRoot, "skills/decompose/SKILL.md"), "utf-8");
    const implementer = readFileSync(join(projectRoot, "agents/implementer.md"), "utf-8");

    expect(decompose).toContain("nw lineage-token");
    expect(implementer).toContain("## Work Item Reference");
    expect(implementer).toContain("Lineage:");
  });
});
