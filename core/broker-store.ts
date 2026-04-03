// Shared crew broker state and persistence interfaces.

import type { ServerWebSocket } from "bun";

export type BrokerSocket = ServerWebSocket<unknown> | Pick<WebSocket, "send">;

export interface ScheduleClaimEntry {
  daemonId: string;
  expiresAt: number;
}

export interface WorkEntry {
  path: string;
  priority: number;
  dependencies: string[];
  author: string;
  syncedAt: number;
  creatorDaemonId: string;
  claimedBy: string | null;
  completedBy: string | null;
}

export interface DaemonState {
  id: string;
  name: string;
  /** Operator identity (git email of the human running this daemon). */
  operatorId: string;
  ws: BrokerSocket | null;
  lastHeartbeat: number;
  disconnectedAt: number | null;
  claimedItems: Set<string>;
  /** True after grace period expired and work items were released. Prevents double-release. */
  released: boolean;
}

export interface CrewState {
  code: string;
  items: Map<string, WorkEntry>;
  daemons: Map<string, DaemonState>;
  /** Schedule claim deduplication: key = "taskId:scheduleTime" -> claim entry. */
  scheduleClaims: Map<string, ScheduleClaimEntry>;
}

export interface BrokerStore {
  hasCrew(code: string): boolean;
  getCrew(code: string): CrewState | undefined;
  createCrew(code: string): CrewState;
  listCrews(): Iterable<CrewState>;
}

export function createCrewState(code: string): CrewState {
  return {
    code,
    items: new Map(),
    daemons: new Map(),
    scheduleClaims: new Map(),
  };
}

export class InMemoryBrokerStore implements BrokerStore {
  private crews = new Map<string, CrewState>();

  hasCrew(code: string): boolean {
    return this.crews.has(code);
  }

  getCrew(code: string): CrewState | undefined {
    return this.crews.get(code);
  }

  createCrew(code: string): CrewState {
    const existing = this.crews.get(code);
    if (existing) return existing;

    const crew = createCrewState(code);
    this.crews.set(code, crew);
    return crew;
  }

  listCrews(): Iterable<CrewState> {
    return this.crews.values();
  }
}
