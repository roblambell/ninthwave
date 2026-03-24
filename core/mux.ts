// Multiplexer interface: abstracts terminal multiplexer operations.
// Decouples command modules from the concrete cmux implementation.

import * as cmux from "./cmux.ts";

/** Terminal multiplexer abstraction for workspace management. */
export interface Multiplexer {
  /** Check if the multiplexer backend is available. */
  isAvailable(): boolean;
  /** Launch a new workspace. Returns a ref (e.g., "workspace:1") or null on failure. */
  launchWorkspace(cwd: string, command: string): string | null;
  /** Send a message to a workspace. Returns true on success. */
  sendMessage(ref: string, message: string): boolean;
  /** List all workspaces. Returns raw output string. */
  listWorkspaces(): string;
  /** Close a workspace. Returns true on success. */
  closeWorkspace(ref: string): boolean;
}

/** Adapter that delegates to the cmux CLI binary. */
export class CmuxAdapter implements Multiplexer {
  isAvailable(): boolean {
    return cmux.isAvailable();
  }
  launchWorkspace(cwd: string, command: string): string | null {
    return cmux.launchWorkspace(cwd, command);
  }
  sendMessage(ref: string, message: string): boolean {
    return cmux.sendMessage(ref, message);
  }
  listWorkspaces(): string {
    return cmux.listWorkspaces();
  }
  closeWorkspace(ref: string): boolean {
    return cmux.closeWorkspace(ref);
  }
}

/** Return the active multiplexer adapter. */
export function getMux(): Multiplexer {
  return new CmuxAdapter();
}
