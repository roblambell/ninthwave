# Local-First Runtime Controls Spec

## Summary

`nw` starts with one clear setup step and then lands in the live status UI. Work-item selection and a small startup settings screen are the only pre-status decisions. AI reviews, collaboration mode, and backend selection are visible on that startup surface; merge strategy and max inflight default silently at startup and remain adjustable from the running UI. A runtime drain toggle (`acceptingWork`) lets operators pause new launches without tearing down the live session.

The product center of gravity is local orchestration. `ninthwave.sh` is thin active-session coordination infrastructure, not the product's front door.

## Product Principles

1. Local first.
2. Safe by default.
3. No spooky carry-over state between plain runs.
4. One compact startup settings surface before status.
5. All run-shape controls stay available at runtime, even when they default silently at startup.

## Goals

1. Make plain `nw` feel immediate, local, and understandable.
2. Replace follow-up prompts and delays with a single startup settings screen.
3. Let users choose collaboration, AI reviews, and backend from that startup screen.
4. Keep merge strategy, collaboration, reviews, and max inflight adjustable from the live status page after startup.
5. Provide a runtime drain toggle that stops new launches without interrupting in-flight work.
6. Keep CLI flags as explicit per-run overrides for power users and scripts.
7. Reframe `ninthwave.sh` around active coordination rather than delivery metrics.

## Non-Goals

1. No saved collaboration sessions.
2. No session resume flow.
3. No login, GitHub app, or commercial workflow in the core path.
4. No lock/unlock join controls in v1.
5. No metrics-first positioning in the main startup experience.

## Default Run State

When there are no persisted preferences or CLI overrides, seed run settings with:

1. Collaboration: `Local`
2. AI reviews: `On`
3. Merge strategy: `Manual`
4. Max inflight: `1`
5. Accepting work: `true` (runtime-only; not persisted)

Collaboration and AI reviews appear on the startup settings screen so users can change them before orchestration begins. Merge strategy and max inflight are applied silently at startup and remain adjustable from the live UI after startup. Accepting work always starts `true` at the beginning of each session and is toggled from the live UI only.

## Startup Flow

The startup flow should collect all pre-status choices in one place.

Startup should ask for:

1. Work items
2. AI tool selection when multiple tools are available
3. A single startup settings screen containing:
   - `Reviews`
   - `Collaboration`
   - `Backend`

Merge strategy and max inflight are not on the startup settings screen. They use their defaults (or a user-persisted value for max inflight) at startup and are adjustable from the runtime controls overlay on the live status UI. The drain toggle (`acceptingWork`) is runtime-only and is never shown at startup.

## Startup Settings Screen

For plain `nw`:

1. Show work-item selection first
2. Show AI tool selection when multiple tools are available
3. Show one startup settings screen before the live status UI
4. Start orchestration immediately after the user confirms that screen
5. If the user selected `Join`, collect the session code as a direct follow-up before entering the live status UI

There is no separate arming step or claim-gating delay. The startup settings screen is the only pre-status control surface.

## Collaboration Model

Collaboration is available both at startup and at runtime with three states:

1. `Local`
2. `Shared`
3. `Joined`

### Share

In v1, host-side collaboration control is `Share` only:

1. User chooses `Share` from startup settings or runtime controls
2. A new active session is created
3. The UI shows the invite code for the current active session
4. Other machines can join with that code
5. There is no lock/unlock state in v1

### Join

1. User chooses `Join` from startup settings or runtime controls
2. User enters an active invite code
3. The daemon joins the shared session before claiming work
4. Joined daemons must not claim locally until broker connection succeeds

### Session Lifecycle

Sessions are ephemeral:

1. No saved session restore
2. No previous-session resume
3. No silent reconnection on plain `nw`
4. If sharing stops or the daemon disconnects, that collaboration state is gone
5. The next plain `nw` run returns to the startup settings screen; it does not silently resume an old session

## AI Review Model

AI reviews are available both at startup and at runtime as a binary toggle:

1. `Off`
2. `On`

When `On`, ninthwave dispatches an AI review worker for each ninthwave-managed PR. Review of PRs not created by ninthwave is out of scope for this surface; there is no longer a separate startup option for external PR review.

### Default Review Behavior

1. When no saved default or CLI override is present, startup preselects AI reviews `On`
2. Users can toggle reviews from the startup settings screen
3. Users can toggle review mode from the live status UI after startup
4. CLI flags can preselect the initial review mode for that run
5. Legacy three-state persisted values normalize to `On` on read so existing user configs keep working

## Merge Strategy Model

Merge strategy is available both at startup and at runtime with these states:

1. `Manual`
2. `Auto`
3. `Bypass`, only when already permitted by an explicit safety flag

### Default Merge Behavior

1. When no saved default or CLI override is present, the run begins with `Manual`
2. Merge strategy is not shown on the startup settings screen; it is applied silently at startup
3. Users can change merge strategy from the live status UI after startup
4. CLI flags can preselect the initial strategy for that run

### Merge Semantics

All merge strategies are CI-first. The difference is what happens after CI passes:

1. `Manual` -- CI must pass, then a human merges the PR
2. `Auto` -- CI must pass, then ninthwave auto-merges the PR
3. `Bypass` -- CI must pass, then ninthwave admin-merges without human approval requirements

## Max Inflight Model

Max inflight is applied silently at startup and remains adjustable from the live status UI. It caps how many work items can be in flight (in an active orchestrator state) at once.

### Default Max Inflight Behavior

1. Max inflight is not shown on the startup settings screen
2. When no user override exists, `nw` starts with a max inflight of `1`
3. A persisted user preference, when present, overrides the default
4. Users can change max inflight from the live status UI

### Runtime Max Inflight Controls

The live status page should support:

1. `+` to increase max inflight
2. `-` to decrease max inflight (minimum is `1`; drain is handled by the `acceptingWork` toggle, not by setting max inflight to zero)

Changing max inflight from the live status page should:

1. Update orchestration immediately for the current run
2. Persist the new value to user-level config

### Max Inflight Persistence And Precedence

There are three max inflight sources, in this order:

1. Explicit CLI `--max-inflight` for the current run (the prior name `--session-limit` is accepted as a deprecated alias)
2. User-level persisted max inflight preference (config key `max_inflight`; `session_limit` is still read as a fallback for older configs)
3. Fixed default of `1`

The persisted max inflight preference overrides the fixed default only. It does not replace explicit CLI intent for a run.

### Why Max Inflight Persists

Max inflight is a personal operator preference tied to machine capacity and working style. It should persist.

## Drain Mode Model (`acceptingWork`)

Drain mode is a runtime-only flow-control toggle that decides whether the orchestrator accepts new launches in the current session. It is separate from max inflight so the operator's preferred concurrency level is preserved across pause and resume.

### Semantics

1. `acceptingWork` is a boolean that defaults to `true` at the start of every `nw` session
2. When `acceptingWork` is `false`, no new items are launched -- ready items stay queued instead of advancing into the implementation pipeline
3. In-flight items continue through their full lifecycle: CI, review, rebase, fix-forward, and merge all proceed normally
4. `+` and `-` still adjust max inflight while draining, so the cap is ready the moment intake resumes
5. Toggling `acceptingWork` back to `true` resumes launches immediately using the current max inflight

### Runtime Drain Controls

The live status page should support:

1. `p` to toggle `acceptingWork` (mnemonic: "pause intake")
2. A visible "NOT ACCEPTING" indicator on the mode line and a `not accepting` badge on the queue header whenever `acceptingWork` is `false`, so drain mode is unambiguous at a glance

### Drain Mode Persistence

`acceptingWork` is **not** persisted. Each new `nw` session starts accepting work. It is an in-session flow control, not a user preference.

### Why Drain Is A Separate Toggle

Using `maxInflight = 0` for drain mode would erase the operator's preferred concurrency. With a separate toggle, the preferred limit is remembered through drain/resume cycles, and the visible cap on the live UI keeps reflecting what the operator intends to use once intake resumes.

## Runtime Controls UI

The live status page should continue exposing a lightweight settings or actions surface containing:

1. `Collaboration`
2. `Reviews`
3. `Merge`

The live status page should also support direct max inflight controls with `+` and `-`, and a drain toggle with `p`.

Recommended runtime options:

### Collaboration

1. `Local`
2. `Share`
3. `Join`

### Reviews

1. `Off`
2. `On`

### Merge

1. `Manual`
2. `Auto`
3. `Bypass`, when allowed

This can be a small modal, actions sheet, or settings dialog opened from a keyboard shortcut.

## Discoverability

The live UI should make these controls easy to find:

1. A visible hint in the main status UI
2. A help overlay entry
3. Keyboard shortcuts or a single `Settings` shortcut opening the control surface

## CLI Override Rules

Plain `nw` should open the startup settings screen seeded from persisted defaults and any explicit CLI overrides.

CLI flags should preselect only the current run's starting state.

Examples of explicit override intent include:

1. Join a session immediately
2. Share immediately
3. Start with reviews enabled
4. Start with a non-default merge strategy
5. Start with a specific max inflight (`--max-inflight N`; `--session-limit N` is the deprecated alias)

## ninthwave.sh Role

`ninthwave.sh` should be reduced to thin coordination infrastructure focused on active sessions.

Keep:

1. Session creation
2. Session join
3. Claim and coordination broker behavior
4. Minimal live active-session view

Remove or defer:

1. GitHub app
2. Login and account ceremony
3. Commercial framing
4. Delivery-metrics-first positioning

## Hosted UI Positioning

If any hosted UI remains in v1, it should support active collaboration rather than define the product.

Hosted emphasis should be on:

1. Active session presence
2. Session code
3. Minimal live status

It should not lead with delivery metrics as the primary user value.

## Copy And Messaging

Shift product language away from:

1. `Connect to ninthwave.sh`
2. `Track delivery metrics`
3. `Connected mode`

Toward:

1. `Collaborate`
2. `Share session`
3. `Join session`
4. `Local by default`

## Behavioral Contract

1. Plain `nw` always goes through one startup settings screen before the live status UI
2. There is no separate arming step or claim-gating delay after that screen
3. Plain `nw` never silently resumes an old collaboration session
4. Merge labels always mean CI must pass first
5. `Manual`, `Auto`, and `Bypass` differ only in what happens after CI passes
6. The same collaboration, review, merge, and max inflight controls remain available from the live status UI, plus the runtime-only `acceptingWork` drain toggle
7. Toggling `acceptingWork` to `false` stops new launches but does not interrupt in-flight items

## Acceptance Criteria

1. Plain `nw` uses a single startup settings screen for reviews, collaboration, and backend selection
2. There is no separate arming step before first claim
3. When no saved default or CLI override exists, startup uses `Local`, `Reviews On`, and `Manual` merge
4. Plain `nw` starts with user-persisted max inflight when present, otherwise a max inflight of `1`
5. Stopping and restarting `nw` never resumes an old session automatically
6. Review mode can be toggled at runtime between `Off` and `On`
7. Merge strategy can be changed at runtime to `Manual` or `Auto`, plus `Bypass` when allowed
8. Merge copy consistently explains `Manual`, `Auto`, and `Bypass` as CI-first modes
9. Pressing `+` or `-` in the live status page changes max inflight immediately
10. Max inflight changes made from the live status page persist to user-level config
11. An explicit `--max-inflight` flag overrides both persisted and default max inflight for that run (the legacy `--session-limit` flag is still accepted as a silent alias)
12. Collaboration, reviews, merge policy, and max inflight are all controllable from the live status UI
13. Pressing `p` in the live status page toggles `acceptingWork`; when `false`, new launches stop but in-flight items continue
14. `acceptingWork` is not persisted -- every new `nw` session starts accepting work
15. `ninthwave.sh` no longer appears as the primary reason to start `nw`

## Implementation Principle

The startup flow should choose work and set initial policy once. The running UI should keep those same controls live.

That is the core simplification.
