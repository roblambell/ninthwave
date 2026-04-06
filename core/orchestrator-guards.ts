// Pure temporal safety predicates for the orchestrator state machine.
// Each guard is a pure function of timestamps, config thresholds, and the current time.
// No side effects, no state mutation -- trivially testable.

/**
 * CI fail grace period: is a CI "fail" status trustworthy?
 * Returns true when enough time has elapsed since entering ci-pending
 * that a "fail" result can be trusted (not stale from a previous commit).
 * Returns true when ciPendingSince is undefined (no grace period context).
 */
export function isCiFailTrustworthy(
  ciPendingSince: string | undefined,
  now: Date,
  graceMs: number,
): boolean {
  if (!ciPendingSince) return true;
  const sinceEntry = now.getTime() - new Date(ciPendingSince).getTime();
  return sinceEntry >= graceMs;
}

/**
 * Heartbeat freshness: is the worker heartbeat recent enough?
 * Returns true when a heartbeat timestamp exists and is within the timeout window.
 */
export function isHeartbeatActive(
  heartbeatTs: string | null | undefined,
  now: Date,
  timeoutMs: number,
): boolean {
  if (!heartbeatTs) return false;
  const age = now.getTime() - new Date(heartbeatTs).getTime();
  return age < timeoutMs;
}

/**
 * Event freshness: is the snapshot event time newer than a baseline timestamp?
 * Used in the rebasing handler to check if CI status is from a post-rebase push.
 * Returns false for undefined/invalid timestamps.
 */
export function isEventFresherThan(
  eventTime: string | undefined,
  baselineTime: string,
): boolean {
  if (!eventTime) return false;
  const eventMs = new Date(eventTime).getTime();
  const baseMs = new Date(baselineTime).getTime();
  return Number.isFinite(eventMs) && Number.isFinite(baseMs) && eventMs > baseMs;
}

/**
 * Should we re-notify CI failure? True when a new commit has arrived
 * since the last CI failure notification (commit fingerprint changed).
 */
export function shouldRenotifyCiFailure(
  lastCommitTime: string | null | undefined,
  ciFailureNotifiedAt: string | null | undefined,
): boolean {
  return lastCommitTime !== ciFailureNotifiedAt;
}

/**
 * Activity timeout: has the worker been idle (no new commits) beyond the threshold?
 * Used for commit staleness detection in the implementing handler.
 */
export function isActivityTimedOut(
  baselineTime: string,
  now: Date,
  timeoutMs: number,
): boolean {
  return (now.getTime() - new Date(baselineTime).getTime()) > timeoutMs;
}

/**
 * Launch timeout: has the worker failed to show signs of life within the launch window?
 * Used for no-commit timeout detection in implementing and launching handlers.
 */
export function isLaunchTimedOut(
  baselineTime: string,
  now: Date,
  timeoutMs: number,
): boolean {
  return (now.getTime() - new Date(baselineTime).getTime()) > timeoutMs;
}

/**
 * CI fix ack timeout: has the worker failed to heartbeat after CI failure notification?
 * Returns true when the notification was sent, the worker hasn't heartbeated since,
 * and the ack timeout has elapsed.
 */
export function isCiFixAckTimedOut(
  ciNotifyWallAt: string,
  heartbeatTs: string | null | undefined,
  now: Date,
  timeoutMs: number,
): boolean {
  const notifyMs = new Date(ciNotifyWallAt).getTime();
  const hbMs = heartbeatTs ? new Date(heartbeatTs).getTime() : 0;
  if (hbMs > notifyMs) return false;
  return (now.getTime() - notifyMs) > timeoutMs;
}

/**
 * Merge CI grace period: has enough time elapsed since entering forward-fix-pending
 * for CI to report on the merge commit? Used to detect "no CI configured" repos.
 */
export function isMergeCiGracePeriodExpired(
  lastTransition: string,
  now: Date,
  gracePeriodMs: number,
): boolean {
  return (now.getTime() - new Date(lastTransition).getTime()) > gracePeriodMs;
}

/**
 * Rebase stale: is the last rebase nudge old enough that we should retry?
 * Returns true when never nudged or when the nudge is older than the stale threshold.
 */
export function isRebaseStale(
  lastRebaseNudgeAt: string | undefined,
  now: Date,
  staleMs: number,
): boolean {
  if (!lastRebaseNudgeAt) return true;
  const lastNudgeMs = new Date(lastRebaseNudgeAt).getTime();
  if (!Number.isFinite(lastNudgeMs)) return true;
  return (now.getTime() - lastNudgeMs) >= staleMs;
}
