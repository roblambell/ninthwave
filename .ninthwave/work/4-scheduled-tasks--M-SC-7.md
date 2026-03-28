# Docs: Schedule format documentation and security trust model (M-SC-7)

**Priority:** Medium
**Source:** Scheduled tasks feature plan (CEO + Eng reviewed 2026-03-28)
**Depends on:** H-SC-1
**Domain:** scheduled-tasks

Write the schedule file format guide and document the security trust model.

1. Create `core/docs/schedule-format.md`:
   - Complete format reference (mirroring the style of `core/docs/work-item-format.md`)
   - File naming convention: `{domain}--{id}.md`
   - All metadata fields with types, defaults, and examples
   - Supported schedule expressions (all 5 natural language patterns + raw cron)
   - Example files for common use cases: daily audit, weekly dep check, hourly monitoring
   - ASCII-only constraint note (same as work items)

2. Security trust model section:
   - "Schedule files execute with the daemon's full permissions"
   - "Review schedule files like you review CI workflows -- they run automatically and recurrently"
   - "Files are checked into git and go through normal PR review"
   - "Disable a schedule by setting `**Enabled:** false` rather than deleting the file"

**Test plan:**
- Manual review: verify all documented fields match the parser implementation, verify all schedule expression examples are valid, verify the security section is present

Acceptance: A new user can read `schedule-format.md` and write a valid schedule file without looking at the source code. The security trust model is clearly documented.

Key files: `core/docs/schedule-format.md`, `core/docs/work-item-format.md` (reference for style)
