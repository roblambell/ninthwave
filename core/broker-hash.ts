// HMAC-SHA256 helper for anonymizing identifiers before they leave the daemon.
//
// The broker never sees cleartext work item ids, git emails, or other
// per-operator strings. Callers funnel those values through a hasher built
// from the project's shared `broker_secret` so two daemons configured with
// the same secret produce the same digest for the same input -- which is
// what makes claims and presence correlate across the crew -- while any
// observer without the secret sees only opaque tokens.
//
// Output is 22 characters of base64url (132 bits). That is short enough to
// embed in protocol messages without bloat and long enough that collisions
// between realistic inputs are astronomically unlikely.

import { createHmac } from "crypto";

/** Length in characters of the truncated base64url digest emitted by hashers. */
export const BROKER_HASH_LENGTH = 22;

/**
 * Build a deterministic hasher bound to a project's `broker_secret`.
 *
 * The `secret` argument is the canonical base64 encoding of 32 random bytes
 * (the same shape `parseBrokerSecret` in `core/config.ts` accepts). It is
 * decoded once at factory time and used as the HMAC-SHA256 key. Passing a
 * value that does not decode to exactly 32 bytes throws a `TypeError` so
 * misconfiguration surfaces immediately instead of silently producing a
 * weak-key digest that would then mismatch other daemons.
 *
 * The returned function is pure: same secret + same input always yields the
 * same 22-character base64url string. Callers in H-BAJ-3 will use it to
 * anonymize work item ids, operator identifiers, and similar values before
 * sending them through the broker protocol.
 */
export function makeBrokerHasher(secret: string): (value: string) => string {
  if (typeof secret !== "string") {
    throw new TypeError("broker secret must be a string");
  }
  // Match the canonical encoding accepted by parseBrokerSecret: 32 random
  // bytes encoded as standard (non-URL) base64, which is 43 chars plus one
  // trailing '=' for padding.
  if (!/^[A-Za-z0-9+/]{43}=$/.test(secret)) {
    throw new TypeError("broker secret must be base64-encoded 32 bytes");
  }
  const key = Buffer.from(secret, "base64");
  if (key.length !== 32) {
    throw new TypeError("broker secret must decode to 32 bytes");
  }
  // Round-trip check: reject any input whose decoded payload re-encodes to a
  // different string (stray whitespace, non-canonical padding, etc).
  if (key.toString("base64") !== secret) {
    throw new TypeError("broker secret is not canonical base64");
  }

  return function hashBrokerValue(value: string): string {
    const digest = createHmac("sha256", key).update(value, "utf8").digest("base64url");
    return digest.slice(0, BROKER_HASH_LENGTH);
  };
}
