# Feat: Integrate nono default sandboxing for worker launches (M-SBX-1)

**Priority:** Medium
**Source:** Vision L-VIS-5
**Depends on:** -
**Domain:** sandbox

Integrate [nono](https://github.com/always-further/nono) as the default sandboxing layer for worker processes. nono provides kernel-level sandboxing via Seatbelt (macOS) and Landlock (Linux) with zero startup latency.

Implementation:
1. Detect if `nono` is installed (`which nono`). If not, warn once and proceed without sandboxing.
2. When available, wrap the worker launch command with nono. Instead of `claude --agent ...`, run `nono -- claude --agent ...`.
3. Default filesystem policy:
   - Read-write: worktree directory (the isolated copy)
   - Read-only: project root, home directory config (~/.claude, ~/.config, etc.)
   - Read-only: Bun/Node caches, system libraries
4. Default network policy: allow GitHub API, npm/bun registries. Block everything else.
5. Opt-out via `--no-sandbox` flag on `ninthwave orchestrate` and `ninthwave start`.
6. Expose sandbox config in `.ninthwave/config` for customization (additional paths, network rules).

The sandbox wraps the AI tool process, not the orchestrator. The orchestrator runs unsandboxed (it needs git, gh, filesystem access across worktrees).

Acceptance: Workers launch inside nono sandbox by default when nono is installed. Workers can read/write their worktree but not the main checkout or other worktrees. `--no-sandbox` disables it. Missing nono produces a one-time warning, not an error.

Test plan: Unit tests for sandbox command construction. Integration test: launch a sandboxed worker, verify it can write to its worktree but not to /tmp/test-sentinel. Manual test on macOS with nono installed.

Key files: `core/mux.ts`, `core/commands/start.ts`, `core/commands/orchestrate.ts`
