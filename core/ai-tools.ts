// AI tool profiles: single source of truth for Claude Code, OpenCode, Codex, and Copilot.
//
// Defines AiToolId, AiToolProfile, LaunchDeps, LaunchOpts, and AI_TOOL_PROFILES.
// All other modules should derive tool-specific behaviour from this module rather
// than maintaining their own per-tool switch statements.

import { existsSync, mkdirSync as defaultMkdirSync, readFileSync as defaultReadFileSync, writeFileSync as defaultWriteFileSync } from "fs";
import { join } from "path";
import { run as defaultRun } from "./shell.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Supported AI tool identifiers. */
export type AiToolId = "claude" | "opencode" | "codex" | "copilot";

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
  model: string | null;
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
    model: frontmatter.model ?? null,
    developerInstructions,
  };
}

/** Build the target filename for one agent source and tool target. */
export function agentTargetFilename(source: string, target: Pick<AgentTarget, "suffix">): string {
  const baseName = source.replace(/\.md$/, "");
  if (target.suffix === ".agent.md") return `ninthwave-${baseName}.agent.md`;
  if (target.suffix === ".toml") return `ninthwave-${baseName}.toml`;
  return source;
}

/** Render the generated filename and content for one tool-owned agent artifact. */
export function renderAgentArtifact(
  source: string,
  sourceContent: string,
  target: Pick<AgentTarget, "suffix">,
): RenderedAgentArtifact {
  const filename = agentTargetFilename(source, target);
  if (target.suffix !== ".toml") {
    return { filename, content: sourceContent };
  }

  const parsed = parseAgentSource(source, sourceContent);
  const lines = [
    `name = ${JSON.stringify(parsed.name)}`,
    `description = ${JSON.stringify(parsed.description)}`,
  ];

  if (parsed.model) lines.push(`model = ${JSON.stringify(parsed.model)}`);
  lines.push(`developer_instructions = ${JSON.stringify(parsed.developerInstructions)}`);

  return { filename, content: `${lines.join("\n")}\n` };
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
  let usedToml = false;
  try {
    content = deps.readFileSync(artifactPath, "utf-8");
    usedToml = profile.suffix === ".toml";
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

  if (usedToml) {
    // Extract developer_instructions = "..." from the rendered TOML.
    const match = content.match(/^developer_instructions\s*=\s*(".*")\s*$/m);
    if (!match?.[1]) {
      throw new Error(`Agent artifact at ${artifactPath} missing developer_instructions field`);
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

/** Resolve the effective built-in launch override for one tool and mode. */
export function resolveBuiltInLaunchOverride(
  toolId: AiToolId,
  mode: BuiltInToolLaunchMode,
  overrides?: BuiltInAiToolOverrides,
): LaunchOverride {
  const profile = getToolProfile(toolId);
  const toolOverride = overrides?.[toolId];
  const modeOverride = toolOverride?.[mode];
  const args = [
    ...(toolOverride?.args ?? []),
    ...(modeOverride?.args ?? []),
  ];
  const env = {
    ...(toolOverride?.env ?? {}),
    ...(modeOverride?.env ?? {}),
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
      Object.keys(config.env ?? {}).length > 0
    ),
  );
}

/** Resolve a mode-specific built-in launch override only when one is configured. */
export function resolveConfiguredBuiltInLaunchOverride(
  toolId: AiToolId,
  mode: BuiltInToolLaunchMode,
  overrides?: BuiltInAiToolOverrides,
): LaunchOverride | undefined {
  const toolOverride = overrides?.[toolId];
  if (!toolOverride) return undefined;
  if (!hasBuiltInOverrideFields(toolOverride) && !hasBuiltInOverrideFields(toolOverride[mode])) {
    return undefined;
  }
  return resolveBuiltInLaunchOverride(toolId, mode, overrides);
}

function buildLaunchOverrideCmd(
  toolId: AiToolId,
  mode: "launch" | "headless",
  opts: LaunchOpts,
): string | null {
  const override = opts.launchOverride;
  if (!override) return null;

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

// ── Non-Claude idle contract ──────────────────────────────────────────────────
//
// Appended to the launch prompt for non-Claude tools (OpenCode, Codex, Copilot)
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
      return { cmd, initialPrompt: "" };
    },
    buildHeadlessCmd(opts, _deps): LaunchCmdResult {
      const overrideCmd = buildLaunchOverrideCmd("claude", "headless", opts);
      if (overrideCmd) return { cmd: overrideCmd, initialPrompt: "" };

      const cmd =
        `claude --print --permission-mode bypassPermissions` +
        ` --agent ${opts.agentName}` +
        ` --append-system-prompt "$(cat '.ninthwave/.prompt')"` +
        ` "Start"`;
      return { cmd, initialPrompt: "" };
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
      return { cmd, initialPrompt: "" };
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
      return { cmd, initialPrompt: "" };
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
      return { cmd, initialPrompt: "" };
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
      return { cmd, initialPrompt: "" };
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
      return { cmd, initialPrompt: "" };
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
      return { cmd, initialPrompt: "" };
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
