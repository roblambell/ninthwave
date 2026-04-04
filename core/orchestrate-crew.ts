// Crew/collaboration session lifecycle: URL resolution, session creation, broker management.
// Manages transitions between local, shared, and joined collaboration modes.

import { hostname } from "os";
import type { LogEntry } from "./types.ts";
import type {
  CrewBroker,
  CrewRemoteItemSnapshot,
  CrewStatus,
  ConnectionAction,
} from "./crew.ts";
import { WebSocketCrewBroker, saveCrewCode } from "./crew.ts";
import { resolveRepoRef } from "./repo-ref.ts";
import type {
  RuntimeCollaborationActionRequest,
  RuntimeCollaborationActionResult,
} from "./watch-engine-runner.ts";

// ── Constants ───────────────────────────────────────────────────────

export const DEFAULT_CREW_URL = "wss://ninthwave.sh";

// ── Types ───────────────────────────────────────────────────────────

export interface CollaborationSessionState {
  mode: "local" | "shared" | "joined";
  crewCode?: string;
  crewUrl?: string;
  crewBroker?: CrewBroker;
  connectMode: boolean;
}

export interface CollaborationSessionBrokerInfo {
  mode: CollaborationSessionState["mode"];
  crewCode?: string;
}

export interface ApplyRuntimeCollaborationActionDeps {
  projectRoot: string;
  crewRepoUrl: string;
  crewName?: string;
  log: (entry: LogEntry) => void;
  fetchFn?: typeof fetch;
  saveCrewCodeFn?: typeof saveCrewCode;
  createBroker?: (
    projectRoot: string,
    crewUrl: string,
    crewCode: string,
    crewRepoUrl: string,
    deps: ConstructorParameters<typeof WebSocketCrewBroker>[4],
    crewName?: string,
  ) => CrewBroker;
  onBrokerChanged?: (broker: CrewBroker | undefined, info: CollaborationSessionBrokerInfo) => void;
}

// ── Functions ───────────────────────────────────────────────────────

export function resolveConfiguredCrewUrl(
  crewUrl?: string,
  projectCrewUrl?: string,
): string | undefined {
  return crewUrl ?? projectCrewUrl;
}

export function resolveStartupCollaborationAction(
  current: {
    connectMode: boolean;
    crewCode?: string;
    crewUrl?: string;
  },
  connectionAction: ConnectionAction | null | undefined,
): {
  connectMode: boolean;
  crewCode?: string;
  crewUrl?: string;
} {
  if (!connectionAction) return current;
  if (connectionAction.type === "connect") {
    return {
      connectMode: true,
      crewCode: undefined,
      crewUrl: current.crewUrl,
    };
  }
  return {
    connectMode: false,
    crewCode: connectionAction.code,
    crewUrl: current.crewUrl ?? DEFAULT_CREW_URL,
  };
}

export function resolveCrewSocketUrl(crewUrl?: string): string {
  return crewUrl ?? DEFAULT_CREW_URL;
}

export function resolveCrewHttpUrl(crewUrl?: string): string {
  return resolveCrewSocketUrl(crewUrl).replace(/^wss?:\/\//, "https://");
}

export function buildCrewRepoReferencePayload(crewRepoUrl: string): Record<string, string> {
  const trimmedRepoUrl = crewRepoUrl.trim();
  if (!trimmedRepoUrl) return {};

  try {
    const resolved = resolveRepoRef({ repoUrl: trimmedRepoUrl });
    return {
      repoUrl: trimmedRepoUrl,
      repoHash: resolved.repoHash,
      repoRef: resolved.repoRef,
    };
  } catch {
    return { repoUrl: trimmedRepoUrl };
  }
}

export async function createCrewCode(
  crewUrl: string | undefined,
  crewRepoUrl: string,
  fetchFn: typeof fetch,
): Promise<string> {
  const response = await fetchFn(`${resolveCrewHttpUrl(crewUrl)}/api/crews`, {
    method: "POST",
    body: JSON.stringify(buildCrewRepoReferencePayload(crewRepoUrl)),
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to create session: ${response.status}${body ? ` ${body}` : ""}`);
  }

  const payload = await response.json() as { code?: string };
  if (!payload.code) {
    throw new Error("Failed to create session: missing crew code");
  }
  return payload.code;
}

export function createCrewBrokerInstance(
  projectRoot: string,
  crewUrl: string,
  crewCode: string,
  crewRepoUrl: string,
  log: (entry: LogEntry) => void,
  crewName?: string,
  createBroker?: ApplyRuntimeCollaborationActionDeps["createBroker"],
): CrewBroker {
  const resolvedName = crewName ?? hostname();
  if (createBroker) {
    return createBroker(
      projectRoot,
      crewUrl,
      crewCode,
      crewRepoUrl,
      { log: (level, msg) => log({ ts: new Date().toISOString(), level, event: "crew_client", message: msg }) },
      resolvedName,
    );
  }
  return new WebSocketCrewBroker(
    projectRoot,
    crewUrl,
    crewCode,
    crewRepoUrl,
    { log: (level, msg) => log({ ts: new Date().toISOString(), level, event: "crew_client", message: msg }) },
    resolvedName,
  );
}

export async function applyRuntimeCollaborationAction(
  state: CollaborationSessionState,
  request: RuntimeCollaborationActionRequest,
  deps: ApplyRuntimeCollaborationActionDeps,
): Promise<RuntimeCollaborationActionResult> {
  const fetchFn = deps.fetchFn ?? fetch;
  const saveCrewCodeFn = deps.saveCrewCodeFn ?? saveCrewCode;

  if (request.action === "local") {
    state.crewBroker?.disconnect();
    state.crewBroker = undefined;
    state.crewCode = undefined;
    state.connectMode = false;
    state.mode = "local";
    deps.onBrokerChanged?.(undefined, { mode: "local" });
    deps.log({ ts: new Date().toISOString(), level: "info", event: "runtime_local_selected" });
    return { mode: "local" };
  }

  if (request.action === "share"
    && state.mode === "shared"
    && state.crewCode
    && state.crewBroker?.isConnected()) {
    deps.log({ ts: new Date().toISOString(), level: "info", event: "runtime_share_reused", crewCode: state.crewCode });
    return { mode: "shared", code: state.crewCode };
  }

  const nextCrewUrl = resolveCrewSocketUrl(state.crewUrl);
  let nextCrewCode: string;
  try {
    nextCrewCode = request.action === "share"
      ? await createCrewCode(state.crewUrl, deps.crewRepoUrl, fetchFn)
      : (request.code ?? "").trim().toUpperCase();
  } catch (error) {
    deps.log({
      ts: new Date().toISOString(),
      level: "warn",
      event: request.action === "share" ? "runtime_share_failed" : "runtime_join_failed",
      error: error instanceof Error ? error.message : String(error),
    });
    return { error: error instanceof Error ? error.message : String(error) };
  }

  if (!nextCrewCode) {
    return { error: "Enter a session code to join." };
  }

  if (request.action === "share") {
    deps.log({ ts: new Date().toISOString(), level: "info", event: "runtime_share_created", crewCode: nextCrewCode });
  }

  const nextMode = request.action === "share" ? "shared" : "joined";
  const nextBroker = createCrewBrokerInstance(
    deps.projectRoot,
    nextCrewUrl,
    nextCrewCode,
    deps.crewRepoUrl,
    deps.log,
    deps.crewName,
    deps.createBroker,
  );

  try {
    await nextBroker.connect();
  } catch (error) {
    try {
      nextBroker.disconnect();
    } catch {
      // best effort -- failed startup brokers should not leak reconnect timers
    }
    deps.log({
      ts: new Date().toISOString(),
      level: "warn",
      event: request.action === "share" ? "runtime_share_connect_failed" : "runtime_join_failed",
      crewCode: nextCrewCode,
      error: error instanceof Error ? error.message : String(error),
    });
    return { error: error instanceof Error ? error.message : String(error) };
  }

  state.crewBroker?.disconnect();
  state.crewBroker = nextBroker;
  state.crewCode = nextCrewCode;
  state.crewUrl = nextCrewUrl;
  state.connectMode = request.action === "share";
  state.mode = nextMode;
  deps.onBrokerChanged?.(nextBroker, { mode: nextMode, crewCode: nextCrewCode });
  saveCrewCodeFn(deps.projectRoot, nextCrewCode);
  deps.log({ ts: new Date().toISOString(), level: "info", event: "runtime_crew_connected", crewCode: nextCrewCode, mode: nextMode });
  return { mode: nextMode, code: nextCrewCode };
}
