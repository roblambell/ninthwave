// Stateful in-memory GitHub simulator for scenario tests.
// Exposes functions matching the signatures that buildSnapshot and OrchestratorDeps accept.
// Does NOT mock shell.run() -- instead, provides replacement functions for the injectable seams.

export interface FakePR {
  number: number;
  branch: string;
  title: string;
  state: "open" | "merged";
  ciStatus: "pass" | "fail" | "pending" | "unknown";
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | "";
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  /** ISO timestamp used as event time for detection latency. */
  updatedAt: string;
}

/**
 * In-memory GitHub simulator. Manages fake PRs keyed by branch name.
 *
 * Provides:
 * - `checkPr(id, repoRoot)` -- drop-in for buildSnapshot's checkPr parameter
 * - `checkCommitCI(repoRoot, sha)` -- drop-in for buildSnapshot's checkCommitCI parameter
 * - `prMerge(repoRoot, prNumber)` -- drop-in for OrchestratorDeps.prMerge
 * - `prComment(repoRoot, prNumber, body)` -- drop-in for OrchestratorDeps.prComment
 */
export class FakeGitHub {
  private prs = new Map<string, FakePR>();
  private nextPrNumber = 1;
  /** Comments posted: array of { prNumber, body }. */
  readonly comments: Array<{ prNumber: number; body: string }> = [];
  /** Merge commit CI statuses keyed by SHA. */
  private mergeCommitCI = new Map<string, "pass" | "fail" | "pending">();

  // ── Mutation methods (called by test / FakeWorker) ──────────────

  /** Create an open PR for a branch. Returns the PR number. */
  createPR(branch: string, title: string): number {
    const num = this.nextPrNumber++;
    this.prs.set(branch, {
      number: num,
      branch,
      title,
      state: "open",
      ciStatus: "unknown",
      reviewDecision: "",
      mergeable: "UNKNOWN",
      updatedAt: new Date().toISOString(),
    });
    return num;
  }

  /** Set CI status on a PR by branch name. */
  setCIStatus(branch: string, status: FakePR["ciStatus"]): void {
    const pr = this.prs.get(branch);
    if (!pr) throw new Error(`FakeGitHub: no PR for branch ${branch}`);
    pr.ciStatus = status;
    pr.updatedAt = new Date().toISOString();
  }

  /** Set review decision on a PR by branch name. */
  setReviewDecision(branch: string, decision: FakePR["reviewDecision"]): void {
    const pr = this.prs.get(branch);
    if (!pr) throw new Error(`FakeGitHub: no PR for branch ${branch}`);
    pr.reviewDecision = decision;
    pr.updatedAt = new Date().toISOString();
  }

  /** Set mergeable status on a PR by branch name. */
  setMergeable(branch: string, mergeable: FakePR["mergeable"]): void {
    const pr = this.prs.get(branch);
    if (!pr) throw new Error(`FakeGitHub: no PR for branch ${branch}`);
    pr.mergeable = mergeable;
    pr.updatedAt = new Date().toISOString();
  }

  /** Mark a PR as merged (by branch name). */
  mergePR(branch: string): void {
    const pr = this.prs.get(branch);
    if (!pr) throw new Error(`FakeGitHub: no PR for branch ${branch}`);
    pr.state = "merged";
    pr.updatedAt = new Date().toISOString();
  }

  /** Set CI status for a merge commit SHA (for post-merge verification). */
  setMergeCommitCI(sha: string, status: "pass" | "fail" | "pending"): void {
    this.mergeCommitCI.set(sha, status);
  }

  /** Get a PR by branch name (for test assertions). */
  getPR(branch: string): FakePR | undefined {
    return this.prs.get(branch);
  }

  // ── Injectable functions (passed to buildSnapshot / OrchestratorDeps) ──

  /**
   * Drop-in replacement for checkPrStatus.
   * Returns tab-separated: ID\tPR_NUMBER\tSTATUS\tMERGEABLE\tEVENT_TIME[\tTITLE]
   */
  checkPr = (id: string, _repoRoot: string): string | null => {
    const branch = `ninthwave/${id}`;
    const pr = this.prs.get(branch);
    if (!pr) return `${id}\t\tno-pr`;

    if (pr.state === "merged") {
      return `${id}\t${pr.number}\tmerged\t\t\t${pr.title}`;
    }

    let status: string;
    if (pr.ciStatus === "fail") {
      status = "failing";
    } else if (pr.ciStatus === "pass") {
      if (pr.mergeable === "MERGEABLE" && pr.reviewDecision === "APPROVED") {
        status = "ready";
      } else {
        status = "ci-passed";
      }
    } else if (pr.ciStatus === "pending") {
      status = "pending";
    } else {
      status = "pending";
    }

    return `${id}\t${pr.number}\t${status}\t${pr.mergeable}\t${pr.updatedAt}`;
  };

  /**
   * Drop-in replacement for checkCommitCI (post-merge verification).
   */
  checkCommitCI = (_repoRoot: string, sha: string): "pass" | "fail" | "pending" => {
    return this.mergeCommitCI.get(sha) ?? "pending";
  };

  /**
   * Drop-in replacement for OrchestratorDeps.prMerge.
   * Marks the PR as merged in internal state.
   */
  prMerge = (_repoRoot: string, prNumber: number, _options?: { admin?: boolean }): boolean => {
    for (const pr of this.prs.values()) {
      if (pr.number === prNumber) {
        pr.state = "merged";
        pr.updatedAt = new Date().toISOString();
        return true;
      }
    }
    return false;
  };

  /**
   * Drop-in replacement for OrchestratorDeps.prComment.
   */
  prComment = (_repoRoot: string, prNumber: number, body: string): boolean => {
    this.comments.push({ prNumber, body });
    return true;
  };
}
