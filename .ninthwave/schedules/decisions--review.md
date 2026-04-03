# Review decisions inbox (decisions-review)

**Schedule:** every weekday at 13:00
**Priority:** Medium
**Domain:** decisions
**Timeout:** 10m
**Enabled:** true

Run `nw review-inbox decisions` from the project root.

- Use the first-party review-inbox command instead of manually branching,
  editing inbox files, or creating PRs yourself.
- If the command reports there is nothing to review, stop.
- If the command opens or updates a review PR, stop after confirming the
  command succeeded.
- If the command fails, capture the error and likely cause.
