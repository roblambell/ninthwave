// Project configuration loading for the ninthwave CLI.

import { readFileSync, existsSync } from "fs";
import { join } from "path";

/** Project config shape -- only two boolean flags remain. */
export interface ProjectConfig {
  review_external: boolean;
  schedule_enabled: boolean;
}

/**
 * Load project config from .ninthwave/config.json (JSON format).
 * Returns defaults (both false) when the file is missing or malformed.
 * Unknown keys are silently ignored.
 */
export function loadConfig(projectRoot: string): ProjectConfig {
  const defaults: ProjectConfig = {
    review_external: false,
    schedule_enabled: false,
  };

  const configPath = join(projectRoot, ".ninthwave", "config.json");
  if (!existsSync(configPath)) return defaults;

  try {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return defaults;
    }
    return {
      review_external: parsed.review_external === true,
      schedule_enabled: parsed.schedule_enabled === true,
    };
  } catch {
    return defaults;
  }
}
