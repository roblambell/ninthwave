#!/usr/bin/env bash
# Tests for cmd_mark_done (item removal and empty section cleanup).

set -euo pipefail
source "$(dirname "$0")/helpers.sh"

echo "=== mark-done ==="

# --- Single item removal ---

repo="$(setup_temp_repo)"
use_fixture "$repo" "valid.md"

describe "removes a single item"
run_nw "$repo" mark-done M-CI-1 > /dev/null
# Check for the header pattern — the ID may still appear in other items' dependency fields
assert_file_not_contains "$repo/TODOS.md" "(M-CI-1)" "M-CI-1 header removed from file"
assert_file_not_contains "$repo/TODOS.md" "Upgrade CI runners" "M-CI-1 title removed"

describe "preserves other items after single removal"
assert_file_contains "$repo/TODOS.md" "(H-CI-2)" "H-CI-2 still present"
assert_file_contains "$repo/TODOS.md" "(C-UO-1)" "C-UO-1 still present"
assert_file_contains "$repo/TODOS.md" "(H-UO-2)" "H-UO-2 still present"

describe "preserves section headers with remaining items"
assert_file_contains "$repo/TODOS.md" "Cloud Infrastructure" "section header preserved"
assert_file_contains "$repo/TODOS.md" "User Onboarding" "section header preserved"

# --- Multiple item removal ---

repo2="$(setup_temp_repo)"
use_fixture "$repo2" "valid.md"

describe "removes multiple items at once"
run_nw "$repo2" mark-done M-CI-1 H-CI-2 > /dev/null
assert_file_not_contains "$repo2/TODOS.md" "(M-CI-1)" "M-CI-1 header removed"
assert_file_not_contains "$repo2/TODOS.md" "(H-CI-2)" "H-CI-2 header removed"
assert_file_not_contains "$repo2/TODOS.md" "Upgrade CI runners" "M-CI-1 title removed"
assert_file_not_contains "$repo2/TODOS.md" "Flaky connection pool" "H-CI-2 title removed"
assert_file_contains "$repo2/TODOS.md" "(C-UO-1)" "C-UO-1 still present"
assert_file_contains "$repo2/TODOS.md" "(H-UO-2)" "H-UO-2 still present"

# --- Empty section cleanup ---

repo3="$(setup_temp_repo)"
use_fixture "$repo3" "valid.md"

describe "removes section header when all items in section are removed"
# Remove both Cloud Infrastructure items
run_nw "$repo3" mark-done M-CI-1 H-CI-2 > /dev/null
assert_file_not_contains "$repo3/TODOS.md" "Cloud Infrastructure" "empty section removed"

describe "keeps section with remaining items"
assert_file_contains "$repo3/TODOS.md" "User Onboarding" "non-empty section preserved"

# --- Remove all items ---

repo4="$(setup_temp_repo)"
use_fixture "$repo4" "valid.md"

describe "removing all items leaves only the header"
run_nw "$repo4" mark-done M-CI-1 H-CI-2 C-UO-1 H-UO-2 > /dev/null
assert_file_not_contains "$repo4/TODOS.md" "(M-CI-1)" "M-CI-1 removed"
assert_file_not_contains "$repo4/TODOS.md" "(H-CI-2)" "H-CI-2 removed"
assert_file_not_contains "$repo4/TODOS.md" "(C-UO-1)" "C-UO-1 removed"
assert_file_not_contains "$repo4/TODOS.md" "(H-UO-2)" "H-UO-2 removed"
assert_file_not_contains "$repo4/TODOS.md" "Cloud Infrastructure" "section header removed"
assert_file_not_contains "$repo4/TODOS.md" "User Onboarding" "section header removed"
# The file header should remain
assert_file_contains "$repo4/TODOS.md" "# TODOS" "file header preserved"

# --- Mark-done output message ---

repo5="$(setup_temp_repo)"
use_fixture "$repo5" "valid.md"

describe "outputs confirmation message"
output="$(run_nw "$repo5" mark-done M-CI-1)"
assert_contains "$output" "Marked" "confirmation message present"
assert_contains "$output" "1 item" "item count in message"
assert_contains "$output" "M-CI-1" "ID in confirmation"

# --- Multi-section removal: remove from second section only ---

repo6="$(setup_temp_repo)"
use_fixture "$repo6" "multi_section.md"

describe "removes item from second section, preserves first section"
run_nw "$repo6" mark-done H-BE-1 > /dev/null
assert_file_not_contains "$repo6/TODOS.md" "(H-BE-1)" "H-BE-1 removed"
assert_file_contains "$repo6/TODOS.md" "(H-AL-1)" "H-AL-1 preserved"
assert_file_contains "$repo6/TODOS.md" "(M-AL-2)" "M-AL-2 preserved"
assert_file_contains "$repo6/TODOS.md" "Section Alpha" "first section preserved"

describe "removes empty second section header"
assert_file_not_contains "$repo6/TODOS.md" "Section Beta" "empty section removed"

print_results "test_mark_done.sh"
