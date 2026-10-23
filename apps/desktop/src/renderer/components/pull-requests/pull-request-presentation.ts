import {
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  type LucideIcon,
} from "lucide-react";
import type {
  PullRequestChecksSummary,
  PullRequestLink,
  PullRequestReviewDecision,
  PullRequestSnapshot,
  PullRequestState,
  PullRequestWatchEndReason,
  PullRequestCheck,
  PullRequestDetail,
  PullRequestMergeMethod,
  PullRequestReviewerState,
} from "../../../shared/source-control-contract";
import { SourceControlError } from "../../hooks/use-source-control";
import { formatDurationCnWithHours } from "../../lib/format-duration";

export const PULL_REQUEST_STATE_ICON: Record<PullRequestState, LucideIcon> = {
  open: GitPullRequest,
  draft: GitPullRequestDraft,
  merged: GitMerge,
  closed: GitPullRequestClosed,
};

export const PULL_REQUEST_STATE_LABEL: Record<PullRequestState, string> = {
  open: "Open",
  draft: "Draft",
  merged: "Merged",
  closed: "Closed",
};

/** Semantic theme colors only: the icon shape carries the state too. */
export const PULL_REQUEST_STATE_TEXT: Record<PullRequestState, string> = {
  open: "text-success",
  draft: "text-muted-foreground",
  merged: "text-info",
  closed: "text-destructive",
};

export const CHECKS_LABEL: Record<PullRequestChecksSummary, string> = {
  passing: "Checks passing",
  failing: "Checks failing",
  pending: "Checks running",
  none: "No checks",
};

export const CHECKS_DOT: Record<Exclude<PullRequestChecksSummary, "none">, string> = {
  passing: "bg-success",
  failing: "bg-destructive",
  pending: "bg-warning",
};

export const REVIEW_LABEL: Record<PullRequestReviewDecision, string> = {
  approved: "Approved",
  "changes-requested": "Changes requested",
  "review-required": "Review required",
};

export const WATCH_END_LABEL: Record<PullRequestWatchEndReason, string> = {
  merged: "Stopped watching: the pull request merged",
  closed: "Stopped watching: the pull request closed",
  settled: "Stopped watching: the task was settled",
  "comment-limit": "Stopped watching after 10 comment-only wake-ups",
  unreadable: "Stopped watching: GitHub could not be read",
  stopped: "Stopped watching",
};

export const WATCH_EXPLANATION =
  "Wakes the agent when checks fail or pass, someone reviews, or the branch conflicts.";

export function pullRequestCanWatch(pullRequest: Pick<PullRequestSnapshot, "state">): boolean {
  return pullRequest.state === "open" || pullRequest.state === "draft";
}

/** One-line accessible summary, e.g. "Pull request #12, open, checks failing, conflicts". */
export function describePullRequest(link: Pick<PullRequestLink, "pullRequest" | "watch">): string {
  const { pullRequest } = link;
  const parts = [
    `Pull request #${pullRequest.number}`,
    PULL_REQUEST_STATE_LABEL[pullRequest.state].toLowerCase(),
  ];
  if (pullRequest.checks !== "none") parts.push(CHECKS_LABEL[pullRequest.checks].toLowerCase());
  if (pullRequest.reviewDecision)
    parts.push(REVIEW_LABEL[pullRequest.reviewDecision].toLowerCase());
  if (pullRequest.mergeable === "conflicting") parts.push("has conflicts");
  if (link.watch) parts.push("watching");
  return parts.join(", ");
}

/**
 * The link a compact surface should represent: open work first, then the most recently
 * updated. Rows show one badge; the tooltip and task control list the rest.
 */
export function primaryPullRequestLink(
  links: readonly PullRequestLink[],
): PullRequestLink | undefined {
  const rank = (link: PullRequestLink) =>
    link.pullRequest.state === "open" || link.pullRequest.state === "draft" ? 1 : 0;
  let best: PullRequestLink | undefined;
  for (const link of links) {
    if (
      !best ||
      rank(link) > rank(best) ||
      (rank(link) === rank(best) && link.pullRequest.updatedAt > best.pullRequest.updatedAt)
    )
      best = link;
  }
  return best;
}

/** Identity-equal link arrays: React Query keeps unchanged link objects across refetches. */
export function samePullRequestLinks(
  previous: readonly PullRequestLink[] | undefined,
  next: readonly PullRequestLink[] | undefined,
): boolean {
  if (previous === next) return true;
  if (!previous || !next || previous.length !== next.length) return false;
  return previous.every((link, index) => link === next[index]);
}

export function formatPullRequestTime(timestamp: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 60_000) return "just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  if (elapsed < 604_800_000) return `${Math.floor(elapsed / 86_400_000)}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(timestamp);
}

export function formatRetryTime(retryAt: number | undefined | null): string | null {
  if (!retryAt) return null;
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(retryAt);
}

export const GITHUB_SIGN_IN_HINT = "Run `gh auth login` or set GH_TOKEN, then try again.";

/** A short, user-facing sentence for a failed source control call. */
export function sourceControlErrorMessage(error: unknown): string {
  if (error instanceof SourceControlError) {
    switch (error.code) {
      case "github-unauthenticated":
        return `GitHub 尚未登录。${GITHUB_SIGN_IN_HINT}`;
      case "github-auth-failed":
        return `GitHub 拒绝了该令牌。${GITHUB_SIGN_IN_HINT}`;
      case "github-rate-limited": {
        const retry = formatRetryTime(error.retryAt);
        return retry
          ? `GitHub 已达到速率限制。请在 ${retry} 后重试。`
          : "GitHub 已达到速率限制。请稍后重试。";
      }
      case "no-pull-request":
        return "未找到此任务分支对应的拉取请求。";
      case "pull-request-not-open":
        return "只能关注处于开放或草稿状态的拉取请求。";
      case "unsupported-connection":
        return "拉取请求仅可用于本机上的任务。";
      case "github-not-found":
        return "GitHub 未找到此拉取请求，或当前账号无权查看。";
      case "github-forbidden":
        return "此 GitHub 账号没有执行此操作的权限。";
      case "merge-head-moved":
        return "加载此拉取请求后有新的提交。请先刷新并审查，然后再合入。";
      case "merge-not-mergeable":
        return "此拉取请求当前无法合入。请先解决冲突或更新分支。";
      case "merge-checks-required":
        return "必要的检查尚未通过。";
      case "merge-blocked":
        return error.message || "GitHub 阻止了此次合入。";
      default:
        return error.message;
    }
  }
  return error instanceof Error ? error.message : "出了点问题。";
}

export const REVIEWER_STATE_LABEL: Record<PullRequestReviewerState, string> = {
  requested: "等待评审",
  approved: "已通过",
  "changes-requested": "需要修改",
  commented: "已评论",
  dismissed: "已忽略",
};

export const MERGE_METHOD_LABEL: Record<PullRequestMergeMethod, string> = {
  merge: "创建合并提交",
  squash: "压缩并合入",
  rebase: "变基并合入",
};

export const MERGE_METHOD_SHORT: Record<PullRequestMergeMethod, string> = {
  merge: "合并",
  squash: "压缩",
  rebase: "变基",
};

export type CheckGroup = "failing" | "pending" | "passing";

const FAILING_CONCLUSIONS = new Set([
  "failure",
  "timed-out",
  "action-required",
  "cancelled",
  "stale",
]);

export function checkGroup(check: PullRequestCheck): CheckGroup {
  if (check.status !== "completed" || check.conclusion === null) return "pending";
  return FAILING_CONCLUSIONS.has(check.conclusion) ? "failing" : "passing";
}

const CONCLUSION_LABEL: Record<NonNullable<PullRequestCheck["conclusion"]>, string> = {
  success: "通过",
  failure: "失败",
  neutral: "中性",
  cancelled: "已取消",
  skipped: "已跳过",
  "timed-out": "超时",
  "action-required": "需要操作",
  stale: "已过期",
};

export function checkStatusLabel(check: PullRequestCheck): string {
  if (check.status === "queued") return "排队中";
  if (check.status === "waiting") return "等待中";
  if (check.status === "in-progress" || check.conclusion === null) return "运行中";
  return CONCLUSION_LABEL[check.conclusion];
}

/** Failing first, then running, then passing; stable by name within a group. */
export function groupChecks(checks: readonly PullRequestCheck[]) {
  const groups: Record<CheckGroup, PullRequestCheck[]> = { failing: [], pending: [], passing: [] };
  for (const check of checks) groups[checkGroup(check)].push(check);
  for (const group of Object.values(groups))
    group.sort((left, right) => left.name.localeCompare(right.name));
  return groups;
}

export function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1_000));
  return formatDurationCnWithHours(seconds);
}

export function checkDuration(check: PullRequestCheck, now = Date.now()): string | null {
  if (check.startedAt === null) return null;
  return formatDuration((check.completedAt ?? now) - check.startedAt);
}

export interface MergeAvailability {
  /** Why the merge button is disabled, or null when it can merge. */
  blocked: string | null;
  /** A caution that does not block merging. */
  warning: string | null;
}

/** What stands between the viewer and the merge button, in GitHub's own terms. */
export function mergeAvailability(detail: PullRequestDetail): MergeAvailability {
  const none = { blocked: null, warning: null };
  if (detail.state === "merged" || detail.state === "closed") return none;
  if (detail.state === "draft" || detail.mergeState === "draft")
    return {
      blocked: "此拉取请求仍是草稿。请先标记为可评审再合入。",
      warning: null,
    };
  if (!detail.viewer.canMerge)
    return {
      blocked: "你没有合入此仓库的权限。",
      warning: null,
    };
  if (detail.mergeable === "conflicting" || detail.mergeState === "dirty")
    return {
      blocked: `此分支与 ${detail.baseBranch} 存在冲突，需先解决。`,
      warning: null,
    };
  if (detail.mergeState === "behind")
    return {
      blocked: `此分支落后于 ${detail.baseBranch}。请先更新再合入。`,
      warning: null,
    };
  if (detail.mergeState === "blocked")
    return {
      blocked: "合入被阻止，需通过必要的评审和检查。",
      warning: null,
    };
  if (detail.mergeState === "unknown")
    return {
      blocked: "GitHub 仍在检查是否可合入。请稍后刷新。",
      warning: null,
    };
  if (detail.mergeMethods.length === 0)
    return { blocked: "此仓库不允许任何合入方式。", warning: null };
  if (detail.mergeState === "unstable")
    return {
      blocked: null,
      warning: "部分检查失败或仍在运行中，但它们不是合入所必需的。",
    };
  return none;
}

export function initials(login: string): string {
  const parts = login
    .replace(/\[bot\]$/, "")
    .split(/[-_.\s]+/)
    .filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0]![0]}${parts[1]![0]}` : login.slice(0, 2);
  return letters.toUpperCase();
}
