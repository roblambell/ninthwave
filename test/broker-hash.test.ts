// Unit tests for the broker-hash HMAC helper.

import { describe, it, expect } from "vitest";
import { makeBrokerHasher, BROKER_HASH_LENGTH } from "../core/broker-hash.ts";

// Two distinct canonical base64-encoded 32-byte secrets. Built from fixed
// byte patterns so the tests do not depend on `generateProjectIdentity` or
// any random source, and so each secret is guaranteed to round-trip through
// Node/Bun's base64 codec.
const SECRET_A = Buffer.alloc(32, 0x00).toString("base64");
const SECRET_B = Buffer.alloc(32, 0x11).toString("base64");

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

describe("makeBrokerHasher", () => {
  it("produces the same digest for the same input across calls", () => {
    const hash = makeBrokerHasher(SECRET_A);
    const first = hash("work-item-H-BAJ-2");
    const second = hash("work-item-H-BAJ-2");
    expect(first).toBe(second);
  });

  it("produces the same digest across independently-built hashers with the same secret", () => {
    const hashOne = makeBrokerHasher(SECRET_A);
    const hashTwo = makeBrokerHasher(SECRET_A);
    expect(hashOne("operator@example.com")).toBe(hashTwo("operator@example.com"));
  });

  it("produces different digests for the same input under different secrets", () => {
    const hashA = makeBrokerHasher(SECRET_A);
    const hashB = makeBrokerHasher(SECRET_B);
    expect(hashA("shared-value")).not.toBe(hashB("shared-value"));
  });

  it("handles empty string input with a deterministic non-empty digest", () => {
    const hash = makeBrokerHasher(SECRET_A);
    const digest = hash("");
    expect(digest).toHaveLength(BROKER_HASH_LENGTH);
    expect(digest).toMatch(BASE64URL_PATTERN);
    // Stability: empty input still round-trips.
    expect(hash("")).toBe(digest);
  });

  it("hashes non-Latin / Unicode input stably", () => {
    const hash = makeBrokerHasher(SECRET_A);
    const inputs = ["日本語-work-item", "проект-42", "café☕️", "🔐secret🔑"];
    for (const input of inputs) {
      const digest = hash(input);
      expect(digest).toHaveLength(BROKER_HASH_LENGTH);
      expect(digest).toMatch(BASE64URL_PATTERN);
      // Same input, same secret, same output.
      expect(hash(input)).toBe(digest);
    }
    // Unicode inputs are not collapsed to a single digest.
    const uniqueDigests = new Set(inputs.map((v) => hash(v)));
    expect(uniqueDigests.size).toBe(inputs.length);
  });

  it("emits exactly 22 base64url characters with no padding", () => {
    const hash = makeBrokerHasher(SECRET_A);
    const samples = ["", "x", "a longer sentence with spaces", "H-BAJ-2"];
    for (const sample of samples) {
      const digest = hash(sample);
      expect(digest).toHaveLength(22);
      expect(digest).toHaveLength(BROKER_HASH_LENGTH);
      expect(digest).toMatch(BASE64URL_PATTERN);
      // base64url never includes `+`, `/`, or `=` padding.
      expect(digest).not.toMatch(/[+/=]/);
    }
  });

  it("produces a known digest for a known input (regression vector)", () => {
    // Pinned test vector. Regenerate with:
    //   node -e "console.log(require('crypto').createHmac('sha256',Buffer.alloc(32)).update('H-BAJ-2').digest('base64url').slice(0,22))"
    // Any change to encoding, key construction, or truncation length will
    // break this assertion even if the other stability tests still pass
    // (they compare digest-to-digest, which shifts together under a bug).
    const hash = makeBrokerHasher(SECRET_A);
    expect(hash("H-BAJ-2")).toBe("iQ_0ZkX1oVsd1md_gOjogY");
  });

  it("throws at factory time when the secret is not canonical base64-encoded 32 bytes", () => {
    // Wrong type.
    expect(() => makeBrokerHasher(undefined as unknown as string)).toThrow(TypeError);
    // Empty string.
    expect(() => makeBrokerHasher("")).toThrow(TypeError);
    // Too short.
    expect(() => makeBrokerHasher("abc")).toThrow(TypeError);
    // Right shape but illegal characters for standard base64.
    expect(() => makeBrokerHasher("!".repeat(43) + "=")).toThrow(TypeError);
    // Base64url input (uses `-`/`_`) is rejected -- config stores canonical base64.
    expect(() => makeBrokerHasher("-".repeat(43) + "=")).toThrow(TypeError);
    // Missing padding `=`.
    expect(() => makeBrokerHasher("A".repeat(44))).toThrow(TypeError);
    // 43 chars + `=` is valid shape but this specific string happens to be
    // a sanity check that our canonical secrets succeed.
    expect(() => makeBrokerHasher("A".repeat(43) + "=")).not.toThrow();
  });
});
