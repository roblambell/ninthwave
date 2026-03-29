#!/usr/bin/env bun
// version-bump: semantic version bump + changelog generation.
// Usage: bun run scripts/version-bump.ts

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { die, info, BOLD, YELLOW, GREEN, RESET } from "../core/output.ts";
import {
  getCurrentBranch,
  logOneline,
} from "../core/git.ts";
import { run } from "../core/shell.ts";

export function cmdVersionBump(projectRoot: string): void {
  const versionFile = join(projectRoot, "VERSION");
  const changelogFile = join(projectRoot, "CHANGELOG.md");

  // Guard: must be on main branch
  let currentBranch = "";
  try {
    currentBranch = getCurrentBranch(projectRoot);
  } catch {
    currentBranch = "";
  }
  if (currentBranch !== "main") {
    die(
      `version-bump must be run on the main branch (currently on: ${currentBranch || "unknown"})`,
    );
  }

  if (!existsSync(versionFile)) die(`VERSION file not found at ${versionFile}`);
  if (!existsSync(changelogFile))
    die(`CHANGELOG.md not found at ${changelogFile}`);

  const currentVersion = readFileSync(versionFile, "utf-8").trim();
  info(`Current version: ${currentVersion}`);

  // Find the last commit that modified VERSION
  const lastVersionResult = run("git", [
    "-C",
    projectRoot,
    "log",
    "-1",
    "--format=%H",
    "--",
    "VERSION",
  ]);
  if (lastVersionResult.exitCode !== 0 || !lastVersionResult.stdout) {
    die("Could not find any commit that modified VERSION");
  }
  const lastVersionCommit = lastVersionResult.stdout.trim();

  // Show last VERSION change
  const lastLogResult = run("git", [
    "-C",
    projectRoot,
    "log",
    "-1",
    "--oneline",
    lastVersionCommit,
  ]);
  info(`Last VERSION change: ${lastLogResult.stdout}`);

  // Get commits since last version change
  const commitRange = `${lastVersionCommit}..HEAD`;
  let commits: string;
  try {
    commits = logOneline(projectRoot, commitRange);
  } catch {
    commits = "";
  }

  if (!commits) {
    console.log("No commits since last version bump.");
    return;
  }

  console.log();
  console.log(`${BOLD}Commits since ${currentVersion}:${RESET}`);
  console.log(commits);
  console.log();

  // Categorize by conventional commit prefix
  let added = "";
  let changed = "";
  let fixed = "";

  for (const line of commits.split("\n")) {
    if (!line) continue;
    const msg = line.slice(line.indexOf(" ") + 1);
    if (msg.startsWith("feat:") || msg.startsWith("feat(")) {
      const content = msg.slice(msg.indexOf(":") + 1).trim();
      added += `\n- ${content}`;
    } else if (msg.startsWith("fix:") || msg.startsWith("fix(")) {
      const content = msg.slice(msg.indexOf(":") + 1).trim();
      fixed += `\n- ${content}`;
    } else if (msg.startsWith("refactor:") || msg.startsWith("refactor(")) {
      const content = msg.slice(msg.indexOf(":") + 1).trim();
      changed += `\n- ${content}`;
    }
  }

  // Parse version parts: MAJOR.MINOR.PATCH
  const parts = currentVersion.split(".");
  let vMajor = parseInt(parts[0] ?? "0", 10);
  let vMinor = parseInt(parts[1] ?? "0", 10);
  let vPatch = parseInt(parts[2] ?? "0", 10);

  console.log();
  console.log(
    `${YELLOW}Choose bump level:${RESET}`,
  );
  console.log(`  1) PATCH (${vMajor}.${vMinor}.${vPatch + 1})`);
  console.log(`  2) MINOR (${vMajor}.${vMinor + 1}.0)`);
  console.log(`  3) MAJOR (${vMajor + 1}.0.0)`);

  let newVersion = "";
  const choice = prompt("Choice [1/2/3]: ");
  switch (choice) {
    case "1":
      newVersion = `${vMajor}.${vMinor}.${vPatch + 1}`;
      break;
    case "2":
      newVersion = `${vMajor}.${vMinor + 1}.0`;
      break;
    case "3":
      newVersion = `${vMajor + 1}.0.0`;
      break;
    default:
      die("Invalid choice");
  }
  info(`Bumping to: ${newVersion}`);

  // Generate CHANGELOG entry
  const date = new Date().toISOString().slice(0, 10);
  let changelogEntry = `## [${newVersion}] - ${date}`;

  if (added) {
    changelogEntry += `\n\n### Added${added}`;
  }
  if (changed) {
    changelogEntry += `\n\n### Changed${changed}`;
  }
  if (fixed) {
    changelogEntry += `\n\n### Fixed${fixed}`;
  }

  console.log();
  console.log(`${BOLD}Changelog entry:${RESET}`);
  console.log(changelogEntry);
  console.log();

  // Write VERSION
  writeFileSync(versionFile, newVersion + "\n");
  info(`Updated VERSION to ${newVersion}`);

  // Prepend to CHANGELOG.md (after the first # header line)
  const changelogContent = readFileSync(changelogFile, "utf-8");
  const changelogLines = changelogContent.split("\n");
  const outputLines: string[] = [];
  let headerDone = false;

  for (const line of changelogLines) {
    outputLines.push(line);
    if (line.startsWith("# ") && !headerDone) {
      outputLines.push("");
      outputLines.push(changelogEntry);
      headerDone = true;
    }
  }

  writeFileSync(changelogFile, outputLines.join("\n"));
  info("Updated CHANGELOG.md");

  // Commit
  run("git", ["-C", projectRoot, "add", versionFile, changelogFile]);
  run("git", [
    "-C",
    projectRoot,
    "commit",
    "-m",
    `chore: bump version and changelog (v${newVersion})`,
  ]);

  console.log();
  console.log(
    `${GREEN}Version bumped to ${newVersion} and committed.${RESET}`,
  );
}

// Run directly when executed as a script
if (import.meta.main) {
  const projectRoot = resolve(import.meta.dir, "..");
  cmdVersionBump(projectRoot);
}
