// Watch/polling commands: watch-ready, pr-watch, pr-activity, scanExternalPRs.

import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { die } from "../output.ts";
import {
  prList as defaultPrList,
  prView as defaultPrView,
  prChecks as defaultPrChecks,
  prListAsync as defaultPrListAsync,
  prViewAsync as defaultPrViewAsync,
  prChecksAsync as defaultPrChecksAsync,
  getRepoOwner as defaultGetRepoOwner,
  apiGet as defaultApiGet,
  isAvailable as defaultIsAvailable,
  ghInRepo,
  type GhFailureKind,
} from "../gh.ts";
import { parseWorkItemReferenceBlock } from "../work-item-files.ts";
import * as ghModule from "../gh.ts";
import type { WatchResult, Transition } from "../types.ts";

/** Injectable dependencies for PR monitoring commands, for testing. */
export interface PrMonitorDeps {
  prList: typeof defaultPrList;
  prView: typeof defaultPrView;
  prChecks: typeof defaultPrChecks;
  isAvailable: typeof defaultIsAvailable;
  getRepoOwner: typeof defaultGetRepoOwner;
  apiGet: typeof defaultApiGet;
}

/** Async variant of PrMonitorDeps for checkPrStatusAsync. */
export interface PrMonitorAsyncDeps {
  prListAsync: typeof defaultPrListAsync;
  prViewAsync: typeof defaultPrViewAsync;
  prChecksAsync: typeof defaultPrChecksAsync;
  isAvailable: typeof defaultIsAvailable;
}

export type PrPollFailureStage =
  | "availability"
  | "prList-open"
  | "prList-merged"
  | "prView"
  | "prChecks";

export interface PrPollFailure {
  kind: GhFailureKind;
  stage: PrPollFailureStage;
  error: string;
}

export interface PrStatusPollResult {
  statusLine: string;
  failure?: PrPollFailure;
}

// Defaults read from the module namespace so vi.spyOn in tests works.
const defaultPrMonitorDeps: PrMonitorDeps = {
  prList: (...args) => ghModule.prList(...args),
  prView: (...args) => ghModule.prView(...args),
  prChecks: (...args) => ghModule.prChecks(...args),
  isAvailable: () => ghModule.isAvailable(),
  getRepoOwner: (...args) => ghModule.getRepoOwner(...args),
  apiGet: (...args) => ghModule.apiGet(...args),
};

// Async defaults read from the module namespace so vi.spyOn in tests works.
const defaultPrMonitorAsyncDeps: PrMonitorAsyncDeps = {
  prListAsync: (...args) => ghModule.prListAsync(...args),
  prViewAsync: (...args) => ghModule.prViewAsync(...args),
  prChecksAsync: (...args) => ghModule.prChecksAsync(...args),
  isAvailable: () => ghModule.isAvailable(),
};

// ── External PR scanning ──────────────────────────────────────────────

/** Data returned by scanExternalPRs for each non-ninthwave PR. */
export interface ExternalPR {
  prNumber: number;
  headBranch: string;
  author: string;
  isDraft: boolean;
  headSha: string;
  authorAssociation: string;
  labels: string[];
}

/** Raw shape returned by the GitHub REST API for pull requests. */
interface GitHubPullRequest {
  number: number;
  head: { ref: string; sha: string };
  user: { login: string };
  draft: boolean;
  author_association: string;
  labels: Array<{ name: string }>;
}

/** Injectable dependencies for scanExternalPRs, for testing. */
export interface ScanExternalPRsDeps {
  ghRunner: (root: string, args: string[]) => { exitCode: number; stdout: string };
  isAvailable: () => boolean;
  getOwnerRepo: (repoRoot: string) => string;
}

const defaultScanDeps: ScanExternalPRsDeps = {
  ghRunner: ghInRepo,
  isAvailable: defaultIsAvailable,
  getOwnerRepo: defaultGetRepoOwner,
};

/**
 * Scan for open PRs not managed by ninthwave (non-`ninthwave/*` branches).
 * Uses the GitHub REST API to list open PRs with author_association.
 *
 * @param repoRoot - Path to the repository root
 * @param deps - Injectable dependencies for testing
 */
export function scanExternalPRs(
  repoRoot: string,
  deps: Partial<ScanExternalPRsDeps> = {},
): ExternalPR[] {
  const { ghRunner, isAvailable, getOwnerRepo } = { ...defaultScanDeps, ...deps };

  if (!isAvailable()) return [];

  let ownerRepo: string;
  try {
    ownerRepo = getOwnerRepo(repoRoot);
  } catch {
    return [];
  }

  const result = ghRunner(repoRoot, [
    "api",
    `repos/${ownerRepo}/pulls?state=open&per_page=100`,
  ]);

  if (result.exitCode !== 0 || !result.stdout) return [];

  try {
    const prs = JSON.parse(result.stdout) as GitHubPullRequest[];

    return prs
      .filter((pr) => !pr.head.ref.startsWith("ninthwave/"))
      .map((pr) => ({
        prNumber: pr.number,
        headBranch: pr.head.ref,
        author: pr.user.login,
        isDraft: pr.draft,
        headSha: pr.head.sha,
        authorAssociation: pr.author_association,
        labels: pr.labels.map((l) => l.name),
      }));
  } catch {
    return [];
  }
}

/** jq fragment: only count comments/reviews from trusted author associations. */
export const TRUSTED_ASSOC = '(.author_association == "OWNER" or .author_association == "MEMBER" or .author_association == "COLLABORATOR")';

/**
 * Check each worktree's PR status (merged/ready/pending/failing/no-pr).
 * Returns tab-separated lines: ID\tPR_NUMBER\tSTATUS...
 *
 * @param print - When true (default, CLI usage), writes results to console.
 *   Pass false to get the result string without side effects.
 */
export function cmdWatchReady(
  worktreeDir: string,
  projectRoot: string,
  print: boolean = true,
  deps: PrMonitorDeps = defaultPrMonitorDeps,
): string {
  if (!existsSync(worktreeDir)) {
    if (print) console.log("No active worktrees");
    return "";
  }

  const results: string[] = [];

  // Iterate worktrees
  try {
    for (const entry of readdirSync(worktreeDir)) {
      if (!entry.startsWith("ninthwave-")) continue;
      const wtDir = join(worktreeDir, entry);
      if (!existsSync(wtDir)) continue;
      const id = entry.slice(10);
      const line = checkPrStatus(id, projectRoot, deps);
      if (line) results.push(line);
    }
  } catch {
    // ignore
  }


  const output = results.join("\n");
  if (print && output) console.log(output);
  return output;
}

/**
 * CI check states that indicate a definitive failure.
 * GitHub returns these from check runs (FAILURE, CANCELLED, TIMED_OUT,
 * ACTION_REQUIRED, STARTUP_FAILURE) and commit status checks (ERROR).
 * Without this, only FAILURE was detected -- other failure states like ERROR
 * left ciStatus as "unknown", causing items to stay stuck in ci-pending.
 */
export const CI_FAILURE_STATES = new Set([
  "FAILURE",
  "ERROR",
  "CANCELLED",
  "TIMED_OUT",
  "STARTUP_FAILURE",
  "ACTION_REQUIRED",
]);

/** Grace period after PR creation before treating zero checks as "no CI configured". */
export const CI_GRACE_PERIOD_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Shared CI status processing. Determines ciStatus and event time from a set
 * of GitHub check runs/status checks. Used by both sync and async check paths
 * so bug fixes apply to both.
 *
 * prCreatedAt: ISO timestamp from the PR. When no non-skipped checks exist,
 * if the PR was opened within CI_GRACE_PERIOD_MS, returns "unknown" (wait for
 * CI to register). After the grace period, returns "pass" (no CI configured).
 */
export function processChecks(
  checks: { state: string; name: string; completedAt?: string }[],
  prCreatedAt?: string,
  now: Date = new Date(),
): { ciStatus: string; eventTime: string | undefined } {
  const nonSkipped = checks.filter((c) => c.state !== "SKIPPED");
  let ciStatus: string;
  if (nonSkipped.length === 0) {
    // No checks registered. If the PR was recently opened, CI may not have started yet.
    const inGrace =
      prCreatedAt !== undefined &&
      prCreatedAt !== "" &&
      now.getTime() - new Date(prCreatedAt).getTime() < CI_GRACE_PERIOD_MS;
    ciStatus = inGrace ? "unknown" : "pass";
  } else {
    ciStatus = "unknown";
    if (nonSkipped.every((c) => c.state === "SUCCESS")) {
      ciStatus = "pass";
    } else if (nonSkipped.some((c) => CI_FAILURE_STATES.has(c.state))) {
      ciStatus = "fail";
    } else if (nonSkipped.some((c) => c.state === "PENDING")) {
      ciStatus = "pending";
    }
  }

  // For terminal CI states, derive event time from the latest check completedAt.
  let eventTime: string | undefined;
  if (ciStatus === "pass" || ciStatus === "fail") {
    const completedTimes = nonSkipped
      .map((c) => c.completedAt)
      .filter((t): t is string => !!t)
      .sort();
    if (completedTimes.length > 0) {
      eventTime = completedTimes[completedTimes.length - 1]!;
    }
  }

  return { ciStatus, eventTime };
}

/** Derive overall PR status from CI status and review/merge state. */
function derivePrStatus(ciStatus: string, isMergeable: string, reviewDecision: string): string {
  if (ciStatus === "fail") return "failing";
  if (ciStatus === "pass") {
    return isMergeable === "MERGEABLE" && reviewDecision === "APPROVED" ? "ready" : "ci-passed";
  }
  return "pending";
}

function formatOpenPrStatus(
  id: string,
  prNumber: number,
  isMergeable = "",
  eventTime = "",
): string {
  return `${id}\t${prNumber}\topen\t${isMergeable}\t${eventTime}`;
}

function pollFailure(stage: PrPollFailureStage, kind: GhFailureKind, error: string, statusLine = ""): PrStatusPollResult {
  return { statusLine, failure: { kind, stage, error } };
}

export function checkPrStatusDetailed(
  id: string,
  repoRoot: string,
  deps: PrMonitorDeps = defaultPrMonitorDeps,
): PrStatusPollResult {
  const branch = `ninthwave/${id}`;

  if (!deps.isAvailable()) return pollFailure("availability", "missing-cli", "gh CLI unavailable");

  // Check for open PR -- distinguish API error from "no PRs"
  const openResult = deps.prList(repoRoot, branch, "open");
  if (!openResult.ok) return pollFailure("prList-open", openResult.kind, openResult.error);
  const openPrs = openResult.data;
  if (openPrs.length === 0) {
    // Check if merged
    const mergedResult = deps.prList(repoRoot, branch, "merged");
    if (!mergedResult.ok) return pollFailure("prList-merged", mergedResult.kind, mergedResult.error);
    const mergedPrs = mergedResult.data;
    if (mergedPrs.length > 0) {
      const pr = mergedPrs[0]!;
      const prTitle = pr.title ?? "";
      const lineageToken = parseWorkItemReferenceBlock(pr.body ?? "")?.lineageToken ?? "";
      return { statusLine: `${id}\t${pr.number}\tmerged\t\t\t${prTitle}\t${lineageToken}` };
    }
    return { statusLine: `${id}\t\tno-pr` };
  }

  const prNumber = openPrs[0]!.number;

  // Check CI and review status (include updatedAt for detection latency, createdAt for CI grace period)
  const prViewResult = deps.prView(repoRoot, prNumber, ["reviewDecision", "mergeable", "updatedAt", "createdAt"]);
  if (!prViewResult.ok) return pollFailure("prView", prViewResult.kind, prViewResult.error, formatOpenPrStatus(id, prNumber));
  const prData = prViewResult.data;
  const reviewDecision = (prData.reviewDecision as string) ?? "";
  const isMergeable = (prData.mergeable as string) ?? "";
  const prUpdatedAt = (prData.updatedAt as string) ?? "";
  const prCreatedAt = (prData.createdAt as string) ?? "";

  const checksResult = deps.prChecks(repoRoot, prNumber);
  if (!checksResult.ok) {
    return pollFailure(
      "prChecks",
      checksResult.kind,
      checksResult.error,
      formatOpenPrStatus(id, prNumber, isMergeable || "UNKNOWN", prUpdatedAt),
    );
  }

  const { ciStatus, eventTime: ciEventTime } = processChecks(checksResult.data, prCreatedAt);
  const status = derivePrStatus(ciStatus, isMergeable, reviewDecision);
  const eventTime = ciEventTime ?? prUpdatedAt;

  // Fields: ID, PR number, status, mergeable, eventTime (5th field for detection latency)
  return { statusLine: `${id}\t${prNumber}\t${status}\t${isMergeable || "UNKNOWN"}\t${eventTime}` };
}

export function checkPrStatus(id: string, repoRoot: string, deps: PrMonitorDeps = defaultPrMonitorDeps): string {
  return checkPrStatusDetailed(id, repoRoot, deps).statusLine;
}

/**
 * Async variant of checkPrStatus. Uses async gh functions so each
 * network call yields to the event loop, keeping the TUI responsive.
 * Returns the same tab-separated string format as the sync version.
 */
export async function checkPrStatusAsync(id: string, repoRoot: string, deps: PrMonitorAsyncDeps = defaultPrMonitorAsyncDeps): Promise<string> {
  return (await checkPrStatusDetailedAsync(id, repoRoot, deps)).statusLine;
}

export async function checkPrStatusDetailedAsync(
  id: string,
  repoRoot: string,
  deps: PrMonitorAsyncDeps = defaultPrMonitorAsyncDeps,
): Promise<PrStatusPollResult> {
  const branch = `ninthwave/${id}`;

  if (!deps.isAvailable()) return pollFailure("availability", "missing-cli", "gh CLI unavailable");

  // Check for open PR -- distinguish API error from "no PRs"
  const openResult = await deps.prListAsync(repoRoot, branch, "open");
  if (!openResult.ok) return pollFailure("prList-open", openResult.kind, openResult.error);
  const openPrs = openResult.data;
  if (openPrs.length === 0) {
    const mergedResult = await deps.prListAsync(repoRoot, branch, "merged");
    if (!mergedResult.ok) return pollFailure("prList-merged", mergedResult.kind, mergedResult.error);
    const mergedPrs = mergedResult.data;
    if (mergedPrs.length > 0) {
      const pr = mergedPrs[0]!;
      const prTitle = pr.title ?? "";
      const lineageToken = parseWorkItemReferenceBlock(pr.body ?? "")?.lineageToken ?? "";
      return { statusLine: `${id}\t${pr.number}\tmerged\t\t\t${prTitle}\t${lineageToken}` };
    }
    return { statusLine: `${id}\t\tno-pr` };
  }

  const prNumber = openPrs[0]!.number;

  const prViewResult = await deps.prViewAsync(repoRoot, prNumber, ["reviewDecision", "mergeable", "updatedAt", "createdAt"]);
  if (!prViewResult.ok) return pollFailure("prView", prViewResult.kind, prViewResult.error, formatOpenPrStatus(id, prNumber));
  const prData = prViewResult.data;
  const reviewDecision = (prData.reviewDecision as string) ?? "";
  const isMergeable = (prData.mergeable as string) ?? "";
  const prUpdatedAt = (prData.updatedAt as string) ?? "";
  const prCreatedAt = (prData.createdAt as string) ?? "";

  const checksResult = await deps.prChecksAsync(repoRoot, prNumber);
  if (!checksResult.ok) {
    return pollFailure(
      "prChecks",
      checksResult.kind,
      checksResult.error,
      formatOpenPrStatus(id, prNumber, isMergeable || "UNKNOWN", prUpdatedAt),
    );
  }

  const { ciStatus, eventTime: ciEventTime } = processChecks(checksResult.data, prCreatedAt);
  const status = derivePrStatus(ciStatus, isMergeable, reviewDecision);
  const eventTime = ciEventTime ?? prUpdatedAt;

  return { statusLine: `${id}\t${prNumber}\t${status}\t${isMergeable || "UNKNOWN"}\t${eventTime}` };
}

export function findTransitions(currentState: string, prevState: string): string {
  let transitions = "";
  for (const line of currentState.split("\n")) {
    if (!line) continue;
    const [id, prNumber, status] = line.split("\t");
    if (!id) continue;

    let prevStatus = "no-pr";
    if (prevState) {
      for (const prevLine of prevState.split("\n")) {
        const parts = prevLine.split("\t");
        if (parts[0] === id) {
          prevStatus = parts[2] ?? "no-pr";
          break;
        }
      }
    }

    if (prevStatus !== status) {
      transitions += `${id}\t${prNumber ?? ""}\t${prevStatus}\t${status}\n`;
    }
  }
  return transitions;
}

export function findGoneItems(currentState: string, prevState: string): string {
  if (!prevState) return "";
  let transitions = "";
  const currentIds = new Set(
    currentState
      .split("\n")
      .filter(Boolean)
      .map((l) => l.split("\t")[0]),
  );

  for (const line of prevState.split("\n")) {
    if (!line) continue;
    const [id, prNumber, status] = line.split("\t");
    if (!id) continue;
    if (!currentIds.has(id)) {
      transitions += `${id}\t${prNumber ?? ""}\t${status ?? ""}\tgone\n`;
    }
  }
  return transitions;
}

/**
 * Poll until PR has new activity (reviews, comments).
 */
export async function cmdPrWatch(
  args: string[],
  projectRoot: string,
  deps: PrMonitorDeps = defaultPrMonitorDeps,
): Promise<void> {
  let prNumber = "";
  let interval = 120;
  let since = "";

  // Parse args
  let i = 0;
  while (i < args.length) {
    switch (args[i]) {
      case "--pr":
        prNumber = args[i + 1] ?? "";
        i += 2;
        break;
      case "--interval":
        interval = parseInt(args[i + 1] ?? "120", 10);
        i += 2;
        break;
      case "--since":
        since = args[i + 1] ?? "";
        i += 2;
        break;
      default:
        die(`Unknown option: ${args[i]}`);
    }
  }

  if (!prNumber) {
    die("Usage: ninthwave pr-watch --pr N [--interval N] [--since T]");
  }

  if (!since) {
    since = new Date().toISOString();
  }

  let elapsed = 0;
  while (elapsed < 3600) {
    await new Promise((r) => setTimeout(r, interval * 1000));
    elapsed += interval;

    let ownerRepo: string;
    try {
      ownerRepo = deps.getRepoOwner(projectRoot);
    } catch {
      continue;
    }

    // Check for new reviews (trusted authors only)
    let newReviews = 0;
    try {
      const result = deps.apiGet(
        projectRoot,
        `repos/${ownerRepo}/pulls/${prNumber}/reviews`,
        `[.[] | select(.submitted_at > "${since}" and ${TRUSTED_ASSOC})] | length`,
      );
      newReviews = parseInt(result, 10) || 0;
    } catch {
      // ignore
    }

    // Check for new comments (trusted authors only)
    let newComments = 0;
    try {
      const result = deps.apiGet(
        projectRoot,
        `repos/${ownerRepo}/issues/${prNumber}/comments`,
        `[.[] | select(.created_at > "${since}" and ${TRUSTED_ASSOC})] | length`,
      );
      newComments = parseInt(result, 10) || 0;
    } catch {
      // ignore
    }

    // Check for new review comments (trusted authors only)
    let newReviewComments = 0;
    try {
      const result = deps.apiGet(
        projectRoot,
        `repos/${ownerRepo}/pulls/${prNumber}/comments`,
        `[.[] | select(.created_at > "${since}" and ${TRUSTED_ASSOC})] | length`,
      );
      newReviewComments = parseInt(result, 10) || 0;
    } catch {
      // ignore
    }

    const total = newReviews + newComments + newReviewComments;
    if (total > 0) {
      console.log(`activity\t${prNumber}\t${total}`);
      return;
    }

    // Check if PR state changed
    try {
      const viewResult = deps.prView(projectRoot, parseInt(prNumber, 10), ["state"]);
      if (viewResult.ok) {
        const state = viewResult.data.state as string;
        if (state === "MERGED" || state === "CLOSED") {
          console.log(`state_change\t${prNumber}\t${state}`);
          return;
        }
      }
    } catch {
      // ignore
    }
  }

  console.log(`Timeout: no activity on PR #${prNumber} after 1 hour`);
  process.exit(1);
}

/**
 * Check for new comments/reviews on PRs since a given time.
 */
export function cmdPrActivity(
  args: string[],
  projectRoot: string,
  deps: PrMonitorDeps = defaultPrMonitorDeps,
): void {
  const prs: string[] = [];
  let since = "";

  // Parse args
  let i = 0;
  while (i < args.length) {
    if (args[i] === "--since") {
      since = args[i + 1] ?? "";
      i += 2;
    } else {
      prs.push(args[i]!);
      i++;
    }
  }

  if (prs.length < 1) {
    die("Usage: ninthwave pr-activity <PR1> [PR2]... [--since T]");
  }

  if (!since) {
    // Default to 1 hour ago
    since = new Date(Date.now() - 3600 * 1000).toISOString();
  }

  let ownerRepo: string;
  try {
    ownerRepo = deps.getRepoOwner(projectRoot);
  } catch {
    die("Could not determine repository");
  }

  for (const pr of prs) {
    let activityType = "none";

    // Check for review decisions (trusted authors only)
    try {
      const reviewState = deps.apiGet(
        projectRoot,
        `repos/${ownerRepo}/pulls/${pr}/reviews`,
        `[.[] | select(.submitted_at > "${since}" and ${TRUSTED_ASSOC})] | last | .state`,
      );
      if (reviewState === "CHANGES_REQUESTED") {
        activityType = "changes_requested";
      } else if (reviewState === "APPROVED") {
        activityType = "approved";
      }
    } catch {
      // ignore
    }

    // Check for new comments (trusted authors only)
    try {
      const result = deps.apiGet(
        projectRoot,
        `repos/${ownerRepo}/issues/${pr}/comments`,
        `[.[] | select(.created_at > "${since}" and ${TRUSTED_ASSOC})] | length`,
      );
      const count = parseInt(result, 10) || 0;
      if (count > 0 && activityType === "none") {
        activityType = "new_comments";
      }
    } catch {
      // ignore
    }

    // Check for new review comments (trusted authors only, inline)
    try {
      const result = deps.apiGet(
        projectRoot,
        `repos/${ownerRepo}/pulls/${pr}/comments`,
        `[.[] | select(.created_at > "${since}" and ${TRUSTED_ASSOC})] | length`,
      );
      const count = parseInt(result, 10) || 0;
      if (count > 0 && activityType === "none") {
        activityType = "new_comments";
      }
    } catch {
      // ignore
    }

    console.log(`${pr}\t${activityType}`);
  }
}
