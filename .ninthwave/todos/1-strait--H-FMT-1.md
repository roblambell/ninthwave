---
id: H-FMT-1
priority: high
domain: strait
title: Fix cargo fmt violations across all source files
repo: strait
depends: []
---

# Fix cargo fmt violations across all source files

## Context
CI is failing on strait because workers committed code without running `cargo fmt`. The `cargo fmt --check` step reports formatting diffs across: `audit.rs`, `ca.rs`, `credentials.rs`, `main.rs`, `mitm.rs`, `policy.rs`.

## Requirements
1. Run `cargo fmt` in the strait repo to fix all formatting issues
2. Verify `cargo fmt --check` passes (exit code 0)
3. Verify `cargo test --all-features` still passes
4. Verify `cargo clippy --all-features -- -D warnings` still passes

## Key Files
- `src/audit.rs`
- `src/ca.rs`
- `src/credentials.rs`
- `src/main.rs`
- `src/mitm.rs`
- `src/policy.rs`

## Estimated Complexity
Small — just run `cargo fmt` and commit.
