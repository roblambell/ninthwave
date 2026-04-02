import { describe, expect, it } from "vitest";
import { resolveCliRespawnCommand } from "../core/cli-spawn.ts";

describe("resolveCliRespawnCommand", () => {
  it("keeps the script entrypoint in dev mode", () => {
    expect(resolveCliRespawnCommand(
      ["orchestrate", "--_daemon-child"],
      {
        argv: ["/usr/local/bin/bun", "/repo/core/cli.ts", "watch"],
        execPath: "/usr/local/bin/bun",
      },
    )).toEqual({
      command: "/usr/local/bin/bun",
      args: ["/repo/core/cli.ts", "orchestrate", "--_daemon-child"],
    });
  });

  it("invokes the executable directly in packaged mode", () => {
    expect(resolveCliRespawnCommand(
      ["orchestrate", "--_daemon-child"],
      {
        argv: ["/opt/homebrew/bin/ninthwave", "watch"],
        execPath: "/opt/homebrew/bin/ninthwave",
      },
    )).toEqual({
      command: "/opt/homebrew/bin/ninthwave",
      args: ["orchestrate", "--_daemon-child"],
    });
  });

  it("does not forward a non-script argv[1] in packaged mode", () => {
    expect(resolveCliRespawnCommand(
      ["--_interactive-engine-child", "--items", "H-PBR-1"],
      {
        argv: ["/opt/homebrew/bin/ninthwave", "watch"],
        execPath: "/opt/homebrew/bin/ninthwave",
      },
    )).toEqual({
      command: "/opt/homebrew/bin/ninthwave",
      args: ["--_interactive-engine-child", "--items", "H-PBR-1"],
    });
  });
});
