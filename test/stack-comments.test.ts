// Tests for core/stack-comments.ts -- buildStackComment and syncStackComments.
// Uses dependency injection (GhCommentClient) for testability without real GitHub API.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildStackComment,
  syncStackComments,
  STACK_COMMENT_MARKER,
  type StackEntry,
  type GhCommentClient,
} from "../core/stack-comments.ts";

describe("buildStackComment", () => {
  const twoItemStack: StackEntry[] = [
    { prNumber: 42, title: "feat: implement parser (H-PAR-1)" },
    { prNumber: 43, title: "feat: implement transformer (H-TFM-1)" },
  ];

  it("produces correct markdown for a 2-item stack with current PR highlighted", () => {
    const result = buildStackComment("main", twoItemStack, 43);

    expect(result).toContain(STACK_COMMENT_MARKER);
    expect(result).toContain("📦 **Stack** (managed by ninthwave)");
    expect(result).toContain("* `main`");
    // First PR: not current, plain text
    expect(result).toContain("  * #42 feat: implement parser (H-PAR-1)");
    // Second PR: current, bold with arrow
    expect(result).toContain(
      "    * **#43 feat: implement transformer (H-TFM-1)** ← this PR",
    );
  });

  it("marks the correct PR with the arrow indicator", () => {
    // Mark the first PR as current instead
    const result = buildStackComment("main", twoItemStack, 42);

    // First PR should be bold with arrow
    expect(result).toContain(
      "  * **#42 feat: implement parser (H-PAR-1)** ← this PR",
    );
    // Second PR should be plain
    expect(result).toContain(
      "    * #43 feat: implement transformer (H-TFM-1)",
    );
    // Only one arrow indicator
    expect(result.match(/← this PR/g)?.length).toBe(1);
  });

  it("handles a 3-item stack with correct indentation", () => {
    const threeStack: StackEntry[] = [
      { prNumber: 10, title: "feat: base layer (H-A-1)" },
      { prNumber: 11, title: "feat: middle layer (H-A-2)" },
      { prNumber: 12, title: "feat: top layer (H-A-3)" },
    ];

    const result = buildStackComment("develop", threeStack, 11);

    expect(result).toContain("* `develop`");
    expect(result).toContain("  * #10 feat: base layer (H-A-1)");
    expect(result).toContain(
      "    * **#11 feat: middle layer (H-A-2)** ← this PR",
    );
    expect(result).toContain("      * #12 feat: top layer (H-A-3)");
  });

  it("works with a single-item stack", () => {
    const singleStack: StackEntry[] = [
      { prNumber: 99, title: "fix: quick patch (L-FIX-1)" },
    ];

    const result = buildStackComment("main", singleStack, 99);

    expect(result).toContain("* `main`");
    expect(result).toContain(
      "  * **#99 fix: quick patch (L-FIX-1)** ← this PR",
    );
  });

  it("uses the provided base branch name", () => {
    const result = buildStackComment(
      "release/v2",
      twoItemStack,
      42,
    );

    expect(result).toContain("* `release/v2`");
  });
});

describe("syncStackComments", () => {
  let client: GhCommentClient;

  beforeEach(() => {
    client = {
      listComments: vi.fn().mockReturnValue([]),
      createComment: vi.fn().mockReturnValue(true),
      updateComment: vi.fn().mockReturnValue(true),
    };
  });

  const stack: StackEntry[] = [
    { prNumber: 42, title: "feat: implement parser (H-PAR-1)" },
    { prNumber: 43, title: "feat: implement transformer (H-TFM-1)" },
  ];

  it("creates new comments on all PRs when none exist", () => {
    syncStackComments("main", stack, client);

    // Should list comments for each PR
    expect(client.listComments).toHaveBeenCalledTimes(2);
    expect(client.listComments).toHaveBeenCalledWith(42);
    expect(client.listComments).toHaveBeenCalledWith(43);

    // Should create (not update) on each PR
    expect(client.createComment).toHaveBeenCalledTimes(2);
    expect(client.updateComment).not.toHaveBeenCalled();

    // Verify the body contains the marker and correct highlighting for each PR
    const call42 = (client.createComment as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(call42[0]).toBe(42);
    expect(call42[1]).toContain(STACK_COMMENT_MARKER);
    expect(call42[1]).toContain("**#42");
    expect(call42[1]).toContain("← this PR");

    const call43 = (client.createComment as ReturnType<typeof vi.fn>).mock
      .calls[1];
    expect(call43[0]).toBe(43);
    expect(call43[1]).toContain(STACK_COMMENT_MARKER);
    expect(call43[1]).toContain("**#43");
    expect(call43[1]).toContain("← this PR");
  });

  it("updates existing comment when marker is present", () => {
    const existingBody = `${STACK_COMMENT_MARKER}\n📦 **Stack** (managed by ninthwave)\n\n* \`main\`\n  * old content`;

    // PR 42 has an existing stack comment; PR 43 does not
    (client.listComments as ReturnType<typeof vi.fn>).mockImplementation(
      (prNumber: number) => {
        if (prNumber === 42) {
          return [
            { id: 100, body: "unrelated comment" },
            { id: 200, body: existingBody },
          ];
        }
        return [{ id: 300, body: "some other comment" }];
      },
    );

    syncStackComments("main", stack, client);

    // PR 42: should update (not create)
    expect(client.updateComment).toHaveBeenCalledTimes(1);
    const updateCall = (client.updateComment as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(updateCall[0]).toBe(200); // comment ID
    expect(updateCall[1]).toContain(STACK_COMMENT_MARKER);
    expect(updateCall[1]).toContain("**#42");

    // PR 43: should create (no existing marker)
    expect(client.createComment).toHaveBeenCalledTimes(1);
    const createCall = (client.createComment as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(createCall[0]).toBe(43);
  });

  it("does not duplicate comments on repeated calls", () => {
    // First call: no existing comments
    syncStackComments("main", stack, client);

    expect(client.createComment).toHaveBeenCalledTimes(2);
    expect(client.updateComment).toHaveBeenCalledTimes(0);

    // Simulate existing comments for second call
    const createdBodies = (
      client.createComment as ReturnType<typeof vi.fn>
    ).mock.calls.map(
      (call: [number, string]) => ({ id: call[0] * 10, body: call[1] }),
    );

    (client.listComments as ReturnType<typeof vi.fn>).mockImplementation(
      (prNumber: number) => {
        const match = createdBodies.find(
          (c: { id: number; body: string }) =>
            c.body.includes(`**#${prNumber}`),
        );
        return match ? [match] : [];
      },
    );

    // Reset call counts
    (client.createComment as ReturnType<typeof vi.fn>).mockClear();
    (client.updateComment as ReturnType<typeof vi.fn>).mockClear();

    // Second call: should update, not create
    syncStackComments("main", stack, client);

    expect(client.updateComment).toHaveBeenCalledTimes(2);
    expect(client.createComment).toHaveBeenCalledTimes(0);
  });

  it("updates earlier PR comments when the stack grows", () => {
    const existingComments = new Map<number, Array<{ id: number; body: string }>>();
    let nextCommentId = 100;

    client = {
      listComments: vi.fn((prNumber: number) => existingComments.get(prNumber) ?? []),
      createComment: vi.fn((prNumber: number, body: string) => {
        existingComments.set(prNumber, [{ id: nextCommentId++, body }]);
        return true;
      }),
      updateComment: vi.fn((commentId: number, body: string) => {
        for (const comments of existingComments.values()) {
          const existing = comments.find((comment) => comment.id === commentId);
          if (existing) {
            existing.body = body;
            return true;
          }
        }
        return false;
      }),
    };

    const twoItemStack: StackEntry[] = [
      { prNumber: 42, title: "feat: implement parser (H-PAR-1)" },
      { prNumber: 43, title: "feat: implement transformer (H-TFM-1)" },
    ];
    syncStackComments("main", twoItemStack, client);

    const threeItemStack: StackEntry[] = [
      ...twoItemStack,
      { prNumber: 44, title: "feat: implement renderer (H-RND-1)" },
    ];
    syncStackComments("main", threeItemStack, client);

    expect(client.createComment).toHaveBeenCalledTimes(3);
    expect(client.updateComment).toHaveBeenCalledTimes(2);

    const pr42Body = existingComments.get(42)?.[0]?.body;
    const pr43Body = existingComments.get(43)?.[0]?.body;
    const pr44Body = existingComments.get(44)?.[0]?.body;

    expect(pr42Body).toContain("#44 feat: implement renderer (H-RND-1)");
    expect(pr43Body).toContain("#44 feat: implement renderer (H-RND-1)");
    expect(pr44Body).toContain("**#44 feat: implement renderer (H-RND-1)** ← this PR");
    expect(existingComments.get(42)).toHaveLength(1);
    expect(existingComments.get(43)).toHaveLength(1);
    expect(existingComments.get(44)).toHaveLength(1);
  });
});
