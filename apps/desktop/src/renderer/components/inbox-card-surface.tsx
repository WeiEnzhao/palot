import { useEffect, useState, type ComponentProps, type ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { catalogSessionIsUnread } from "../hooks/use-session-info";
import { cn } from "../lib/cn";
import {
  inboxSessionState,
  type InboxSessionState,
  type InboxSessionView,
} from "../lib/session-inbox";
import { formatDurationCnWithHours } from "../lib/format-duration";
import { formatRelativeTime, sessionActivityAt } from "../lib/view-models";
import type { OpenCodeVcsInfo } from "../services/opencode-vcs";
import { PulseDot } from "./ui/pulse-dot";
import { sidebarItemVariants } from "./ui/sidebar-styles";

export const INBOX_CARD_ACTION_BUTTON_CLASS =
  "text-sidebar-foreground/60 hover:bg-transparent! hover:text-sidebar-foreground! focus-visible:ring-1 focus-visible:ring-sidebar-ring";

/** Presentation only: callers own navigation, editing, drag behavior and every mutation. */
export function InboxCardSurface({
  item,
  selected,
  buttonProps,
  titleEditor,
  actions,
  hint,
  connectionBadge,
  ownerLabel,
  profileID,
  pullRequest,
  grouped,
  ...props
}: ComponentProps<"div"> & {
  item: InboxSessionView;
  selected: boolean;
  /** The card sits under a project group header — hide its own project label. */
  grouped?: boolean;
  vcs?: OpenCodeVcsInfo;
  buttonProps: ComponentProps<"button">;
  titleEditor?: ReactNode;
  actions?: ReactNode;
  hint?: ReactNode;
  connectionBadge?: ReactNode;
  ownerLabel?: string;
  profileID?: string;
  /** A linked pull request marker, shown at the end of the location line. */
  pullRequest?: ReactNode;
}) {
  const unread = !selected && catalogSessionIsUnread(item.session);
  const visualState = inboxSessionState(item, unread);
  const status = item.attention
    ? item.attentionCount === 1
      ? "需要输入"
      : `需要输入 · ${item.attentionCount}`
    : item.running
      ? "工作中"
      : item.failed
        ? "已失败"
        : visualState === "unread"
          ? `新, ${formatRelativeTime(sessionActivityAt(item.session))}`
          : formatRelativeTime(sessionActivityAt(item.session));
  return (
    <div
      {...props}
      data-inbox-card
      data-profile-id={profileID}
      data-selected={selected || undefined}
      className={cn(
        "group/inbox-card relative overflow-hidden rounded-md bg-transparent transition-colors hover:bg-(--palot-sidebar-hover)",
        selected && "bg-(--palot-sidebar-selected) text-sidebar-foreground",
        props.className,
      )}
    >
      {hint}
      <button
        type="button"
        aria-label={`打开 ${item.session.title ?? "未命名任务"}, ${item.projectName}, ${status}${ownerLabel ? ` · ${ownerLabel}` : ""}`}
        {...buttonProps}
        className={cn(
          "absolute inset-0 z-0 rounded-md outline-none active:bg-(--palot-sidebar-selected) focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sidebar-ring",
          buttonProps.className,
        )}
      />
      <div
        className={cn(
          "pointer-events-none relative z-10 flex flex-col justify-center pr-3 leading-4",
          sidebarItemVariants({ density: grouped ? "single" : "rich", interactive: false, icons: "custom" }),
        )}
      >
        {grouped ? (
          <div className="flex min-w-0 items-center gap-2 text-compact transition-[padding] group-hover/inbox-card:pr-14">
            {titleEditor ?? (
              <div className="min-w-0 flex-1 truncate font-normal text-sidebar-foreground/90 transition-colors group-hover/inbox-card:text-sidebar-foreground/95">
                {item.session.title ?? "未命名任务"}
              </div>
            )}
            {item.attention || item.failed || item.running ? (
              <span
                className="size-1 shrink-0 rounded-full bg-info opacity-80"
                role="img"
                aria-label={item.attention ? "需要关注" : item.running ? "工作中" : "已失败"}
              />
            ) : null}
            {pullRequest ? <span className="shrink-0">{pullRequest}</span> : null}
          </div>
        ) : (
          <>
            <div className="flex min-w-0 items-center gap-2 text-meta text-muted-foreground">
              <span className="flex min-w-0 flex-1 items-center gap-1.5 font-medium text-sidebar-foreground/70">
                {connectionBadge}
                <span className="truncate">{item.projectName}</span>
              </span>
              {visualState === "running" ? (
                <WorkingStatus startedAt={item.runningSince} />
              ) : (
                <span
                  data-inbox-status
                  className={cn(
                    "flex shrink-0 items-center gap-1 tabular-nums transition-opacity group-hover/inbox-card:opacity-0 group-has-[:focus-visible]/inbox-card:opacity-0",
                    item.attention && "text-warning",
                    item.failed && "text-destructive",
                  )}
                >
                  <InboxStateGlyph state={visualState} />
                  {visualState === "unread" ? (
                    <span>New · {formatRelativeTime(sessionActivityAt(item.session))}</span>
                  ) : (
                    status
                  )}
                </span>
              )}
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-1.5" data-inbox-location>
          {titleEditor ?? (
            <div className="min-w-0 flex-1 truncate text-compact font-normal text-sidebar-foreground/90 transition-colors group-hover/inbox-card:text-sidebar-foreground/95">
              {item.session.title ?? "未命名任务"}
            </div>
          )}
          {pullRequest ? (
            <span className="shrink-0">{pullRequest}</span>
          ) : null}
        </div>
          </>
        )}
      </div>
      <div className="absolute top-0 right-1.5 z-20 flex items-center gap-0 opacity-0 transition-opacity group-hover/inbox-card:opacity-100 group-has-[:focus-visible]/inbox-card:opacity-100 group-has-[[data-popup-open]]/inbox-card:opacity-100">
        {actions}
      </div>
    </div>
  );
}

function WorkingStatus({ startedAt }: { startedAt: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [startedAt]);
  const duration = startedAt === null ? null : formatWorkingDuration(startedAt, now);
  return (
    <span
      data-inbox-status
      className="flex shrink-0 items-center gap-1 tabular-nums transition-opacity group-hover/inbox-card:opacity-0 group-has-[:focus-visible]/inbox-card:opacity-0"
      title={duration ? `已工作 ${duration}` : "工作中"}
    >
      <PulseDot className="size-3 [&>span]:size-1" aria-hidden="true" />
      {duration ?? "工作中"}
    </span>
  );
}

export function InboxStateGlyph({ state }: { state: InboxSessionState }) {
  if (!state) return null;
  const label =
    state === "attention"
      ? "任务需要关注"
      : state === "failed"
        ? "任务已失败"
        : state === "running"
          ? "任务正在运行"
          : "未读任务动态";
  return (
    <span
      className={cn(
        "flex size-3.5 shrink-0 items-center justify-center",
        state === "attention" && "text-warning",
        state === "failed" && "text-destructive",
      )}
      title={label}
      aria-label={label}
    >
      {state === "running" ? (
        <PulseDot className="size-3 [&>span]:size-1" aria-hidden="true" />
      ) : state === "attention" || state === "failed" ? (
        <CircleAlert className="size-3" aria-hidden="true" />
      ) : (
        <span className="size-[5px] rounded-full bg-info" aria-hidden="true" />
      )}
    </span>
  );
}

function formatWorkingDuration(startedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1_000));
  return formatDurationCnWithHours(seconds);
}
