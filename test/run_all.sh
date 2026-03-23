#!/usr/bin/env bash
# Run all tests in the test/ directory.
# Usage: bash test/run_all.sh

set -euo pipefail

TEST_DIR="$(cd "$(dirname "$0")" && pwd)"
total_passed=0
total_failed=0
total_run=0
failed_files=""

echo "Running ninthwave test suite..."
echo

for test_file in "$TEST_DIR"/test_*.sh; do
  [[ -f "$test_file" ]] || continue

  # Run each test file in a subshell to isolate state
  set +e
  output="$(bash "$test_file" 2>&1)"
  rc=$?
  set -e

  echo "$output"
  echo

  if [[ $rc -ne 0 ]]; then
    failed_files="$failed_files $(basename "$test_file")"
  fi

  # Extract counts from the summary line (e.g., "15/15 tests passed")
  summary="$(echo "$output" | tail -1)"
  if [[ "$summary" =~ ([0-9]+)/([0-9]+)\ tests\ passed ]]; then
    local_passed="${BASH_REMATCH[1]}"
    local_total="${BASH_REMATCH[2]}"
    local_failed=$((local_total - local_passed))
    total_passed=$((total_passed + local_passed))
    total_run=$((total_run + local_total))
    total_failed=$((total_failed + local_failed))
  fi
done

echo "========================================"
if [[ $total_failed -eq 0 ]]; then
  printf '\033[0;32mAll tests passed: %d/%d\033[0m\n' "$total_passed" "$total_run"
  exit 0
else
  printf '\033[0;31m%d/%d tests passed (%d failed)\033[0m\n' "$total_passed" "$total_run" "$total_failed"
  echo "Failed in:$failed_files"
  exit 1
fi
