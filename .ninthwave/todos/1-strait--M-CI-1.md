---
id: M-CI-1
priority: medium
domain: strait
title: Add CI Gate branch protection rule for strait PRs
repo: strait
depends:
  - H-FMT-1
---

# Add CI Gate branch protection rule for strait PRs

## Context
The ninthwave repo has a "CI Gate" required status check on PRs. The strait repo should have the same protection so PRs can't be merged when CI is failing.

## Requirements
1. Create a branch protection rule for the `main` branch on `ninthwave-sh/strait`
2. Require the "CI" workflow's `test` job as a required status check (this is the equivalent of ninthwave's "CI Gate")
3. Require PR reviews before merging (optional — match ninthwave's settings)
4. Do NOT require linear history or signed commits unless ninthwave uses them

## Implementation
Use the GitHub CLI to configure branch protection:
```bash
gh api repos/ninthwave-sh/strait/branches/main/protection \
  --method PUT \
  --field required_status_checks='{"strict":false,"contexts":["test"]}' \
  --field enforce_admins=false \
  --field required_pull_request_reviews=null \
  --field restrictions=null
```

Or use the GitHub web UI: Settings → Branches → Add rule → Branch name pattern: `main` → Require status checks: `test`.

## Notes
- The CI workflow job is named `test` (not `CI Gate` like ninthwave) — use that as the required check name
- Build job is optional — it depends on test so requiring test is sufficient
- Consider also adding a CLAUDE.md to the strait repo with build instructions

## Estimated Complexity
Small — GitHub API call or web UI configuration.
