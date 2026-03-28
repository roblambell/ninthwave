# TUI dependency indicator misaligned

**Observed:** 2026-03-28
**Severity:** Low
**Context:** `nw watch` TUI status display

## What happened

The dependency tree indicators (`└ H-UT-3`) start at column 0 instead of aligning under the `⧗` icon column of the parent item. This makes the visual hierarchy harder to scan.

Current:
```
· H-UT-4      Queued            -        ⧗ Item detail panel with Enter/i and Escape
  └ H-UT-3
```

Expected:
```
· H-UT-4      Queued            -        ⧗ Item detail panel with Enter/i and Escape
                                           └ H-UT-3
```
