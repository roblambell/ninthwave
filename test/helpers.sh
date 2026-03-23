#!/usr/bin/env bash
# Test helper functions for batch-todos.sh tests.
# Provides assertion primitives and temp git repo setup/teardown.

set -euo pipefail

# --- Test state ---
_TESTS_RUN=0
_TESTS_PASSED=0
_TESTS_FAILED=0
_FAILURES=""
_CURRENT_TEST=""

# Path to the real batch-todos.sh (resolved from this helper's location)
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BATCH_TODOS="$TEST_DIR/../core/batch-todos.sh"

# --- Temp repo management ---
# Each test file gets an isolated git repo so tests don't interfere.

_TEMP_DIRS=()

setup_temp_repo() {
  local tmp
  tmp="$(mktemp -d)"
  _TEMP_DIRS+=("$tmp")

  # Minimal git repo
  git -C "$tmp" init --quiet
  git -C "$tmp" config user.email "test@test.com"
  git -C "$tmp" config user.name "Test"

  # Create required structure
  mkdir -p "$tmp/core"
  ln -s "$BATCH_TODOS" "$tmp/core/batch-todos.sh"

  echo "$tmp"
}

# Place a fixture as TODOS.md in the temp repo
use_fixture() {
  local repo="$1" fixture_name="$2"
  cp "$TEST_DIR/fixtures/$fixture_name" "$repo/TODOS.md"
  # Stage and commit so git tracks it
  git -C "$repo" add TODOS.md
  git -C "$repo" commit -m "Add TODOS.md" --quiet 2>/dev/null || true
}

# Run the batch-todos CLI from within a temp repo
run_nw() {
  local repo="$1"
  shift
  # Run from the repo directory so git rev-parse finds the right root.
  # Use env -i to get a clean env, but pass through PATH and HOME.
  # Disable colors by piping through cat (non-tty detection).
  (cd "$repo" && bash core/batch-todos.sh "$@") 2>&1
}

# Run and capture only the exit code (output discarded)
run_nw_rc() {
  local repo="$1"
  shift
  local rc=0
  (cd "$repo" && bash core/batch-todos.sh "$@") &>/dev/null || rc=$?
  echo "$rc"
}

cleanup_temp_repos() {
  for d in "${_TEMP_DIRS[@]+"${_TEMP_DIRS[@]}"}"; do
    [[ -d "$d" ]] && rm -rf "$d"
  done
  _TEMP_DIRS=()
}

# --- Assertion functions ---

describe() {
  _CURRENT_TEST="$1"
}

assert_eq() {
  local expected="$1" actual="$2" msg="${3:-$_CURRENT_TEST}"
  _TESTS_RUN=$((_TESTS_RUN + 1))
  if [[ "$expected" == "$actual" ]]; then
    _TESTS_PASSED=$((_TESTS_PASSED + 1))
    printf '  \033[0;32m✓\033[0m %s\n' "$msg"
  else
    _TESTS_FAILED=$((_TESTS_FAILED + 1))
    printf '  \033[0;31m✗\033[0m %s\n' "$msg"
    printf '    expected: %s\n' "$expected"
    printf '    actual:   %s\n' "$actual"
    _FAILURES="$_FAILURES\n  ✗ $msg"
  fi
}

assert_contains() {
  local haystack="$1" needle="$2" msg="${3:-$_CURRENT_TEST}"
  _TESTS_RUN=$((_TESTS_RUN + 1))
  if [[ "$haystack" == *"$needle"* ]]; then
    _TESTS_PASSED=$((_TESTS_PASSED + 1))
    printf '  \033[0;32m✓\033[0m %s\n' "$msg"
  else
    _TESTS_FAILED=$((_TESTS_FAILED + 1))
    printf '  \033[0;31m✗\033[0m %s\n' "$msg"
    printf '    expected to contain: %s\n' "$needle"
    printf '    actual: %s\n' "${haystack:0:200}"
    _FAILURES="$_FAILURES\n  ✗ $msg"
  fi
}

assert_not_contains() {
  local haystack="$1" needle="$2" msg="${3:-$_CURRENT_TEST}"
  _TESTS_RUN=$((_TESTS_RUN + 1))
  if [[ "$haystack" != *"$needle"* ]]; then
    _TESTS_PASSED=$((_TESTS_PASSED + 1))
    printf '  \033[0;32m✓\033[0m %s\n' "$msg"
  else
    _TESTS_FAILED=$((_TESTS_FAILED + 1))
    printf '  \033[0;31m✗\033[0m %s\n' "$msg"
    printf '    expected NOT to contain: %s\n' "$needle"
    _FAILURES="$_FAILURES\n  ✗ $msg"
  fi
}

assert_line_count() {
  local text="$1" expected="$2" msg="${3:-$_CURRENT_TEST}"
  local actual
  if [[ -z "$text" ]]; then
    actual=0
  else
    actual="$(echo "$text" | wc -l | tr -d ' ')"
  fi
  assert_eq "$expected" "$actual" "$msg"
}

assert_exit_code() {
  local expected="$1" actual="$2" msg="${3:-$_CURRENT_TEST}"
  assert_eq "$expected" "$actual" "$msg (exit code)"
}

assert_file_contains() {
  local file="$1" needle="$2" msg="${3:-$_CURRENT_TEST}"
  _TESTS_RUN=$((_TESTS_RUN + 1))
  if [[ -f "$file" ]] && grep -qF "$needle" "$file"; then
    _TESTS_PASSED=$((_TESTS_PASSED + 1))
    printf '  \033[0;32m✓\033[0m %s\n' "$msg"
  else
    _TESTS_FAILED=$((_TESTS_FAILED + 1))
    printf '  \033[0;31m✗\033[0m %s\n' "$msg"
    printf '    file: %s\n' "$file"
    printf '    expected to contain: %s\n' "$needle"
    _FAILURES="$_FAILURES\n  ✗ $msg"
  fi
}

assert_file_not_contains() {
  local file="$1" needle="$2" msg="${3:-$_CURRENT_TEST}"
  _TESTS_RUN=$((_TESTS_RUN + 1))
  if [[ -f "$file" ]] && ! grep -qF "$needle" "$file"; then
    _TESTS_PASSED=$((_TESTS_PASSED + 1))
    printf '  \033[0;32m✓\033[0m %s\n' "$msg"
  else
    _TESTS_FAILED=$((_TESTS_FAILED + 1))
    printf '  \033[0;31m✗\033[0m %s\n' "$msg"
    printf '    file: %s\n' "$file"
    printf '    expected NOT to contain: %s\n' "$needle"
    _FAILURES="$_FAILURES\n  ✗ $msg"
  fi
}

# --- Report ---

print_results() {
  local test_file="${1:-}"
  echo
  if [[ $_TESTS_FAILED -eq 0 ]]; then
    printf '\033[0;32m%d/%d tests passed\033[0m' "$_TESTS_PASSED" "$_TESTS_RUN"
  else
    printf '\033[0;31m%d/%d tests passed (%d failed)\033[0m' "$_TESTS_PASSED" "$_TESTS_RUN" "$_TESTS_FAILED"
  fi
  if [[ -n "$test_file" ]]; then
    printf ' in %s' "$test_file"
  fi
  echo
  cleanup_temp_repos
  return $_TESTS_FAILED
}
