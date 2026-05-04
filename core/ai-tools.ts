// AI tool profiles: single source of truth for Claude Code, OpenCode, Codex, Kimi, and Copilot.
//
// Defines AiToolId, AiToolProfile, LaunchDeps, LaunchOpts, and AI_TOOL_PROFILES.
// All other modules should derive tool-specific behaviour from this module rather
// than maintaining their own per-tool switch statements.

import { existsSync, mkdirSync as defaultMkdirSync, readFileSync as defaultReadFileSync, writeFileSync as defaultWriteFileSync } from "fs";
import { join } from "path";
import { run as defaultRun } from "./shell.ts";
import { pickRotatedEnv, type RotationDeps } from "./rotation.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Supported AI tool identifiers. */
export type AiToolId = "claude" | "opencode" | "codex" | "copilot" | "kimi";

/**
 * Injectable dependencies for launch command builders.
 * Keeping these injectable enables unit tests without touching the real filesystem
 * or spawning processes (especially important for Copilot's temp-file creation).
 */
export interface LaunchDeps {
  readFileSync: (path: string, encoding: BufferEncoding) => string;
  writeFileSync: (path: string, content: string) => void;
  mkdirSync: (path: string, options?: { recursive?: boolean }) => void;
  run: (cmd: string, args: string[]) => unknown;
}

/** Deterministic launch seam for tests and harnesses that replace provider CLIs. */
export interface LaunchOverride {
  /** Executable to run instead of the provider CLI binary. */
  command: string;
  /** Optional argv appended after the executable. */
  args?: string[];
  /** Optional extra environment variables for the override command. */
  env?: Record<string, string>;
}

/** Optional shared or mode-specific built-in tool override fields. */
export interface BuiltInToolOverrideModeConfig {
  /** Optional executable to use instead of the built-in CLI binary. */
  command?: string;
  /** Optional argv to append after the executable. */
  args?: string[];
  /** Optional extra environment variables for the override command. */
  env?: Record<string, string>;
  /**
   * Optional per-env-key rotation pools. For each entry, one value is picked
   * round-robin from the list per launch and merged into `env` (with rotation
   * winning on conflicts). A `null` entry advances the counter but does not
   * contribute a value, letting that launch fall back to the tool's default
   * profile (e.g. leave `CLAUDE_CONFIG_DIR` unset to use the native Keychain
   * login). Counter state is persisted globally so separate projects sharing
   * the same pool advance together.
   */
  env_rotation?: Record<string, Array<string | null>>;
}

/** User-configurable built-in tool override with optional per-mode patches. */
export interface BuiltInToolOverrideConfig extends BuiltInToolOverrideModeConfig {
  launch?: BuiltInToolOverrideModeConfig;
  headless?: BuiltInToolOverrideModeConfig;
}

/** User-configurable built-in tool overrides keyed by tool id. */
export type BuiltInAiToolOverrides = Partial<Record<AiToolId, BuiltInToolOverrideConfig>>;

/** Supported launch modes for built-in tool override resolution. */
export type BuiltInToolLaunchMode = "launch" | "headless";

/** Options passed to launch command builders. */
export interface LaunchOpts {
  /** Workspace name shown in the multiplexer tab title. */
  wsName: string;
  /** Absolute path to the repo root containing canonical ninthwave agents/. */
  projectRoot: string;
  /** Absolute path to the worktree checkout for this worker. */
  worktreePath: string;
  /** Logical agent name to load (e.g. "ninthwave-implementer"). */
  agentName: string;
  /** Absolute path to the .prompt file containing the system prompt. */
  promptFile: string;
  /** Work item ID -- used for unique temp-file names (Copilot). */
  id: string;
  /** Absolute path to ~/.ninthwave/projects/{slug}/ for temp file storage. */
  stateDir: string;
  /** Optional deterministic launch seam that replaces the real provider CLI. */
  launchOverride?: LaunchOverride;
}

/** Result of a launch command builder. */
export interface LaunchCmdResult {
  /** Shell command to execute via the multiplexer. */
  cmd: string;
  /**
   * Initial prompt to send after the workspace launches.
   * An empty string means the prompt is already embedded in cmd -- skip the
   * post-launch send step entirely.
   */
  initialPrompt: string;
}

/** An agent file target: the directory and filename suffix for one tool. */
export interface AgentTarget {
  dir: string;
  suffix: string;
}

/** Maps one agent source file to its targets across all tools. */
export interface AgentFileTargetEntry {
  source: string;
  targets: AgentTarget[];
}

/** One rendered agent artifact for a specific tool target. */
export interface RenderedAgentArtifact {
  filename: string;
  content: string;
}

/** Full profile for a single AI tool. */
export interface AiToolProfile {
  id: AiToolId;
  /** Human-readable display name (e.g., "Claude Code", "OpenCode"). */
  displayName: string;
  /** Binary command name (e.g., "claude", "opencode", "copilot"). */
  command: string;
  /** Short description for onboarding UI. */
  description: string;
  /** Install command to suggest in onboarding UI. */
  installCmd: string;
  /** Agent files target directory for this tool (relative to project root). */
  targetDir: string;
  /** Filename suffix for agent files (e.g. ".md", ".agent.md"). */
  suffix: string;
  /**
   * Filesystem paths (relative to project root) that indicate this tool is
   * configured in the project. ANY matching path triggers detection.
   * Used by detectProjectTools in setup.ts.
   */
  projectIndicators: string[];
  /**
   * Environment variable checks for detecting the running tool session.
   * Each entry: { varName, value? } -- value means the env var must equal
   * that value; no value means the env var must be set (truthy).
   * Used by detectAiTool in run-items.ts.
   */
  envDetection?: Array<{ varName: string; value?: string }>;
  /**
   * Process name(s) to look for when walking the parent process tree.
   * Used by detectAiTool in run-items.ts as a fallback.
   */
  processNames: string[];
  /**
   * Build the multiplexer launch command and initial prompt for this tool.
   * Receives injectable deps so Copilot's temp-file creation is testable.
   */
  buildLaunchCmd: (opts: LaunchOpts, deps: LaunchDeps) => LaunchCmdResult;
  /**
   * Build the headless launch command and initial prompt for this tool.
   * Headless commands must embed the prompt in cmd and return initialPrompt: "".
   */
  buildHeadlessCmd: (opts: LaunchOpts, deps: LaunchDeps) => LaunchCmdResult;
}

/** Standard orchestrator agent source files keyed by logical agent name. */
export const STANDARD_AGENT_SOURCES_BY_NAME: Record<string, string> = {
  "ninthwave-implementer": "implementer.md",
  "ninthwave-reviewer": "reviewer.md",
  "ninthwave-rebaser": "rebaser.md",
  "ninthwave-forward-fixer": "forward-fixer.md",
};

interface ParsedAgentSource {
  name: string;
  description: string;
  developerInstructions: string;
}

function parseFrontmatter(content: string): Record<string, string> {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatterMatch) return {};

  const frontmatter = frontmatterMatch[1] ?? "";
  const fields: Record<string, string> = {};

  for (const line of frontmatter.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);
    if (!match) continue;

    const key = match[1];
    const rawValue = match[2];
    if (!key || rawValue === undefined) continue;
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    fields[key] = value;
  }

  return fields;
}

function parseAgentSource(source: string, sourceContent: string): ParsedAgentSource {
  const frontmatter = parseFrontmatter(sourceContent);
  const baseName = source.replace(/\.md$/, "");
  const developerInstructions = sourceContent.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "").trimStart();

  return {
    name: frontmatter.name ?? `ninthwave-${baseName}`,
    description: frontmatter.description ?? `ninthwave agent: ${baseName}`,
    developerInstructions,
  };
}

/** Build the target filename for one agent source and tool target. */
export function agentTargetFilename(source: string, target: Pick<AgentTarget, "suffix">): string {
  const baseName = source.replace(/\.md$/, "");
  if (target.suffix === ".agent.md") return `ninthwave-${baseName}.agent.md`;
  if (target.suffix === ".toml") return `ninthwave-${baseName}.toml`;
  if (target.suffix === ".yaml") return `ninthwave-${baseName}.yaml`;
  return source;
}

/** Render the generated filename and content for one tool-owned agent artifact. */
export function renderAgentArtifact(
  source: string,
  sourceContent: string,
  target: Pick<AgentTarget, "suffix">,
): RenderedAgentArtifact {
  const filename = agentTargetFilename(source, target);

  if (target.suffix === ".toml") {
    const parsed = parseAgentSource(source, sourceContent);
    const lines = [
      `name = ${JSON.stringify(parsed.name)}`,
      `description = ${JSON.stringify(parsed.description)}`,
      `developer_instructions = ${JSON.stringify(parsed.developerInstructions)}`,
    ];
    return { filename, content: `${lines.join("\n")}\n` };
  }

  if (target.suffix === ".yaml") {
    const parsed = parseAgentSource(source, sourceContent);
    // Kimi loads agents via `--agent-file <path.yaml>`. Each agent extends
    // kimi's built-in `default` so workers inherit the standard tool set,
    // and our persona instructions ride along as system_prompt_args.ROLE_ADDITIONAL
    // (interpolated into the default system prompt's ${ROLE_ADDITIONAL} slot).
    // exclude_tools turns off subagents and plan-mode -- workers run a single
    // agent against a single work item, no nested handoffs.
    const lines = [
      `version: 1`,
      `agent:`,
      `  extend: default`,
      `  name: ${JSON.stringify(parsed.name)}`,
      `  when_to_use: ${JSON.stringify(parsed.description)}`,
      `  system_prompt_args:`,
      `    ROLE_ADDITIONAL: ${JSON.stringify(parsed.developerInstructions)}`,
      `  exclude_tools:`,
      `    - "kimi_cli.tools.agent:Agent"`,
      `    - "kimi_cli.tools.plan.enter:EnterPlanMode"`,
      `    - "kimi_cli.tools.plan:ExitPlanMode"`,
    ];
    return { filename, content: `${lines.join("\n")}\n` };
  }

  return { filename, content: sourceContent };
}

/** Extract the runtime agent identifier from a generated target filename. */
export function runtimeAgentIdFromFilename(filename: string, suffix: string): string {
  return filename.endsWith(suffix) ? filename.slice(0, -suffix.length) : filename;
}

/** Resolve the actual --agent= value for a given tool. */
export function runtimeAgentNameForTool(toolId: AiToolId, agentName: string): string {
  if (toolId !== "copilot") return agentName;

  const source = STANDARD_AGENT_SOURCES_BY_NAME[agentName];
  if (!source) return agentName;

  const copilotProfile = getToolProfile("copilot");
  const filename = agentTargetFilename(source, copilotProfile);
  return runtimeAgentIdFromFilename(filename, copilotProfile.suffix);
}

function buildPromptDataContent(opts: LaunchOpts, deps: LaunchDeps): string {
  const promptContent = deps.readFileSync(opts.promptFile, "utf-8");
  return `${promptContent}\n\nStart implementing this work item now.`;
}

/**
 * Read developer instructions from the seeded agent artifact in the worktree,
 * falling back to the canonical agents/ source in the project root.
 *
 * For .md artifacts: parse frontmatter and return the body.
 * For .toml artifacts: extract the developer_instructions JSON value.
 * Throws if neither source can be read -- never silently drops the persona.
 */
export function readSeededAgentInstructions(
  worktreePath: string,
  toolId: AiToolId,
  agentName: string,
  deps: Pick<LaunchDeps, "readFileSync">,
  projectRoot?: string,
): string {
  const source = STANDARD_AGENT_SOURCES_BY_NAME[agentName];
  if (!source) {
    throw new Error(`Unknown agent "${agentName}" -- no source file mapping`);
  }

  const profile = getToolProfile(toolId);
  const filename = agentTargetFilename(source, profile);
  const artifactPath = join(worktreePath, profile.targetDir, filename);

  // Try seeded artifact in the worktree first.
  let content: string | null = null;
  let usedSuffix: string | null = null;
  try {
    content = deps.readFileSync(artifactPath, "utf-8");
    usedSuffix = profile.suffix;
  } catch {
    // Fall back to canonical agents/<source>.md in the project root.
    if (projectRoot) {
      try {
        content = deps.readFileSync(join(projectRoot, "agents", source), "utf-8");
      } catch { /* will throw below */ }
    }
  }

  if (!content) {
    throw new Error(
      `ninthwave worker for ${profile.displayName} could not load agent instructions at ${artifactPath} ` +
      `-- refusing to launch without a persona. Run "nw init" to regenerate agent artifacts.`,
    );
  }

  if (usedSuffix === ".toml") {
    // Extract developer_instructions = "..." from the rendered TOML.
    const match = content.match(/^developer_instructions\s*=\s*(".*")\s*$/m);
    if (!match?.[1]) {
      throw new Error(`Agent artifact at ${artifactPath} missing developer_instructions field`);
    }
    const instructions = JSON.parse(match[1]) as string;
    return instructions.trim();
  }

  if (usedSuffix === ".yaml") {
    // Extract `ROLE_ADDITIONAL: "<json-encoded>"` from the rendered kimi YAML.
    // We render this field as a JSON-quoted string (JSON is valid YAML), so
    // the same JSON.parse round-trips it back to the original persona body.
    const match = content.match(/^\s*ROLE_ADDITIONAL:\s*(".*")\s*$/m);
    if (!match?.[1]) {
      throw new Error(`Agent artifact at ${artifactPath} missing ROLE_ADDITIONAL field`);
    }
    const instructions = JSON.parse(match[1]) as string;
    return instructions.trim();
  }

  // For .md and .agent.md artifacts: strip frontmatter and return the body.
  return parseAgentSource(source, content).developerInstructions.trim();
}

/**
 * Build prompt content with agent instructions prepended (for tools without
 * native --agent discovery, e.g. Codex).
 */
function buildPromptDataContentWithAgent(opts: LaunchOpts, deps: LaunchDeps, toolId: AiToolId): string {
  const promptData = buildPromptDataContent(opts, deps);
  const agentInstructions = readSeededAgentInstructions(opts.worktreePath, toolId, opts.agentName, deps, opts.projectRoot);
  return `# System Instructions\n\n${agentInstructions}\n\n# Task\n\n${promptData}`;
}

function writePromptDataFile(
  opts: LaunchOpts,
  deps: LaunchDeps,
  promptContent: string = buildPromptDataContent(opts, deps),
): string {
  const ts = Date.now();
  const tmpDir = join(opts.stateDir, "tmp");
  deps.mkdirSync(tmpDir, { recursive: true });
  const promptDataFile = join(tmpDir, `nw-prompt-${opts.id}-${ts}`);
  deps.writeFileSync(promptDataFile, promptContent);
  return promptDataFile;
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

/** Options affecting how overrides are resolved (e.g. rotation state dir). */
export interface OverrideResolveOpts {
  /** Override home dir for rotation-counter persistence (tests only). */
  rotationHome?: string;
  /** Injected fs ops for rotation-counter persistence (tests only). */
  rotationDeps?: RotationDeps;
}

/** Resolve the effective built-in launch override for one tool and mode. */
export function resolveBuiltInLaunchOverride(
  toolId: AiToolId,
  mode: BuiltInToolLaunchMode,
  overrides?: BuiltInAiToolOverrides,
  opts?: OverrideResolveOpts,
): LaunchOverride {
  const profile = getToolProfile(toolId);
  const toolOverride = overrides?.[toolId];
  const modeOverride = toolOverride?.[mode];
  const args = [
    ...(toolOverride?.args ?? []),
    ...(modeOverride?.args ?? []),
  ];
  const rotation = {
    ...(toolOverride?.env_rotation ?? {}),
    ...(modeOverride?.env_rotation ?? {}),
  };
  const rotatedEnv = Object.keys(rotation).length > 0
    ? pickRotatedEnv(toolId, rotation, opts?.rotationHome, opts?.rotationDeps)
    : {};
  const env = {
    ...(toolOverride?.env ?? {}),
    ...(modeOverride?.env ?? {}),
    ...rotatedEnv,
  };

  return {
    command: modeOverride?.command ?? toolOverride?.command ?? profile.command,
    ...(args.length > 0 ? { args } : {}),
    ...(Object.keys(env).length > 0 ? { env } : {}),
  };
}

function hasBuiltInOverrideFields(config?: BuiltInToolOverrideModeConfig): boolean {
  return Boolean(
    config && (
      typeof config.command === "string" ||
      (config.args?.length ?? 0) > 0 ||
      Object.keys(config.env ?? {}).length > 0 ||
      Object.keys(config.env_rotation ?? {}).length > 0
    ),
  );
}

/** True when the override leaves the tool's default command + args intact,
 *  so the default build path can construct the full invocation and any env
 *  vars can be layered on via applyEnvPrefix(). Covers env-only overrides,
 *  env_rotation-only overrides, and no-op cases such as a null rotation pick
 *  with no plain env fallback. */
function preservesDefaultCommand(override: LaunchOverride, toolId: AiToolId): boolean {
  return !override.args && override.command === getToolProfile(toolId).command;
}

/** Resolve a mode-specific built-in launch override only when one is configured. */
export function resolveConfiguredBuiltInLaunchOverride(
  toolId: AiToolId,
  mode: BuiltInToolLaunchMode,
  overrides?: BuiltInAiToolOverrides,
  opts?: OverrideResolveOpts,
): LaunchOverride | undefined {
  const toolOverride = overrides?.[toolId];
  if (!toolOverride) return undefined;
  if (!hasBuiltInOverrideFields(toolOverride) && !hasBuiltInOverrideFields(toolOverride[mode])) {
    return undefined;
  }
  return resolveBuiltInLaunchOverride(toolId, mode, overrides, opts);
}

/** Shallow-merge two built-in override maps; `overlay` wins per key. */
export function mergeToolOverrides(
  base?: BuiltInAiToolOverrides,
  overlay?: BuiltInAiToolOverrides,
): BuiltInAiToolOverrides | undefined {
  if (!base) return overlay;
  if (!overlay) return base;
  const result: BuiltInAiToolOverrides = { ...base };
  for (const [toolId, overlayTool] of Object.entries(overlay)) {
    if (!isAiToolId(toolId) || !overlayTool) continue;
    const baseTool = result[toolId];
    result[toolId] = mergeBuiltInToolOverrideConfig(baseTool, overlayTool);
  }
  return result;
}

function mergeBuiltInToolOverrideConfig(
  base: BuiltInToolOverrideConfig | undefined,
  overlay: BuiltInToolOverrideConfig,
): BuiltInToolOverrideConfig {
  if (!base) return overlay;
  const result: BuiltInToolOverrideConfig = {
    ...mergeBuiltInToolOverrideModeConfig(base, overlay),
  };
  const launch = mergeMaybeMode(base.launch, overlay.launch);
  if (launch) result.launch = launch;
  const headless = mergeMaybeMode(base.headless, overlay.headless);
  if (headless) result.headless = headless;
  return result;
}

function mergeMaybeMode(
  base: BuiltInToolOverrideModeConfig | undefined,
  overlay: BuiltInToolOverrideModeConfig | undefined,
): BuiltInToolOverrideModeConfig | undefined {
  if (!base) return overlay;
  if (!overlay) return base;
  return mergeBuiltInToolOverrideModeConfig(base, overlay);
}

function mergeBuiltInToolOverrideModeConfig(
  base: BuiltInToolOverrideModeConfig,
  overlay: BuiltInToolOverrideModeConfig,
): BuiltInToolOverrideModeConfig {
  const result: BuiltInToolOverrideModeConfig = {};
  if (overlay.command !== undefined) result.command = overlay.command;
  else if (base.command !== undefined) result.command = base.command;
  const args = overlay.args ?? base.args;
  if (args && args.length > 0) result.args = args;
  const env = { ...(base.env ?? {}), ...(overlay.env ?? {}) };
  if (Object.keys(env).length > 0) result.env = env;
  const rotation = { ...(base.env_rotation ?? {}), ...(overlay.env_rotation ?? {}) };
  if (Object.keys(rotation).length > 0) result.env_rotation = rotation;
  return result;
}

function buildLaunchOverrideCmd(
  toolId: AiToolId,
  mode: "launch" | "headless",
  opts: LaunchOpts,
): string | null {
  const override = opts.launchOverride;
  if (!override) return null;

  // Overrides that leave the default command + args intact fall through to
  // the tool's own build path; applyEnvPrefix() layers env vars (if any)
  // afterwards. This preserves the default flags (e.g. claude --name /
  // --agent / --append-system-prompt). Covers env-only overrides,
  // env_rotation, and no-op rotation picks (all nulls resolved).
  if (preservesDefaultCommand(override, toolId)) {
    return null;
  }

  const env = {
    ...(override.env ?? {}),
    NINTHWAVE_LAUNCH_TOOL: toolId,
    NINTHWAVE_LAUNCH_MODE: mode,
    NINTHWAVE_LAUNCH_AGENT: opts.agentName,
    NINTHWAVE_LAUNCH_PROMPT_FILE: opts.promptFile,
    NINTHWAVE_LAUNCH_STATE_DIR: opts.stateDir,
    NINTHWAVE_LAUNCH_ITEM_ID: opts.id,
    NINTHWAVE_LAUNCH_PROJECT_ROOT: opts.projectRoot,
    NINTHWAVE_LAUNCH_WORKSPACE_NAME: opts.wsName,
  };
  const envPrefix = Object.entries(env)
    .map(([key, value]) => `${key}=${shQuote(value)}`)
    .join(" ");
  const args = (override.args ?? []).map(shQuote).join(" ");

  return `${envPrefix} exec ${shQuote(override.command)}${args ? ` ${args}` : ""}`;
}

/** Prepend env override values to a built-in launch command. */
function applyEnvPrefix(cmd: string, opts: LaunchOpts, toolId: AiToolId): string {
  const override = opts.launchOverride;
  if (!override || !preservesDefaultCommand(override, toolId)) return cmd;

  const env = override.env ?? {};
  const entries = Object.entries(env);
  if (entries.length === 0) return cmd;
  // Use `export ... && <cmd>` rather than a `VAR=val cmd` prefix because
  // some built-in commands (opencode, codex, copilot) start with shell
  // assignments like `PROMPT=$(cat '...') && ...`; a simple var-prefix would
  // parse those as additional shell-local assignments and never export to
  // the final tool. `export` is universally safe.
  const exports = entries
    .map(([key, value]) => `${key}=${shQuote(value)}`)
    .join(" ");
  return `export ${exports} && ${cmd}`;
}

// ── Non-Claude idle contract ──────────────────────────────────────────────────
//
// Appended to the launch prompt for non-Claude tools (OpenCode, Codex, Kimi, Copilot)
// to reinforce the requirement to stay alive after implementation and PR creation.
// Claude handles this via its native agent session model and does not need it.

export const NON_CLAUDE_IDLE_CONTRACT = `

# CRITICAL: Do Not Exit After Implementation

Your session does NOT end when you finish implementing and creating the PR.
You MUST remain alive to handle orchestrator follow-up messages (CI fixes,
review feedback, rebase requests).

## Mandatory Post-PR Behavior

1. After creating the PR, immediately run: \`nw inbox --check YOUR_WORK_ITEM_ID\`
2. Process any messages returned, then run: \`nw inbox --wait YOUR_WORK_ITEM_ID\`
3. If \`nw inbox --wait\` exits, times out, or is cancelled WITHOUT printing a
   real message, immediately re-run it. Silence is NOT permission to stop.
4. Continue this drain-wait loop indefinitely until the orchestrator sends a
   stop message.
5. During active work (before tests, before commits), check for messages with:
   \`nw inbox --check YOUR_WORK_ITEM_ID\`

## What NOT To Do

- Do NOT exit or end your session after creating the PR
- Do NOT treat silence from \`nw inbox --wait\` as completion
- Do NOT summarize your work and stop
- Do NOT return to conversational mode after the PR is created
- Do NOT interpret a timeout or empty wait result as "done"

Your session lifecycle is controlled by the orchestrator. Stay alive until
explicitly told to stop.
`;

/**
 * Resolve the relative path passed to `kimi --agent-file`. Workers cd into the
 * worktree before launch, so a path relative to the worktree root is safe.
 */
function kimiAgentFilePath(agentName: string): string {
  const source = STANDARD_AGENT_SOURCES_BY_NAME[agentName];
  const profile = getKimiProfile();
  if (!source) {
    return `${profile.targetDir}/${agentName}.yaml`;
  }
  const filename = agentTargetFilename(source, profile);
  return `${profile.targetDir}/${filename}`;
}

/**
 * Lookup-by-suffix instead of by id to avoid a chicken-and-egg with the
 * AI_TOOL_PROFILES initializer. Always returns a kimi-shaped target descriptor.
 */
function getKimiProfile(): { targetDir: string; suffix: string } {
  return { targetDir: ".kimi/agents", suffix: ".yaml" };
}

// ── Profiles ──────────────────────────────────────────────────────────────────

/** The canonical list of AI tool profiles -- one entry per supported tool. */
export const AI_TOOL_PROFILES: AiToolProfile[] = [
  {
    id: "claude",
    displayName: "Claude Code",
    command: "claude",
    description: "Anthropic's AI coding assistant",
    installCmd: "curl -fsSL https://claude.ai/install.sh | bash",
    targetDir: ".claude/agents",
    suffix: ".md",
    projectIndicators: [".claude"],
    envDetection: [
      { varName: "CLAUDE_CODE_SESSION" },
      { varName: "CLAUDE_SESSION_ID" },
    ],
    processNames: ["claude"],
    buildLaunchCmd(opts, _deps): LaunchCmdResult {
      const overrideCmd = buildLaunchOverrideCmd("claude", "launch", opts);
      if (overrideCmd) return { cmd: overrideCmd, initialPrompt: "" };

      // Prompt is embedded as a positional arg via --append-system-prompt; no post-launch send.
      const cmd =
        `claude --name '${opts.wsName}' --permission-mode bypassPermissions` +
        ` --agent ${opts.agentName}` +
        ` --append-system-prompt "$(cat '.ninthwave/.prompt')" -- Start`;
      return { cmd: applyEnvPrefix(cmd, opts, "claude"), initialPrompt: "" };
    },
    buildHeadlessCmd(opts, _deps): LaunchCmdResult {
      const overrideCmd = buildLaunchOverrideCmd("claude", "headless", opts);
      if (overrideCmd) return { cmd: overrideCmd, initialPrompt: "" };

      const cmd =
        `claude --print --permission-mode bypassPermissions` +
        ` --agent ${opts.agentName}` +
        ` --append-system-prompt "$(cat '.ninthwave/.prompt')"` +
        ` "Start"`;
      return { cmd: applyEnvPrefix(cmd, opts, "claude"), initialPrompt: "" };
    },
  },
  {
    id: "opencode",
    displayName: "OpenCode",
    command: "opencode",
    description: "Open-source AI coding tool",
    installCmd: "curl -fsSL https://opencode.ai/install | bash",
    targetDir: ".opencode/agents",
    suffix: ".md",
    projectIndicators: [".opencode", ".opencode.json"],
    envDetection: [{ varName: "OPENCODE", value: "1" }],
    processNames: ["opencode"],
    buildLaunchCmd(opts, deps): LaunchCmdResult {
      const overrideCmd = buildLaunchOverrideCmd("opencode", "launch", opts);
      if (overrideCmd) return { cmd: overrideCmd, initialPrompt: "" };

      // Inline command pattern: write prompt to a plain-text data file, then
      // construct a shell command that reads it, cleans up, and execs the tool.
      // Avoids creating executable .sh scripts (which trigger EDR alerts).
      //
      // Per-agent auto-approval is set up by `nw init` via
      // .opencode/opencode.jsonc (see core/opencode-config.ts); no launch-time
      // env var is needed.
      const promptContent = buildPromptDataContent(opts, deps) + NON_CLAUDE_IDLE_CONTRACT;
      const promptDataFile = writePromptDataFile(opts, deps, promptContent);
      const cmd =
        `PROMPT=$(cat '${promptDataFile}')` +
        ` && rm -f '${promptDataFile}'` +
        ` && exec opencode --agent ${opts.agentName} --prompt "$PROMPT"`;
      return { cmd: applyEnvPrefix(cmd, opts, "opencode"), initialPrompt: "" };
    },
    buildHeadlessCmd(opts, deps): LaunchCmdResult {
      const overrideCmd = buildLaunchOverrideCmd("opencode", "headless", opts);
      if (overrideCmd) return { cmd: overrideCmd, initialPrompt: "" };

      const promptContent = buildPromptDataContent(opts, deps) + NON_CLAUDE_IDLE_CONTRACT;
      const promptDataFile = writePromptDataFile(opts, deps, promptContent);
      const cmd =
        `PROMPT=$(cat '${promptDataFile}')` +
        ` && rm -f '${promptDataFile}'` +
        ` && exec opencode run "$PROMPT" --agent ${opts.agentName}`;
      return { cmd: applyEnvPrefix(cmd, opts, "opencode"), initialPrompt: "" };
    },
  },
  {
    id: "codex",
    displayName: "Codex CLI",
    command: "codex",
    description: "OpenAI's coding agent",
    installCmd: "npm install -g @openai/codex",
    targetDir: ".codex/agents",
    suffix: ".toml",
    projectIndicators: [".codex/agents"],
    processNames: ["codex"],
    buildLaunchCmd(opts, deps): LaunchCmdResult {
      const overrideCmd = buildLaunchOverrideCmd("codex", "launch", opts);
      if (overrideCmd) return { cmd: overrideCmd, initialPrompt: "" };

      const promptContent = buildPromptDataContentWithAgent(opts, deps, "codex") + NON_CLAUDE_IDLE_CONTRACT;
      const promptDataFile = writePromptDataFile(opts, deps, promptContent);
      const cmd =
        `PROMPT=$(cat '${promptDataFile}')` +
        ` && rm -f '${promptDataFile}'` +
        ` && exec codex --dangerously-bypass-approvals-and-sandbox "$PROMPT"`;
      return { cmd: applyEnvPrefix(cmd, opts, "codex"), initialPrompt: "" };
    },
    buildHeadlessCmd(opts, deps): LaunchCmdResult {
      const overrideCmd = buildLaunchOverrideCmd("codex", "headless", opts);
      if (overrideCmd) return { cmd: overrideCmd, initialPrompt: "" };

      const promptContent = buildPromptDataContentWithAgent(opts, deps, "codex") + NON_CLAUDE_IDLE_CONTRACT;
      const promptDataFile = writePromptDataFile(opts, deps, promptContent);
      const cmd =
        `PROMPT=$(cat '${promptDataFile}')` +
        ` && rm -f '${promptDataFile}'` +
        ` && exec codex exec --dangerously-bypass-approvals-and-sandbox "$PROMPT"`;
      return { cmd: applyEnvPrefix(cmd, opts, "codex"), initialPrompt: "" };
    },
  },
  {
    id: "kimi",
    displayName: "Kimi Code CLI",
    command: "kimi",
    description: "Moonshot AI's coding agent",
    installCmd: "uv tool install kimi-cli",
    targetDir: ".kimi/agents",
    suffix: ".yaml",
    projectIndicators: [".kimi", ".kimi/AGENTS.md"],
    processNames: ["kimi"],
    buildLaunchCmd(opts, deps): LaunchCmdResult {
      const overrideCmd = buildLaunchOverrideCmd("kimi", "launch", opts);
      if (overrideCmd) return { cmd: overrideCmd, initialPrompt: "" };

      const promptContent = buildPromptDataContent(opts, deps) + NON_CLAUDE_IDLE_CONTRACT;
      const promptDataFile = writePromptDataFile(opts, deps, promptContent);
      const agentFilePath = kimiAgentFilePath(opts.agentName);
      // --afk auto-approves all tool calls AND auto-dismisses AskUserQuestion;
      // -p prefills the user prompt without forcing print mode (the shell UI
      // still launches so the worker can keep handling orchestrator messages).
      const cmd =
        `PROMPT=$(cat '${promptDataFile}')` +
        ` && rm -f '${promptDataFile}'` +
        ` && exec kimi --work-dir '${opts.worktreePath}' --afk` +
        ` --agent-file '${agentFilePath}' -p "$PROMPT"`;
      return { cmd: applyEnvPrefix(cmd, opts, "kimi"), initialPrompt: "" };
    },
    buildHeadlessCmd(opts, deps): LaunchCmdResult {
      const overrideCmd = buildLaunchOverrideCmd("kimi", "headless", opts);
      if (overrideCmd) return { cmd: overrideCmd, initialPrompt: "" };

      const promptContent = buildPromptDataContent(opts, deps) + NON_CLAUDE_IDLE_CONTRACT;
      const promptDataFile = writePromptDataFile(opts, deps, promptContent);
      const agentFilePath = kimiAgentFilePath(opts.agentName);
      // --quiet implies --print + text + final-message-only and auto-enables --afk.
      const cmd =
        `PROMPT=$(cat '${promptDataFile}')` +
        ` && rm -f '${promptDataFile}'` +
        ` && exec kimi --quiet --work-dir '${opts.worktreePath}'` +
        ` --agent-file '${agentFilePath}' -p "$PROMPT"`;
      return { cmd: applyEnvPrefix(cmd, opts, "kimi"), initialPrompt: "" };
    },
  },
  {
    id: "copilot",
    displayName: "GitHub Copilot",
    command: "copilot",
    description: "GitHub's AI pair programmer",
    installCmd: "npm install -g @github/copilot",
    targetDir: ".github/agents",
    suffix: ".agent.md",
    projectIndicators: [".github/copilot-instructions.md", ".github/agents"],
    processNames: ["copilot"],
    buildLaunchCmd(opts, deps): LaunchCmdResult {
      const overrideCmd = buildLaunchOverrideCmd("copilot", "launch", opts);
      if (overrideCmd) return { cmd: overrideCmd, initialPrompt: "" };

      // Inline command pattern: write prompt to a plain-text data file, then
      // construct a shell command that reads it, cleans up, and execs the tool.
      // Avoids creating executable .sh scripts (which trigger EDR alerts).
      const promptContent = buildPromptDataContent(opts, deps) + NON_CLAUDE_IDLE_CONTRACT;
      const promptDataFile = writePromptDataFile(opts, deps, promptContent);
      const runtimeAgentName = runtimeAgentNameForTool("copilot", opts.agentName);
      const cmd =
        `PROMPT=$(cat '${promptDataFile}')` +
        ` && rm -f '${promptDataFile}'` +
        ` && exec copilot --agent=${runtimeAgentName} --allow-all -i "$PROMPT"`;
      return { cmd: applyEnvPrefix(cmd, opts, "copilot"), initialPrompt: "" };
    },
    buildHeadlessCmd(opts, deps): LaunchCmdResult {
      const overrideCmd = buildLaunchOverrideCmd("copilot", "headless", opts);
      if (overrideCmd) return { cmd: overrideCmd, initialPrompt: "" };

      const promptContent = buildPromptDataContent(opts, deps) + NON_CLAUDE_IDLE_CONTRACT;
      const promptDataFile = writePromptDataFile(opts, deps, promptContent);
      const runtimeAgentName = runtimeAgentNameForTool("copilot", opts.agentName);
      const cmd =
        `PROMPT=$(cat '${promptDataFile}')` +
        ` && rm -f '${promptDataFile}'` +
        ` && exec copilot -p "$PROMPT" --agent=${runtimeAgentName}` +
        ` --allow-all-tools --allow-all-paths --allow-all-urls --no-ask-user`;
      return { cmd: applyEnvPrefix(cmd, opts, "copilot"), initialPrompt: "" };
    },
  },
];

// ── Lookup helpers ────────────────────────────────────────────────────────────

/**
 * Look up a tool profile by ID.
 * Throws if the ID is not registered.
 */
export function getToolProfile(id: string): AiToolProfile {
  const profile = AI_TOOL_PROFILES.find((p) => p.id === id);
  if (!profile) throw new Error(`Unknown AI tool: ${id}. Supported tools: ${allToolIds().join(", ")}`);
  return profile;
}

/** Return all registered tool IDs in profile order. */
export function allToolIds(): AiToolId[] {
  return AI_TOOL_PROFILES.map((p) => p.id);
}

/** Type guard: returns true if s is a valid AiToolId. */
export function isAiToolId(s: string): s is AiToolId {
  return AI_TOOL_PROFILES.some((p) => p.id === s);
}

/**
 * Check whether a tool has all standard agent files seeded in a project.
 * Returns true only if every agent artifact (implementer, reviewer, rebaser,
 * forward-fixer) exists, since a partial install will crash at launch time.
 */
export function hasAgentFiles(toolId: AiToolId, projectRoot: string): boolean {
  const profile = getToolProfile(toolId);
  for (const source of Object.values(STANDARD_AGENT_SOURCES_BY_NAME)) {
    const filename = agentTargetFilename(source, profile);
    if (!existsSync(join(projectRoot, profile.targetDir, filename))) return false;
  }
  return true;
}

/**
 * Return the agent file target dirs for all tools, in profile order.
 * Equivalent to the static targets array in agent-files.ts AGENT_FILES entries.
 */
export function agentTargetDirs(): AgentTarget[] {
  return AI_TOOL_PROFILES.map((p) => ({ dir: p.targetDir, suffix: p.suffix }));
}

/**
 * Given a list of agent source filenames, return the full target mapping for all tools.
 * This is the canonical replacement for the hardcoded AGENT_FILES array in agent-files.ts.
 *
 * Example:
 *   agentFileTargets(["implementer.md"])
 *   // → [{ source: "implementer.md", targets: [{ dir: ".claude/agents", suffix: ".md" }, ...] }]
 */
export function agentFileTargets(sources: string[]): AgentFileTargetEntry[] {
  const targets = agentTargetDirs();
  return sources.map((source) => ({ source, targets }));
}

// ── Default deps (re-exported for callers that want real fs/process) ──────────

export const defaultLaunchDeps: LaunchDeps = {
  readFileSync: (path, enc) => defaultReadFileSync(path, enc),
  writeFileSync: defaultWriteFileSync,
  mkdirSync: defaultMkdirSync,
  run: (cmd, args) => defaultRun(cmd, args),
};
