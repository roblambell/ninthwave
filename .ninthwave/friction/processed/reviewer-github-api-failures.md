# Reviewer fails to post inline PR comments (422 errors)

**Observed:** 2026-03-28
**Severity:** High
**Context:** ninthwave-reviewer agent posting review comments

## What happened

The reviewer agent tries to post inline comments via `gh api repos/.../pulls/.../comments` but hits 422 errors because it doesn't use the correct GitHub API format (missing `positioning` or `position` fields, wrong types for `line`).

The reviewer should be using GitHub's Pull Request Review API (`POST /repos/.../pulls/.../reviews`) which supports inline comments as part of a review, rather than individual comment posts.

## Root cause

The reviewer agent prompt doesn't teach it how to use GitHub's review API correctly. It tries to post standalone PR comments with line references, which requires different parameters than what it's sending.

## Recommended fix

1. Teach reviewers to use `gh api repos/{owner}/{repo}/pulls/{pr}/reviews` with the `comments` array for inline findings
2. Post the verdict as the review body (APPROVE / REQUEST_CHANGES)
3. The verdict summary should NOT repeat all findings — those are already inline
4. Make it explicit that inline comments are the primary feedback mechanism and the verdict is a summary
