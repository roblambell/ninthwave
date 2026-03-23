# TODOS

## Broken Items

### Feat: Item with no ID in header

**Priority:** High
**Source:** Test
**Depends on:** None

This item has no ID in its header, so it should be skipped by the parser.

Acceptance: Should not appear in output.

---

### Fix: Item with missing priority (H-BK-2)

**Source:** Test
**Depends on:** None

This item has no Priority line.

Acceptance: Should still parse but with empty priority.

---

### Refactor: Valid item after malformed ones (M-BK-3)

**Priority:** Medium
**Source:** Test
**Depends on:** None

This is a well-formed item after some malformed ones.

Acceptance: Should parse correctly.

Key files: `lib/something.ex`

---
