// Tests for getBundleDir error case (requires vi.mock to override fs).

import { describe, it, expect, vi } from "vitest";

vi.mock("fs", () => ({
  existsSync: () => false,
}));

describe("getBundleDir error case", () => {
  it("throws when no valid bundle directory is found", async () => {
    const { getBundleDir } = await import("../core/paths.ts");

    expect(() => getBundleDir()).toThrow(
      "Could not find ninthwave bundle directory",
    );
  });
});
