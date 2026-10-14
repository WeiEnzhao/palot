import { useAtom } from "jotai";
import {
  CircleAlert,
  CircleCheck,
  CircleDot,
  FileCode2,
  GitCommitHorizontal,
  LoaderCircle,
  MessageSquare,
} from "lucide-react";
import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import type {
  PullRequestDetail,
  PullRequestPerson,
  PullRequestTimelineItem,
} from "../../../shared/source-control-contract";
import {
  useAddPullRequestComment,
  usePullRequestTimeline,
  useReplyToPullRequestThread,
  useResolvePullRequestThread,
} from "../../hooks/use-source-control";
import { cn } from "../../lib/cn";
import { shortcutPlatform } from "../../lib/keyboard-shortcuts";
import { MarkdownContent } from "../markdown-content";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { refOf } from "./pull-request-actions";
import { PullRequestAvatar } from "./pull-request-person";
import { pullRequestTimelineFiltersAtom } from "./pull-request-preferences";
import { formatPullRequestTime, sourceControlErrorMessage } from "./pull-request-presentation";

type ThreadItem = Extract<PullRequestTimelineItem, { kind: "review-thread" }>;
type EventItem = Extract<PullRequestTimelineItem, { kind: "event" }>;

function itemPeople(item: PullRequestTimelineItem): Array<PullRequestPerson | null> {
  switch (item.kind) {
    case "comment":
    case "review":
    case "commit":
      return [item.author];
    case "event":
      return [item.actor];
    case "review-thread":
      return item.comments.slice(0, 1).map((comment) => comment.author);
  }
}

export function filterTimeline(
  items: readonly PullRequestTimelineItem[],
  filters: { hideBots: boolean; hideResolved: boolean },
): PullRequestTimelineItem[] {
  return items.filter((item) => {
    if (filters.hideResolved && item.kind === "review-thread" && item.isResolved) return false;
    if (filters.hideBots && itemPeople(item).some((person) => person?.isBot)) return false;
    return true;
  });
}

export function PullRequestTimelineTab({ detail }: { detail: PullRequestDetail }) {
  const ref = refOf(detail);
  const timeline = usePullRequestTimeline(ref);
  const [filters, setFilters] = useAtom(pullRequestTimelineFiltersAtom);
  const items = useMemo(
    () => timeline.data?.pages.flatMap((page) => page.items) ?? [],
    [timeline.data],
  );
  const visible = useMemo(() => filterTimeline(items, filters), [filters, items]);
  const hidden = items.length - visible.length;

  return (
    <div className="flex flex-col pb-6">
      <div className="flex flex-wrap items-center gap-1 px-4 pt-3 pb-1">
        <FilterToggle
          label="隐藏机器人"
          pressed={filters.hideBots}
          onPressedChange={(hideBots) => setFilters((current) => ({ ...current, hideBots }))}
        />
        <FilterToggle
          label="隐藏已解决"
          pressed={filters.hideResolved}
          onPressedChange={(hideResolved) =>
            setFilters((current) => ({ ...current, hideResolved }))
          }
        />
        {hidden > 0 ? (
          <span className="ml-auto text-micro text-muted-foreground tabular-nums">
            {hidden} 已隐藏
          </span>
        ) : null}
      </div>
      {timeline.error && items.length === 0 ? (
        <p
          role="alert"
          className="flex items-start gap-1.5 px-4 py-3 text-sm text-muted-foreground"
        >
          <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden="true" />
          {sourceControlErrorMessage(timeline.error)}
        </p>
      ) : timeline.isPending ? (
        <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
          正在加载动态
        </div>
      ) : visible.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">
          {items.length ? "所有条目都已被上方筛选器隐藏。" : "暂无动态。"}
        </p>
      ) : (
        <ol aria-label="时间线" className="flex flex-col">
          {visible.map((item) => (
            <li key={`${item.kind}:${item.id}`} className="px-4">
              <TimelineEntry item={item} detail={detail} />
            </li>
          ))}
        </ol>
      )}
      {timeline.hasNextPage ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mx-3 mt-1 self-start text-muted-foreground"
          disabled={timeline.isFetchingNextPage}
          onClick={() => void timeline.fetchNextPage()}
        >
          {timeline.isFetchingNextPage ? (
            <LoaderCircle data-icon="inline-start" className="animate-spin" aria-hidden="true" />
          ) : null}
          加载更新的动态
        </Button>
      ) : null}
      <CommentComposer detail={detail} />
    </div>
  );
}

function FilterToggle({
  label,
  pressed,
  onPressedChange,
}: {
  label: string;
  pressed: boolean;
  onPressedChange(pressed: boolean): void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      aria-pressed={pressed}
      className={cn("text-muted-foreground", pressed && "bg-muted text-foreground")}
      onClick={() => onPressedChange(!pressed)}
    >
      {label}
    </Button>
  );
}

function TimelineEntry({
  item,
  detail,
}: {
  item: PullRequestTimelineItem;
  detail: PullRequestDetail;
}) {
  switch (item.kind) {
    case "comment":
      return (
        <EntryShell person={item.author} at={item.createdAt} action="commented">
          <MarkdownContent value={item.body} baseUrl={item.url} className="mt-1 text-sm" />
        </EntryShell>
      );
    case "review":
      return (
        <EntryShell
          person={item.author}
          at={item.submittedAt}
          action={REVIEW_ACTION[item.state]}
          tone={
            item.state === "approved"
              ? "text-success"
              : item.state === "changes-requested"
                ? "text-destructive"
                : undefined
          }
        >
          {item.body.trim() ? (
            <MarkdownContent value={item.body} baseUrl={item.url} className="mt-1 text-sm" />
          ) : null}
        </EntryShell>
      );
    case "review-thread":
      return <ReviewThread thread={item} detail={detail} />;
    case "commit":
      return (
        <CompactEntry icon={<GitCommitHorizontal aria-hidden="true" />} at={item.createdAt}>
          <span className="font-mono text-muted-foreground">{item.oid.slice(0, 7)}</span>{" "}
          <span className="text-foreground/90">{item.message.split("\n")[0]}</span>
          {item.author ? <span> · {item.author.login}</span> : null}
        </CompactEntry>
      );
    case "event":
      return (
        <CompactEntry icon={<CircleDot aria-hidden="true" />} at={item.createdAt}>
          <span className="text-foreground/90">{item.actor?.login ?? "Someone"}</span>{" "}
          {eventSentence(item)}
        </CompactEntry>
      );
  }
}

const REVIEW_ACTION: Record<Extract<PullRequestTimelineItem, { kind: "review" }>["state"], string> =
  {
    approved: "批准了这些更改",
    "changes-requested": "请求了更改",
    commented: "已评审",
    dismissed: "评审已被撤销",
  };

export function eventSentence(item: EventItem): string {
  switch (item.type) {
    case "merged":
      return "合并了此拉取请求";
    case "closed":
      return "关闭了此拉取请求";
    case "reopened":
      return "重新打开了此拉取请求";
    case "ready-for-review":
      return "标记为准备评审";
    case "converted-to-draft":
      return "将此转为草稿";
    case "review-requested":
      return item.detail ? `请求 ${item.detail} 进行评审` : "请求了评审";
    case "labeled":
      return item.detail ? `添加了 ${item.detail} 标签` : "添加了标签";
    case "unlabeled":
      return item.detail ? `移除了 ${item.detail} 标签` : "移除了标签";
    case "force-pushed":
      return "强制推送了分支";
    case "head-ref-deleted":
      return "删除了分支";
    case "renamed":
      return item.detail ? `将此重命名为"${item.detail}"` : "重命名了此拉取请求";
  }
}

function EntryShell({
  person,
  at,
  action,
  tone,
  children,
}: {
  person: PullRequestPerson | null;
  at: number;
  action: string;
  tone?: string;
  children?: ReactNode;
}) {
  return (
    <article className="flex min-w-0 gap-2.5 border-t border-border/50 py-3">
      <PullRequestAvatar person={person} className="mt-px" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-meta">
          <span className="font-medium text-foreground">{person?.login ?? "ghost"}</span>
          <span className={cn("text-muted-foreground", tone)}>{action}</span>
          <time
            className="ml-auto text-muted-foreground tabular-nums"
            dateTime={new Date(at).toISOString()}
            title={new Date(at).toLocaleString()}
          >
            {formatPullRequestTime(at)}
          </time>
        </div>
        {children}
      </div>
    </article>
  );
}

function CompactEntry({
  icon,
  at,
  children,
}: {
  icon: ReactNode;
  at: number;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-7 min-w-0 items-center gap-2.5 py-1 text-meta text-muted-foreground [&>svg]:size-3.5 [&>svg]:shrink-0">
      <span className="flex w-5 shrink-0 justify-center [&>svg]:size-3.5">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <time className="shrink-0 tabular-nums" dateTime={new Date(at).toISOString()}>
        {formatPullRequestTime(at)}
      </time>
    </div>
  );
}

function hunkExcerpt(hunk: string, lines = 6): string {
  const all = hunk.split("\n").filter((line) => !line.startsWith("@@"));
  return all.slice(-lines).join("\n");
}

function ReviewThread({ thread, detail }: { thread: ThreadItem; detail: PullRequestDetail }) {
  const resolve = useResolvePullRequestThread();
  const [replying, setReplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = thread.comments[0];
  const location = `${thread.path}${thread.line !== null ? `:${thread.line}` : ""}`;
  const toggleResolved = () => {
    setError(null);
    void resolve
      .mutateAsync({ ...refOf(detail), threadID: thread.id, resolved: !thread.isResolved })
      .catch((cause: unknown) => setError(sourceControlErrorMessage(cause)));
  };
  return (
    <article
      aria-label={`评审线程：${location}`}
      className="my-2 overflow-hidden rounded-lg border border-border/70"
    >
      <header className="flex min-w-0 items-center gap-2 border-b border-border/60 bg-muted/30 px-3 py-1.5 text-meta">
        <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 truncate font-mono" title={location}>
          {location}
        </span>
        {thread.isOutdated ? (
          <span className="shrink-0 text-muted-foreground">已过时</span>
        ) : null}
        {thread.isResolved ? (
          <span className="flex shrink-0 items-center gap-1 text-success">
            <CircleCheck className="size-3" aria-hidden="true" />
            已解决
          </span>
        ) : null}
      </header>
      {first?.diffHunk ? (
        <pre className="overflow-x-auto border-b border-border/60 px-3 py-1.5 font-mono text-code-compact leading-relaxed text-muted-foreground">
          {hunkExcerpt(first.diffHunk)
            .split("\n")
            .map((line, index) => (
              <div
                key={index}
                className={cn(
                  line.startsWith("+") && "text-success",
                  line.startsWith("-") && "text-destructive",
                )}
              >
                {line || " "}
              </div>
            ))}
        </pre>
      ) : null}
      <div className="flex flex-col px-3">
        {thread.comments.map((comment, index) => (
          <div
            key={comment.id}
            className={cn("flex min-w-0 gap-2.5 py-2.5", index > 0 && "border-t border-border/40")}
          >
            <PullRequestAvatar person={comment.author} className="mt-px" />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-baseline gap-1.5 text-meta">
                <span className="font-medium">{comment.author?.login ?? "ghost"}</span>
                <time className="ml-auto text-muted-foreground tabular-nums">
                  {formatPullRequestTime(comment.createdAt)}
                </time>
              </div>
              <MarkdownContent
                value={comment.body}
                baseUrl={comment.url}
                className="mt-1 text-sm"
              />
            </div>
          </div>
        ))}
      </div>
      {replying ? (
        <div className="border-t border-border/60 p-2">
          <MarkdownComposer
            label={`回复 ${location}`}
            submitLabel="回复"
            autoFocus
            onCancel={() => setReplying(false)}
            onSubmit={() => setReplying(false)}
            threadID={thread.id}
            detail={detail}
          />
        </div>
      ) : (
        <div className="flex items-center gap-1 border-t border-border/60 px-2 py-1">
          {thread.viewerCanReply ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              onClick={() => setReplying(true)}
            >
              <MessageSquare data-icon="inline-start" aria-hidden="true" />
              回复
            </Button>
          ) : null}
          {thread.viewerCanResolve ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              disabled={resolve.isPending}
              onClick={toggleResolved}
            >
              {thread.isResolved ? "取消解决" : "解决"}
            </Button>
          ) : null}
          {error ? (
            <span
              role="alert"
              className="ml-auto truncate text-micro text-destructive"
              title={error}
            >
              {error}
            </span>
          ) : null}
        </div>
      )}
    </article>
  );
}

function CommentComposer({ detail }: { detail: PullRequestDetail }) {
  return (
    <div className="mx-4 mt-4 border-t border-border/60 pt-4">
      <MarkdownComposer label="添加评论" submitLabel="评论" detail={detail} />
    </div>
  );
}

/** Markdown textarea; Mod+Enter submits. Comments the PR, or replies to `threadID`. */
function MarkdownComposer({
  label,
  submitLabel,
  detail,
  threadID,
  autoFocus,
  onSubmit,
  onCancel,
}: {
  label: string;
  submitLabel: string;
  detail: PullRequestDetail;
  threadID?: string;
  autoFocus?: boolean;
  onSubmit?(): void;
  onCancel?(): void;
}) {
  const comment = useAddPullRequestComment();
  const reply = useReplyToPullRequestThread();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pending = comment.isPending || reply.isPending;
  const mac = shortcutPlatform() === "mac";
  const submit = () => {
    const text = body.trim();
    if (!text || pending) return;
    setError(null);
    const request = threadID
      ? reply.mutateAsync({ ...refOf(detail), threadID, body: text })
      : comment.mutateAsync({ ...refOf(detail), body: text });
    void request
      .then(() => {
        setBody("");
        onSubmit?.();
      })
      .catch((cause: unknown) => setError(sourceControlErrorMessage(cause)));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (mac ? event.metaKey : event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
    if (event.key === "Escape" && onCancel) {
      event.preventDefault();
      onCancel();
    }
  };
  return (
    <form
      className="flex flex-col gap-2"
      aria-label={label}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Textarea
        aria-label={label}
        placeholder="用 Markdown 写评论"
        value={body}
        autoFocus={autoFocus}
        disabled={pending}
        className="min-h-20"
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {error ? (
        <p role="alert" className="flex items-start gap-1.5 text-meta text-destructive">
          <CircleAlert className="mt-px size-3 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-1">
        <span className="mr-auto text-micro text-muted-foreground">
          {mac ? "⌘↵" : "Ctrl+Enter"} 发送
        </span>
        {onCancel ? (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            取消
          </Button>
        ) : null}
        <Button type="submit" size="sm" disabled={pending || !body.trim()}>
          {pending ? (
            <LoaderCircle data-icon="inline-start" className="animate-spin" aria-hidden="true" />
          ) : null}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
