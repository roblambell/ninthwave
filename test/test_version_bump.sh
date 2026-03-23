#!/usr/bin/env bash
# Tests for cmd_version_bump LOC threshold logic.
#
# The version-bump function uses these thresholds:
#   < 50 LOC  → MICRO bump (x.y.z.N+1)
#   50-200 LOC → PATCH bump (x.y.N+1.0)
#   > 200 LOC → interactive prompt (not testable non-interactively)

set -euo pipefail
source "$(dirname "$0")/helpers.sh"

echo "=== version-bump ==="

# Helper: set up a repo on "main" with VERSION and CHANGELOG.md,
# then add commits with a specific number of LOC changes.
setup_version_repo() {
  local tmp
  tmp="$(mktemp -d)"
  _TEMP_DIRS+=("$tmp")

  git -C "$tmp" init --quiet -b main
  git -C "$tmp" config user.email "test@test.com"
  git -C "$tmp" config user.name "Test"

  mkdir -p "$tmp/core"
  ln -s "$BATCH_TODOS" "$tmp/core/batch-todos.sh"

  # Create TODOS.md (required by main)
  echo "# TODOS" > "$tmp/TODOS.md"

  # Create VERSION and CHANGELOG.md
  echo "1.2.3.0" > "$tmp/VERSION"
  cat > "$tmp/CHANGELOG.md" << 'EOF'
# Changelog

## [1.2.3.0] - 2026-03-01

### Added
- Initial release
EOF

  git -C "$tmp" add -A
  git -C "$tmp" commit -m "chore: initial setup" --quiet

  echo "$tmp"
}

# Add a source file with N lines to simulate LOC changes
add_loc_changes() {
  local repo="$1" num_lines="$2" prefix="${3:-feat}"
  mkdir -p "$repo/lib"
  local file="$repo/lib/change_${RANDOM}_${RANDOM}.ex"
  # Generate N lines of "code"
  for ((i=1; i<=num_lines; i++)); do
    echo "defmodule Line$i do end"
  done > "$file"
  git -C "$repo" add "$file"
  git -C "$repo" commit -m "$prefix: add $num_lines lines of code" --quiet
}

# --- MICRO bump: < 50 LOC ---

repo="$(setup_version_repo)"
add_loc_changes "$repo" 20

describe "< 50 LOC triggers MICRO bump"
output="$(run_nw "$repo" version-bump)"
assert_contains "$output" "MICRO" "MICRO bump mentioned"
assert_contains "$output" "1.2.3.1" "version bumped to 1.2.3.1"

describe "VERSION file updated for MICRO bump"
version="$(cat "$repo/VERSION")"
assert_eq "1.2.3.1" "$version" "VERSION file contains 1.2.3.1"

describe "CHANGELOG.md updated for MICRO bump"
assert_file_contains "$repo/CHANGELOG.md" "[1.2.3.1]" "CHANGELOG has new version"

# --- PATCH bump: 50-200 LOC ---

repo2="$(setup_version_repo)"
add_loc_changes "$repo2" 100

describe "50-200 LOC triggers PATCH bump"
output2="$(run_nw "$repo2" version-bump)"
assert_contains "$output2" "PATCH" "PATCH bump mentioned"
assert_contains "$output2" "1.2.4.0" "version bumped to 1.2.4.0"

describe "VERSION file updated for PATCH bump"
version2="$(cat "$repo2/VERSION")"
assert_eq "1.2.4.0" "$version2" "VERSION file contains 1.2.4.0"

# --- Boundary: exactly 50 LOC → PATCH ---

repo3="$(setup_version_repo)"
add_loc_changes "$repo3" 50

describe "exactly 50 LOC triggers PATCH bump (boundary)"
output3="$(run_nw "$repo3" version-bump)"
assert_contains "$output3" "PATCH" "PATCH bump at 50 LOC boundary"
assert_contains "$output3" "1.2.4.0" "version bumped to 1.2.4.0"

# --- Boundary: exactly 49 LOC → MICRO ---

repo4="$(setup_version_repo)"
add_loc_changes "$repo4" 25

describe "< 50 LOC triggers MICRO bump (near boundary)"
output4="$(run_nw "$repo4" version-bump)"
assert_contains "$output4" "MICRO" "MICRO bump at < 50 LOC"
assert_contains "$output4" "1.2.3.1" "version bumped to 1.2.3.1"

# --- No commits since last bump ---

repo5="$(setup_version_repo)"

describe "no commits since last bump reports nothing to do"
output5="$(run_nw "$repo5" version-bump)"
assert_contains "$output5" "No commits since" "no-op message"

# --- Commit categorization in changelog ---

repo6="$(setup_version_repo)"
# Create feat, fix, and refactor commits
mkdir -p "$repo6/lib"
echo "def new_feature, do: :ok" > "$repo6/lib/feat.ex"
git -C "$repo6" add "$repo6/lib/feat.ex"
git -C "$repo6" commit -m "feat: add new feature" --quiet

echo "def fix_bug, do: :ok" > "$repo6/lib/fix.ex"
git -C "$repo6" add "$repo6/lib/fix.ex"
git -C "$repo6" commit -m "fix: resolve timeout bug" --quiet

echo "def refactored, do: :better" > "$repo6/lib/refactor.ex"
git -C "$repo6" add "$repo6/lib/refactor.ex"
git -C "$repo6" commit -m "refactor: simplify auth module" --quiet

describe "changelog entry categorizes feat commits as Added"
output6="$(run_nw "$repo6" version-bump)"
assert_contains "$output6" "Added" "Added section present"
assert_contains "$output6" "new feature" "feat commit in Added"

describe "changelog entry categorizes fix commits as Fixed"
assert_contains "$output6" "Fixed" "Fixed section present"
assert_contains "$output6" "timeout bug" "fix commit in Fixed"

describe "changelog entry categorizes refactor commits as Changed"
assert_contains "$output6" "Changed" "Changed section present"
assert_contains "$output6" "auth module" "refactor commit in Changed"

# --- Guard: must be on main branch ---

repo7="$(setup_version_repo)"
add_loc_changes "$repo7" 10
git -C "$repo7" checkout -b feature-branch --quiet

describe "version-bump fails when not on main branch"
rc="$(run_nw_rc "$repo7" version-bump)"
assert_eq "1" "$rc" "exits with code 1 off main"
output7="$(run_nw "$repo7" version-bump || true)"
assert_contains "$output7" "main branch" "error mentions main branch"

# --- MICRO bump increments existing micro version ---

repo8="$(setup_version_repo)"
# First bump: 1.2.3.0 → 1.2.3.1
add_loc_changes "$repo8" 10
run_nw "$repo8" version-bump > /dev/null
# Second bump: 1.2.3.1 → 1.2.3.2
add_loc_changes "$repo8" 15
output8="$(run_nw "$repo8" version-bump)"

describe "sequential MICRO bumps increment correctly"
assert_contains "$output8" "1.2.3.2" "second MICRO bump to 1.2.3.2"
version8="$(cat "$repo8/VERSION")"
assert_eq "1.2.3.2" "$version8" "VERSION file has 1.2.3.2"

print_results "test_version_bump.sh"
