# Review friction inbox (friction-review)

**Schedule:** every weekday at 09:00
**Priority:** Medium
**Domain:** friction
**Timeout:** 10m
**Enabled:** true

Run `nw review-inbox friction` from the project root.

- Use the first-party review-inbox command instead of manually branching,
  editing inbox files, or creating PRs yourself.
- If the command reports there is nothing to review, stop.
- If the command opens or updates a review PR, stop after confirming the
  command succeeded.
- If the command fails, capture the error and likely cause.
