#!/usr/bin/env bash
# Tests for parse_todos (via the `list` command).

set -euo pipefail
source "$(dirname "$0")/helpers.sh"

echo "=== parse_todos ==="

# --- Well-formed input ---

repo="$(setup_temp_repo)"
use_fixture "$repo" "valid.md"
output="$(run_nw "$repo" list)"

describe "parses all 4 items from valid fixture"
count="$(echo "$output" | grep -cE '^[A-Z]-[A-Z]+-[0-9]+' || true)"
assert_eq "4" "$count" "$_CURRENT_TEST"

describe "extracts correct IDs"
assert_contains "$output" "M-CI-1" "contains M-CI-1"
assert_contains "$output" "H-CI-2" "contains H-CI-2"
assert_contains "$output" "C-UO-1" "contains C-UO-1"
assert_contains "$output" "H-UO-2" "contains H-UO-2"

describe "extracts correct priorities"
# M-CI-1 is medium
line_mci1="$(echo "$output" | grep 'M-CI-1')"
assert_contains "$line_mci1" "medium" "M-CI-1 has medium priority"

# H-CI-2 is high
line_hci2="$(echo "$output" | grep 'H-CI-2')"
assert_contains "$line_hci2" "high" "H-CI-2 has high priority"

# C-UO-1 is critical
line_cuo1="$(echo "$output" | grep 'C-UO-1')"
assert_contains "$line_cuo1" "critical" "C-UO-1 has critical priority"

describe "extracts correct titles"
assert_contains "$line_mci1" "Upgrade CI runners" "M-CI-1 title"
assert_contains "$line_hci2" "Flaky connection pool timeout" "H-CI-2 title"

describe "extracts correct domains"
assert_contains "$line_mci1" "cloud-infrastructure" "M-CI-1 domain"
assert_contains "$line_cuo1" "user-onboarding" "C-UO-1 domain"

describe "extracts dependencies"
assert_contains "$line_hci2" "M-CI-1" "H-CI-2 depends on M-CI-1"
# H-UO-2 depends on C-UO-1 and M-CI-1
line_huo2="$(echo "$output" | grep 'H-UO-2')"
assert_contains "$line_huo2" "C-UO-1" "H-UO-2 depends on C-UO-1"

describe "all items have open status (no worktrees)"
assert_contains "$line_mci1" "open" "M-CI-1 is open"
assert_contains "$line_hci2" "open" "H-CI-2 is open"
assert_contains "$line_cuo1" "open" "C-UO-1 is open"

# --- Malformed input ---

repo2="$(setup_temp_repo)"
use_fixture "$repo2" "malformed.md"
output2="$(run_nw "$repo2" list)"

describe "skips item with no ID"
assert_not_contains "$output2" "Item with no ID" "no-ID item not in output"

describe "parses item with missing priority (empty priority field)"
assert_contains "$output2" "H-BK-2" "H-BK-2 present"

describe "parses valid item after malformed ones"
assert_contains "$output2" "M-BK-3" "M-BK-3 present"
line_mbk3="$(echo "$output2" | grep 'M-BK-3')"
assert_contains "$line_mbk3" "medium" "M-BK-3 has medium priority"

describe "only 2 items parsed from malformed fixture (no-ID item skipped)"
count2="$(echo "$output2" | grep -cE '^[A-Z]-[A-Z]+-[0-9]+' || true)"
assert_eq "2" "$count2" "$_CURRENT_TEST"

# --- Empty input ---

repo3="$(setup_temp_repo)"
use_fixture "$repo3" "empty.md"
output3="$(run_nw "$repo3" list)"

describe "empty TODOS.md produces no items"
count3="$(echo "$output3" | grep -cE '^[A-Z]-[A-Z]+-[0-9]+' || true)"
assert_eq "0" "$count3" "$_CURRENT_TEST"

describe "empty TODOS.md still shows header line"
assert_contains "$output3" "ID" "header present"

# --- Multi-section input ---

repo4="$(setup_temp_repo)"
use_fixture "$repo4" "multi_section.md"
output4="$(run_nw "$repo4" list)"

describe "parses items across multiple sections"
count4="$(echo "$output4" | grep -cE '^[A-Z]-[A-Z]+-[0-9]+' || true)"
assert_eq "3" "$count4" "$_CURRENT_TEST"

describe "assigns correct domains from different sections"
line_hal1="$(echo "$output4" | grep 'H-AL-1')"
line_hbe1="$(echo "$output4" | grep 'H-BE-1')"
assert_contains "$line_hal1" "section-alpha" "H-AL-1 in section-alpha domain"
assert_contains "$line_hbe1" "section-beta" "H-BE-1 in section-beta domain"

# --- Filter: --priority ---

describe "filter by priority returns matching items"
filtered="$(run_nw "$repo" list --priority high)"
assert_contains "$filtered" "H-CI-2" "high priority filter includes H-CI-2"
assert_contains "$filtered" "H-UO-2" "high priority filter includes H-UO-2"
# Check that excluded items don't appear as row IDs (they may appear in dependency columns)
filtered_ids="$(echo "$filtered" | grep -oE '^[A-Z]-[A-Z]+-[0-9]+' || true)"
assert_not_contains "$filtered_ids" "M-CI-1" "high priority filter excludes M-CI-1 as row"
assert_not_contains "$filtered_ids" "C-UO-1" "high priority filter excludes C-UO-1 as row"

# --- Filter: --domain ---

describe "filter by domain returns matching items"
filtered_domain="$(run_nw "$repo" list --domain cloud-infrastructure)"
assert_contains "$filtered_domain" "M-CI-1" "domain filter includes M-CI-1"
assert_contains "$filtered_domain" "H-CI-2" "domain filter includes H-CI-2"
assert_not_contains "$filtered_domain" "C-UO-1" "domain filter excludes C-UO-1"

print_results "test_parse_todos.sh"
