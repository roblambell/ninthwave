# Friction: Rebasing state displayed as "CI Pending" in TUI and cmux

**Observed:** 2026-03-27
**Project:** strait (ninthwave-sh/strait)
**Severity:** Medium
**Component:** orchestrator TUI + cmux workspace status

## What happened

H-CP-20 was being rebased by the orchestrator after a CI failure. The TUI showed the item state as "CI Pending" and the cmux workspace sidebar also showed "CI Pending / CI running". Neither indicated that a rebase was in progress.

The user expected to see a "Rebasing" state — instead, two different views both showed "CI Pending" which is misleading when the actual operation is a rebase (no CI is running during a rebase).

## Expected behavior

When the orchestrator is rebasing an item:
- The TUI should show a distinct "Rebasing" state (not "CI Pending")
- The cmux workspace sidebar should reflect the same

The state machine should distinguish `ci-pending` (waiting for CI to complete) from `rebasing` (orchestrator is rebasing the branch before CI can run).

## Screenshot reference

TUI showed: `◌ H-CP-20  CI Pending`
cmux showed: `Running` / `CI Pending` with subtitle `CI running`
