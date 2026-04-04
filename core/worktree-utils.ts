import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import { join, dirname } from "path";

/**
 * Ensure .ninthwave/.worktrees/ is excluded in a repo via .git/info/exclude.
 */
export function ensureWorktreeExcluded(repoRoot: string): void {
  const excludeFile = join(repoRoot, ".git", "info", "exclude");
  const excludePattern = ".ninthwave/.worktrees/";
  if (existsSync(excludeFile)) {
    const content = readFileSync(excludeFile, "utf-8");
    if (!content.includes(excludePattern)) {
      appendFileSync(excludeFile, `\n${excludePattern}\n`);
    }
  } else {
    mkdirSync(dirname(excludeFile), { recursive: true });
    writeFileSync(excludeFile, `${excludePattern}\n`);
  }
}
