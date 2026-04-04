# ninthwave Architecture

A reference for contributors who want to understand how the pieces fit together before diving into code.

See also: [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and coding conventions.

---

## Table of Contents

1. [Orchestrator State Machine](#orchestrator-state-machine)
2. [Data Flow](#data-flow)
3. [Key Abstractions](#key-abstractions)
4. [Extension Points](#extension-points)
5. [Worker Lifecycle](#worker-lifecycle)
6. [Repo Reference Identity](#repo-reference-identity)

---

## Orchestrator State Machine

Each work item moves through a state machine defined in [`core/orchestrator.ts`](core/orchestrator.ts). The `processTransitions` function is pure -- it takes a poll snapshot and returns actions to execute; no side effects.

### States

| State | Description |
|-------|-------------|
| `queued` | Added to orchestration; waiting for dependencies to complete |
| `ready` | Dependencies done; waiting for a WIP slot |
| `launching` | Worktree created, AI session being started |
| `implementing` | Worker is active and coding |
| `ci-pending` | PR created; CI checks running (or awaiting CI start) |
| `ci-passed` | CI green; ready to merge (or review) |
| `ci-failed` | CI red; worker being notified |
| `rebasing` | Rebaser worker resolving merge conflicts |
| `review-pending` | Awaiting review worker launch |
| `reviewing` | Review worker active (tracked via separate `reviewSessionLimit`) |
| `merging` | Merge in progress |
| `merged` | PR merged |
| `forward-fix-pending` | Post-merge CI check pending |
| `fix-forward-failed` | Post-merge CI failed; forward-fixer being launched |
| `fixing-forward` | Forward-fixer worker fixing a broken main branch |
| `done` | Cleanup complete |
| `blocked` | Dependency is stuck; waiting for resolution |
| `stuck` | Max retries exhausted or unrecoverable failure |

### Transition Diagram

```mermaid
stateDiagram-v2
    [*] --> queued : addItem()
    queued --> ready : deps done
    queued --> blocked : dep stuck
    ready --> launching : WIP slot available
    launching --> implementing : worker started
    implementing --> ci_pending : PR detected
    implementing --> stuck : launch/activity timeout
    ci_pending --> ci_passed : all checks green
    ci_pending --> ci_failed : check failure
    ci_passed --> merging : merge (review skipped)
    ci_passed --> reviewing : review worker launched
    reviewing --> merging : approved
    reviewing --> ci_failed : CI regression
    reviewing --> review_pending : request-changes
    review_pending --> ci_failed : CI failure
    review_pending --> ci_pending : implementer pushes fix
    ci_failed --> ci_pending : worker notified, retrying
    ci_failed --> rebasing : merge conflict
    ci_failed --> stuck : maxCiRetries exceeded
    rebasing --> ci_pending : rebase complete
    merging --> merged : gh merge succeeded
    merged --> done : cleanup complete (no fix-forward)
    merged --> forward_fix_pending : fix-forward enabled
    forward_fix_pending --> done : merge-commit CI passes
    forward_fix_pending --> fix_forward_failed : merge-commit CI fails
    fix_forward_failed --> fixing_forward : forward-fixer launched
    fixing_forward --> done : fix merged
    stuck --> ready : retry command
    blocked --> queued : dep recovers
```

### WIP Limit

States that count toward the WIP limit (see `OrchestratorConfig.sessionLimit`): `launching`, `implementing`, `ci-pending`, `ci-passed`, `ci-failed`, `rebasing`, `review-pending`, `merging`. Review workers (`reviewing`) have a separate limit (`reviewSessionLimit`).

### Stacked Launches

When `enableStacking=true`, an item whose only in-flight dependency is in a "stackable" state (`ci-passed`, `reviewing`, `review-pending`, `merging`) can launch early against the dep's branch rather than waiting for the dep to fully merge. See `STACKABLE_STATES` in `core/orchestrator-types.ts`.

---

## Data Flow

```
User runs /decompose
  └─→ skill explores codebase, writes .ninthwave/work/*.md (one file per work item)

User runs nw
  └─→ CLI handles selection/settings, then launches orchestration
      ├─ git worktree create .ninthwave/.worktrees/ninthwave-<ID>
      ├─ allocate partition (port/DB isolation) via core/partitions.ts
      ├─ seed agent files into worktree (core/commands/launch.ts seedAgentFiles)
      └─ launch AI session in multiplexer workspace, send worker prompt

Worker session (per work item)
  ├─ reads project CLAUDE.md / AGENTS.md for conventions
  ├─ implements the work item, runs tests
  ├─ git push → gh pr create
  └─ idles, waiting for orchestrator messages

nw (orchestrator event loop, ~10s poll)
  ├─ poll GitHub for PR/CI/review status (core/commands/orchestrate.ts)
  ├─ poll multiplexer for worker liveness (core/mux.ts readScreen)
  ├─ run processTransitions (pure state machine → list of Actions)
  ├─ executeAction for each action:
  │   ├─ launch   → launch.ts launchSingleItem
  │   ├─ merge    → gh.ts prMerge
  │   ├─ notify-ci-failure  → mux.sendMessage to worker
  │   ├─ notify-review      → mux.sendMessage to worker
  │   ├─ rebase   → git.ts daemonRebase
  │   ├─ clean    → clean.ts cleanSingleWorktree
  │   └─ launch-review → launch.ts launchReviewWorker

Post-merge
  ├─ if merge-commit CI fails, forward-fixer launches and chooses the smallest safe repair PR
  │   (fix-forward, disable a newly introduced feature flag, or revert)
  ├─ worktree and workspace cleaned up
  ├─ work item file removed from .ninthwave/work/
  ├─ stacked dependents retargeted to main
  └─ version bump deferred until all items done
```

Key files: [`core/parser.ts`](core/parser.ts) (read work items), [`core/commands/launch.ts`](core/commands/launch.ts) (launch), [`core/commands/orchestrate.ts`](core/commands/orchestrate.ts) (event loop), [`core/commands/clean.ts`](core/commands/clean.ts) (cleanup).

---

## Key Abstractions

### `Multiplexer` -- `core/mux.ts`

Abstracts terminal multiplexer operations behind a clean interface.

```typescript
interface Multiplexer {
  readonly type: MuxType;                                           // "cmux" | "tmux" | "headless"
  isAvailable(): boolean;
  diagnoseUnavailable(): string;
  launchWorkspace(cwd: string, command: string, workItemId?: string): string | null;
  splitPane(command: string): string | null;
  sendMessage(ref: string, message: string): boolean;
  readScreen(ref: string, lines?: number): string;
  listWorkspaces(): string;
  closeWorkspace(ref: string): boolean;
  setStatus(ref: string, key: string, text: string, icon: string, color: string): boolean;
  setProgress(ref: string, value: number, label?: string): boolean;
}
```

Shipped implementations:

- `CmuxAdapter` -- wraps the cmux CLI. Workspace refs look like `workspace:1`. cmux supports sidebar-oriented status/progress updates, but it must be used from inside an active cmux session.
- `TmuxAdapter` -- wraps tmux using a **windows-within-session** model: one tmux session per project, one `nw_<workItemId>` window per worker. Refs use tmux's `session:window` target syntax, typically `{session}:nw_<ID>` (that is, the `{session}:nw:{workItemId}` worker identity encoded as a tmux window target). Message delivery is paste-then-submit: `tmux load-buffer -`, `tmux paste-buffer`, then `tmux send-keys Enter`.
- `HeadlessAdapter` -- fallback when no terminal multiplexer is available. Used for headless/remote execution. Workspace refs use `%<ID>` format.

### Multiplexer Detection Chain

`detectMuxType()` and `checkAutoLaunch()` share the same six-step preference order:

1. `NINTHWAVE_MUX` override (`tmux`, `cmux`, or `headless`) -- invalid values warn and fall through.
2. `CMUX_WORKSPACE_ID` -- if present, stay on cmux because the user is already inside a cmux workspace.
3. `$TMUX` -- if present, stay on tmux because the user is already inside a tmux session.
4. Installed `tmux` binary -- preferred over cmux when the user is **not** already inside a multiplexer session, because tmux can create/manage its own project session.
5. Installed `cmux` binary -- usable for detection, but launch-time checks still require the user to actually be inside cmux.
6. Headless fallback -- when no multiplexer is detected, falls back to `HeadlessAdapter`.

### iTerm2 + tmux

tmux works especially well with iTerm2's control mode (`tmux -CC`). In that mode, tmux windows are rendered as native iTerm2 tabs, so ninthwave workers launched by `TmuxAdapter` show up as normal-looking iTerm2 tabs while still being managed through tmux session/window refs.

---

## Extension Points

### Adding a New Multiplexer Adapter

> **Note:** cmux and tmux are both shipped adapters. The Multiplexer interface remains extensible for community adapters beyond those two backends.

1. Add your type to `MuxType` in `core/mux.ts`:
   ```typescript
   export type MuxType = "cmux" | "mymux";
   ```
2. Implement the `Multiplexer` interface as a new adapter class (follow `CmuxAdapter` and `TmuxAdapter` as templates).
3. Add detection logic in `detectMuxType()` and any launch-gating needed in `checkAutoLaunch()`.
4. Add a case in `getMux()` to return the new adapter.
5. Add tests in `test/mux.test.ts`.

### Adding a New CLI Command

1. Create `core/commands/mycommand.ts` and export a `cmdMyCommand(args: string[])` function.
2. Import and route it in `core/cli.ts`:
   ```typescript
   import { cmdMyCommand } from "./commands/mycommand.ts";
   // ...inside the arg-switch:
   case "mycommand":
     cmdMyCommand(args);
     break;
   ```
3. Add a `CommandEntry` to `COMMAND_REGISTRY` in `core/help.ts`:
   ```typescript
   {
     name: "mycommand",
     usage: "mycommand [--flag]",
     description: "One-line description",
     group: "Advanced",
     needsRoot: true,
     handler: (ctx) => cmdMyCommand(ctx.args),
   },
   ```
4. Add tests in `test/mycommand.test.ts`.

---

---

## Worker Lifecycle

Each work item gets an isolated AI coding session managed as follows:

### Launch

`launchSingleItem()` in [`core/commands/launch.ts`](core/commands/launch.ts):

1. Create an isolated git worktree and item branch for the worker.
2. `allocatePartition(id)` -- assigns a unique port range and DB prefix for test isolation.
3. `seedAgentFiles(worktreePath, hubRoot)` -- copies `implementer.md` to `.claude/agents/`, `.opencode/agents/`, `.github/agents/` inside the worktree.
4. `mux.launchWorkspace(worktreePath, command, workItemId)` -- spawns the session; returns a workspace ref (e.g., `"workspace:1"` for cmux, `"{session}:nw_<ID>"` for tmux).
5. `sendWithReadyWait(mux, ref, prompt, ...)` -- waits for the AI prompt, sends the implementer instructions, verifies the worker starts processing.

The workspace ref is stored in `OrchestratorItem.workspaceRef` for later messaging and cleanup.

### Heartbeat and Health

The orchestrator tracks multiple signals per worker:

- **Worker liveness** (`workerAlive`): determined by `isWorkerAliveWithCache()` in [`core/snapshot.ts`](core/snapshot.ts). Checks whether the worker's workspace ref appears in the multiplexer's workspace listing. Debounced via `notAliveCount` (3 consecutive not-alive checks required before declaring dead).
- **Commit freshness** (`lastCommitTime`): timestamp of the most recent commit on `ninthwave/<ID>`. A worker with recent commits is considered active.
- **Heartbeat** (`lastHeartbeat`): worker progress file with timestamp. A fresh heartbeat (< 5 min) suppresses all timeout checks.

Timeout thresholds (configurable via `OrchestratorConfig`): 30 minutes for a worker with no commits since launch (`launchTimeoutMs`), 60 minutes for a worker with stale commits (`activityTimeoutMs`).

### Cleanup

`cleanSingleWorktree(id, ...)` in [`core/commands/clean.ts`](core/commands/clean.ts):

1. `mux.closeWorkspace(workspaceRef)` -- closes the terminal session.
2. `git worktree remove .ninthwave/.worktrees/ninthwave-<ID>` -- removes the checkout.
3. `releasePartition(id)` -- frees the port/DB allocation.

---

## Terminology

`work item` is the canonical term across the current product, code, and docs.

---

## Crew Broker

The broker coordinates work-item scheduling across multiple `nw` daemons in a crew. The protocol surface (sync, claim, complete, heartbeat, schedule-claim) is defined once in shared modules and consumed by two runtimes.

### Broker-Core + Runtime Split

| Module | Role |
|--------|------|
| `core/broker-state.ts` | Pure state-machine functions (claim, sync, complete, heartbeat checks, author-affinity scheduling). No I/O. |
| `core/broker-store.ts` | Storage interfaces and implementations: `InMemoryBrokerStore` (used by the in-process mock broker and tests) and `FileBrokerStore` (used by the self-hosted broker for JSON-file persistence). |
| `core/mock-broker.ts` | In-process mock broker (`MockBroker`). Ephemeral, in-memory, started automatically by the orchestrator when crew mode is active and the daemon connects to the hosted service or needs a local test surface. |
| `core/broker-server.ts` | Self-hosted broker runtime (`BrokerServer`). Long-running Bun HTTP+WebSocket server with file-backed persistence and repo-reference enforcement. Started via `nw broker`. |
| `core/commands/broker.ts` | CLI command handler. Parses `--host`, `--port`, `--data-dir`, `--event-log`, and `--save-crew-url` flags, starts the `BrokerServer`, and optionally persists the broker URL as `crew_url` in project config. |

Both runtimes delegate all scheduling decisions to `broker-state.ts`. The difference is lifecycle and persistence:

- **MockBroker** -- starts and stops with the orchestrator process, state lives in memory.
- **BrokerServer** -- runs independently (`nw broker`), persists crew state to `<data-dir>/<code>.json`, and enforces repo-reference matching on WebSocket connect.

### `crew_url` Configuration

By default, `nw` connects to the hosted broker at `wss://ninthwave.sh`. To point a project at a self-hosted broker instead:

```bash
nw broker --save-crew-url          # starts the broker and writes crew_url to .ninthwave/config.json
```

Or set it manually in `.ninthwave/config.json`:

```json
{ "crew_url": "ws://your-host:4444" }
```

The orchestrator resolves `crew_url` at startup: CLI `--crew-url` flag > project config > hosted default (`wss://ninthwave.sh`).

### Repo-Reference Verification

When a crew is created with a repo reference, the broker stores the normalized repo identity (`repoRef`). On every subsequent WebSocket connect, the daemon's repo URL/hash is resolved via `core/repo-ref.ts` and compared against the crew's stored `repoRef`. Mismatches are rejected with HTTP 403, preventing cross-project crew joins.

### v1 Non-Goals

The self-hosted broker is intentionally minimal in v1:

- **No TLS termination** -- use a reverse proxy (nginx, Caddy, etc.) for HTTPS/WSS.
- **No authentication** -- access control is via network boundaries; the broker trusts all connections that pass repo-reference verification.
- **No multi-tenant isolation** -- one broker instance per trust boundary.
- **No horizontal scaling** -- single-process, single-node.

---

## Repo Reference Identity

`core/repo-ref.ts` defines the shared repo identity rules used by client and broker code.

- `normalizeRepoUrl()` strips transport details (SSH vs HTTPS), auth, trailing slashes, and `.git`, then normalizes equivalent references to one host-and-path form such as `github.com/org/repo`.
- `hashRepoUrl()` and `hashNormalizedRepoUrl()` derive the stable SHA-256 repo identity persisted as `repoHash`/`repoRef`.
- `resolveRepoRef()` accepts any supported identity input (`repoUrl`, `repoHash`, or stored `repoRef`), validates consistency when more than one is present, and returns one canonical comparison value.
- `compareRepoRefs()` gives later join and runtime checks a shared primitive for rejecting repo mismatches without duplicating normalization logic.
