# Feat: Add --version and --help flags to CLI (H-CLI-2)

**Priority:** High
**Source:** Vision L-VIS-5
**Depends on:** -
**Domain:** cli

Add conventional `--version` / `-v` and `--help` / `-h` flags to the CLI entry point. Currently `ninthwave version` works as a subcommand and the default (no args) prints help, but standard CLI convention expects flag-style invocations to work too.

Changes:
1. In `core/cli.ts`, intercept `--version` / `-v` before command dispatch — print version and exit.
2. Intercept `--help` / `-h` before command dispatch — print help and exit.
3. Support `ninthwave <command> --help` to show command-specific help if applicable.

Acceptance: `ninthwave --version` prints the version. `ninthwave --help` prints the usage. `ninthwave -v` and `ninthwave -h` are aliases.

Test plan: Unit tests verifying flag parsing. Manual test: `bun run core/cli.ts --version` and `bun run core/cli.ts --help`.

Key files: `core/cli.ts`
