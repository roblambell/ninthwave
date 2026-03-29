// ci-failures command: show failing CI check details for a PR.

import { die } from "../output.ts";
import { prChecks as defaultPrChecks } from "../gh.ts";

/** Injectable dependencies for CI commands, for testing. */
export interface CiDeps {
  prChecks: typeof defaultPrChecks;
}

const defaultCiDeps: CiDeps = {
  prChecks: defaultPrChecks,
};

export function cmdCiFailures(
  args: string[],
  projectRoot: string,
  deps: CiDeps = defaultCiDeps,
): void {
  const prNumber = args[0] ?? "";
  if (!prNumber) die("Usage: ninthwave ci-failures <PR_NUMBER>");

  const checksResult = deps.prChecks(projectRoot, parseInt(prNumber, 10));
  if (!checksResult.ok) {
    die(`Failed to get CI checks: ${checksResult.error}`);
  }
  const failures = checksResult.data.filter((c) => c.state === "FAILURE");

  if (failures.length === 0) {
    console.log("No failing checks found");
    return;
  }

  for (const check of failures) {
    console.log(`${check.name}\t${check.url}`);
  }
}
