#!/usr/bin/env bash
# Tests for cmd_batch_order (topological sort with circular dependency detection).

set -euo pipefail
source "$(dirname "$0")/helpers.sh"

echo "=== batch-order ==="

# --- No dependencies: all items in batch 1 ---

repo="$(setup_temp_repo)"
use_fixture "$repo" "valid.md"
output="$(run_nw "$repo" batch-order M-CI-1 C-UO-1)"

describe "items with no mutual deps are in batch 1"
assert_contains "$output" "Batch 1" "batch 1 exists"
assert_not_contains "$output" "Batch 2" "no batch 2"
assert_contains "$output" "M-CI-1" "M-CI-1 in output"
assert_contains "$output" "C-UO-1" "C-UO-1 in output"

# --- Linear dependency chain ---

describe "linear dependency: dep in batch 1, dependent in batch 2"
output2="$(run_nw "$repo" batch-order M-CI-1 H-CI-2)"
assert_contains "$output2" "Batch 1" "batch 1 exists"
assert_contains "$output2" "Batch 2" "batch 2 exists"
# M-CI-1 has no deps on selected items -> batch 1
# H-CI-2 depends on M-CI-1 -> batch 2
# Extract lines between Batch 1 and Batch 2 (macOS-compatible, no head -n -1)
batch1="$(echo "$output2" | sed -n '/Batch 1/,/Batch 2/{/Batch 2/d;p;}')"
batch2="$(echo "$output2" | sed -n '/Batch 2/,$p')"
assert_contains "$batch1" "M-CI-1" "M-CI-1 in batch 1"
assert_contains "$batch2" "H-CI-2" "H-CI-2 in batch 2"

# --- Multi-level dependency chain ---

describe "multi-level deps: independent items in batch 1, dependents in batch 2"
# H-UO-2 depends on C-UO-1 and M-CI-1
output3="$(run_nw "$repo" batch-order M-CI-1 C-UO-1 H-CI-2 H-UO-2)"
assert_contains "$output3" "Batch 1" "batch 1 exists"
assert_contains "$output3" "Batch 2" "batch 2 exists"
# M-CI-1 and C-UO-1 have no internal deps -> batch 1
# H-CI-2 depends on M-CI-1 -> batch 2
# H-UO-2 depends on C-UO-1 and M-CI-1 -> batch 2 (both deps satisfied after batch 1)
batch1_3="$(echo "$output3" | sed -n '/Batch 1/,/Batch 2/{/Batch 2/d;p;}')"
assert_contains "$batch1_3" "M-CI-1" "M-CI-1 in batch 1"
assert_contains "$batch1_3" "C-UO-1" "C-UO-1 in batch 1"

# --- Circular dependency detection ---

repo2="$(setup_temp_repo)"
use_fixture "$repo2" "circular_deps.md"

describe "circular dependency is detected and returns error"
output_circ="$(run_nw "$repo2" batch-order H-CC-1 H-CC-2 H-CC-3 || true)"
rc="$(run_nw_rc "$repo2" batch-order H-CC-1 H-CC-2 H-CC-3)"
assert_contains "$output_circ" "Circular dependency" "circular dependency message"
assert_eq "1" "$rc" "exits with code 1 on circular dependency"

describe "circular dependency error lists remaining items"
assert_contains "$output_circ" "H-CC-1" "H-CC-1 in error output"
assert_contains "$output_circ" "H-CC-2" "H-CC-2 in error output"
assert_contains "$output_circ" "H-CC-3" "H-CC-3 in error output"

# --- Partial circular: some items can be batched before cycle is hit ---

repo3="$(setup_temp_repo)"
# Create a fixture with a free item and a circular pair
cat > "$repo3/TODOS.md" << 'FIXTURE'
# TODOS

## Mixed

### Feat: Free item (H-MX-1)

**Priority:** High
**Source:** Test
**Depends on:** None

No dependencies.

Acceptance: Test fixture only.

---

### Feat: Cycle A (H-MX-2)

**Priority:** High
**Source:** Test
**Depends on:** H-MX-3

Depends on H-MX-3.

Acceptance: Test fixture only.

---

### Feat: Cycle B (H-MX-3)

**Priority:** High
**Source:** Test
**Depends on:** H-MX-2

Depends on H-MX-2.

Acceptance: Test fixture only.

---
FIXTURE
git -C "$repo3" add TODOS.md && git -C "$repo3" commit -m "fixture" --quiet

describe "partial circular: free item batched, then circular error"
output_partial="$(run_nw "$repo3" batch-order H-MX-1 H-MX-2 H-MX-3 || true)"
assert_contains "$output_partial" "Batch 1" "batch 1 for free item"
assert_contains "$output_partial" "H-MX-1" "H-MX-1 batched"
assert_contains "$output_partial" "Circular dependency" "circular detected after batch 1"

# --- Single item ---

describe "single item with no deps goes to batch 1"
output_single="$(run_nw "$repo" batch-order M-CI-1)"
assert_contains "$output_single" "Batch 1" "batch 1 exists"
assert_contains "$output_single" "M-CI-1" "M-CI-1 in output"
assert_contains "$output_single" "1 items" "1 item in batch"

# --- Unknown item warning ---

describe "unknown item is warned and skipped"
output_unknown="$(run_nw "$repo" batch-order M-CI-1 FAKE-ID-99)"
assert_contains "$output_unknown" "Warning" "warning about unknown item"
assert_contains "$output_unknown" "FAKE-ID-99" "mentions the unknown ID"
assert_contains "$output_unknown" "M-CI-1" "valid item still processed"

print_results "test_batch_order.sh"
