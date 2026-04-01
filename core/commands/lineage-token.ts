// lineage-token command: generate a durable work-item lineage token.

import { randomBytes, randomUUID } from "crypto";
import { die } from "../output.ts";
import { LINEAGE_TOKEN_PATTERN } from "../types.ts";

export interface LineageTokenDeps {
  randomUUID: () => string;
  randomBytes: (size: number) => Buffer;
}

const defaultDeps: LineageTokenDeps = {
  randomUUID,
  randomBytes,
};

function formatUuidV4FromBytes(bytes: Buffer): string {
  if (bytes.length !== 16) {
    throw new Error(`Expected 16 random bytes, got ${bytes.length}`);
  }

  const copy = Buffer.from(bytes);
  copy[6] = (copy[6]! & 0x0f) | 0x40;
  copy[8] = (copy[8]! & 0x3f) | 0x80;

  const hex = copy.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

export function generateLineageToken(
  deps: LineageTokenDeps = defaultDeps,
): string {
  try {
    const token = deps.randomUUID().toLowerCase();
    if (LINEAGE_TOKEN_PATTERN.test(token)) {
      return token;
    }
  } catch {
    // Fall back to explicit CSPRNG bytes below.
  }

  const token = formatUuidV4FromBytes(deps.randomBytes(16)).toLowerCase();
  if (!LINEAGE_TOKEN_PATTERN.test(token)) {
    throw new Error("Failed to generate a valid lineage token");
  }
  return token;
}

export function cmdLineageToken(
  args: string[],
  deps: LineageTokenDeps = defaultDeps,
): string {
  if (args.length > 0) {
    die("Usage: nw lineage-token");
    return "";
  }

  const token = generateLineageToken(deps);
  console.log(token);
  return token;
}
