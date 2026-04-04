import { describe, it, expect, afterEach } from "vitest";
import { setupTempRepo, useFixtureDir, writeWorkItemFiles, cleanupTempRepos, captureOutput } from "./helpers.ts";
import { join } from "path";
import { cmdConflicts } from "../core/commands/conflicts.ts";

describe("conflicts", () => {
  afterEach(() => cleanupTempRepos());

  it("detects file overlap between items", () => {
    const repo = setupTempRepo();
    const worktreeDir = join(repo, ".ninthwave", ".worktrees");

    const workDir = writeWorkItemFiles(repo, `## Shared

### Feat: Item A (H-SH-1)

**Priority:** High
**Depends on:** None

Key files: \`lib/shared.ex\`, \`lib/unique_a.ex\`

---

### Feat: Item B (H-SH-2)

**Priority:** High
**Depends on:** None

Key files: \`lib/shared.ex\`, \`lib/unique_b.ex\`

---
`);

    const output = captureOutput(() =>
      cmdConflicts(["H-SH-1", "H-SH-2"], workDir, worktreeDir),
    );

    expect(output).toContain("CONFLICT");
    expect(output).toContain("lib/shared.ex");
  });

  it("detects domain overlap between items", () => {
    const repo = setupTempRepo();
    const workDir = useFixtureDir(repo, "valid.md");
    const worktreeDir = join(repo, ".ninthwave", ".worktrees");

    // M-CI-1 and H-CI-2 are both in cloud-infrastructure domain
    const output = captureOutput(() =>
      cmdConflicts(["M-CI-1", "H-CI-2"], workDir, worktreeDir),
    );

    expect(output).toContain("POTENTIAL");
    expect(output).toContain("cloud-infrastructure");
  });

  it("reports CLEAR when no conflicts found", () => {
    const repo = setupTempRepo();
    const workDir = useFixtureDir(repo, "valid.md");
    const worktreeDir = join(repo, ".ninthwave", ".worktrees");

    // M-CI-1 (cloud-infrastructure) and C-UO-1 (user-onboarding) - different domains, no file overlap
    const output = captureOutput(() =>
      cmdConflicts(["M-CI-1", "C-UO-1"], workDir, worktreeDir),
    );

    expect(output).toContain("CLEAR");
  });

  it("errors with fewer than 2 IDs", () => {
    const repo = setupTempRepo();
    const workDir = useFixtureDir(repo, "valid.md");
    const worktreeDir = join(repo, ".ninthwave", ".worktrees");

    const output = captureOutput(() =>
      cmdConflicts(["M-CI-1"], workDir, worktreeDir),
    );

    expect(output).toContain("Usage");
  });

  it("does not flag false positives from description-mentioned paths", () => {
    const repo = setupTempRepo();
    const worktreeDir = join(repo, ".ninthwave", ".worktrees");

    // Two items that mention the same file in description but NOT in Key files
    const workDir = writeWorkItemFiles(repo, `## Features

### Feat: Item A (H-FE-1)

**Priority:** High
**Depends on:** None

This invokes \`lib/shared.ex\` internally.

Key files: \`lib/unique_a.ex\`

---

### Feat: Item B (H-FE-2)

**Priority:** High
**Depends on:** None

Also references \`lib/shared.ex\` in description.

Key files: \`lib/unique_b.ex\`

---
`);

    const output = captureOutput(() =>
      cmdConflicts(["H-FE-1", "H-FE-2"], workDir, worktreeDir),
    );

    // Should NOT flag a CONFLICT for lib/shared.ex since it's only in descriptions
    expect(output).not.toContain("CONFLICT");
    expect(output).not.toContain("lib/shared.ex");
  });
});
