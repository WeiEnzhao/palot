import { ChevronDown, ChevronRight, LoaderCircle, RotateCcw } from "lucide-react";
import { createContext, useContext, useEffect, useState } from "react";
import type { PalotMessageContent } from "../../../shared";
import { cn } from "../../lib/cn";
import { formatDurationCn } from "../../lib/format-duration";
import { BoundedScroll } from "./bounded-scroll";
import { estimateTokens, formatTokenCount } from "../../lib/context-usage";
import type { TurnActivityGroup } from "../../lib/turn-projection";
import { CompactionUsage } from "../compaction-usage";
import { MarkdownContent } from "../markdown-content";
import { ThinkingShimmer } from "../thinking-shimmer";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";

/** Running compactions mention their expected duration after this delay. */
export const COMPACTION_SLOW_HINT_MS = 10_000;

export interface CompactionWindow {
  /** Context window at the last measured step before the compaction. */
  before: number | null;
  /** Context window at the first measured step after it; null until the next reply. */
  after: number | null;
}

/**
 * Transcript-level facts a compaction row cannot derive from its own part.
 * Without a provider (tests, history dialogs) rows render read-only.
 */
export interface CompactionTranscriptActions {
  /** The newest compaction in the transcript when it failed and the task is idle. */
  retryableCompactionID: string | null;
  retry(): Promise<void>;
  /** Measured context windows around each compaction, keyed by compaction message ID. */
  windows?: ReadonlyMap<string, CompactionWindow>;
}

export const CompactionTranscriptContext = createContext<CompactionTranscriptActions | null>(null);

export function compactionLabel(
  part: Pick<PalotMessageContent, "reason" | "time"> | undefined,
  status: TurnActivityGroup["status"],
  startedAt: number | undefined,
  completedAt: number | undefined,
): string {
  if (status === "failed") return "上下文压缩失败";
  if (status === "running" || status === "pending") return "正在压缩上下文";
  const base = part?.reason === "auto" ? "上下文已自动压缩" : "上下文已压缩";
  const pieces = [base];
  // 展示压缩耗时；历史回放没有起止时间时只剩基础文案。
  if (startedAt !== undefined && completedAt !== undefined && completedAt > startedAt) {
    const durationSeconds = (completedAt - startedAt) / 1000;
    pieces.push(`耗时 ${formatDurationCn(durationSeconds, { hideZeroSeconds: true })}`);
  }
  return pieces.join(" · ");
}

/**
 * Context size around a compaction. Measured windows from the surrounding
 * steps win; otherwise estimate from the compaction request: before is what
 * the summarizer read, after is the summary plus the verbatim recent tail.
 */
export function compactionTokenChange(
  part: PalotMessageContent | undefined,
  measured?: CompactionWindow,
): { before: number; after: number; estimated: boolean } | null {
  if (measured?.before && measured.after !== null && measured.after !== undefined) {
    return { before: measured.before, after: measured.after, estimated: false };
  }
  const usage = part?.type === "compaction" ? part.tokens : undefined;
  if (!usage) return null;
  const before = usage.input + usage.cache.read + usage.cache.write;
  const after = usage.output + estimateTokens(part?.recent?.trim() ?? "");
  if (before <= 0) return null;
  return { before, after, estimated: true };
}

function useSlowHint(running: boolean, startedAt: number | undefined): boolean {
  const [mountedAt] = useState(() => Date.now());
  const since = startedAt ?? mountedAt;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const due = since + COMPACTION_SLOW_HINT_MS;
    if (now >= due) return;
    const timer = window.setTimeout(
      () => setNow(Math.max(Date.now(), due)),
      Math.max(0, due - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [now, running, since]);

  return running && now - since >= COMPACTION_SLOW_HINT_MS;
}

export function CompactionBoundary({ group }: { group: TurnActivityGroup }) {
  const [open, setOpen] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const actions = useContext(CompactionTranscriptContext);
  const entry = group.entries.find((candidate) => candidate.part.type === "compaction");
  const part = entry?.part;
  const failed = group.status === "failed";
  const running = group.status === "running" || group.status === "pending";
  const slow = useSlowHint(running, part?.time?.created);
  const label = compactionLabel(part, group.status, group.startedAt, group.completedAt);
  const error = part?.error?.trim();
  const summary = part?.text?.trim();
  const recent = part?.recent?.trim();
  const recentTokens = recent ? Math.round(recent.length / 4) : 0;
  const recentLabel = `最近上下文中约 ${recentTokens.toLocaleString()} 个 token 保留原文`;
  const anchorID = entry?.message.id ?? part?.id ?? group.id;
  const change =
    failed || running ? null : compactionTokenChange(part, actions?.windows?.get(anchorID));
  const hasDetails = Boolean(
    summary || recent || error || change || part?.cost !== undefined || part?.tokens,
  );
  const retry = failed && actions?.retryableCompactionID === anchorID ? actions.retry : null;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="my-3 min-w-0 scroll-mt-16"
      data-palot-compaction={anchorID}
      data-palot-compaction-status={group.status}
      data-palot-compaction-reason={part?.reason ?? "unknown"}
    >
      <div
        className={cn(
          "flex items-center gap-3 text-xs",
          failed ? "text-destructive" : "text-foreground/66",
        )}
      >
        <span className="h-px min-w-6 flex-1 bg-border/70" aria-hidden="true" />
        <CollapsibleTrigger
          disabled={!hasDetails}
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                "h-7 min-w-0 px-1.5 text-xs font-normal hover:bg-transparent aria-expanded:bg-transparent",
                failed
                  ? "text-destructive hover:text-destructive"
                  : "text-foreground/66 hover:text-muted-foreground",
              )}
            />
          }
        >
          {running ? <ThinkingShimmer>{label}</ThinkingShimmer> : <span>{label}</span>}
          {running && slow ? (
            <span className="min-w-0 truncate text-foreground/62">
              · 这可能需要几分钟
            </span>
          ) : null}
          {hasDetails ? (
            open ? (
              <ChevronDown data-icon="inline-end" aria-hidden="true" />
            ) : (
              <ChevronRight data-icon="inline-end" aria-hidden="true" />
            )
          ) : null}
        </CollapsibleTrigger>
        {retry ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="重试压缩"
            disabled={retrying}
            onClick={() => {
              setRetrying(true);
              void retry().finally(() => setRetrying(false));
            }}
          >
            {retrying ? (
              <LoaderCircle
                data-icon="inline-start"
                className="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <RotateCcw data-icon="inline-start" aria-hidden="true" />
            )}
            重试
          </Button>
        ) : null}
        <span className="h-px min-w-6 flex-1 bg-border/70" aria-hidden="true" />
      </div>
      {hasDetails ? (
        <CollapsibleContent className="mx-auto mt-1.5 max-w-3xl">
          <BoundedScroll
            className="rounded-lg border border-border/50 bg-muted/15"
            viewportClassName="max-h-[32rem] px-3 py-2.5"
          >
            {change ? (
              <p className="m-0 mb-1 text-meta text-muted-foreground" data-palot-compaction-tokens>
                {`上下文：${change.estimated ? "约 " : ""}${formatTokenCount(change.before)} → ${formatTokenCount(change.after)} 个 token`}
              </p>
            ) : null}
            <CompactionUsage part={part} />
            {error ? <p className="m-0 text-xs/relaxed text-destructive">{error}</p> : null}
            {summary ? (
              <MarkdownContent value={summary} className="text-xs/relaxed text-foreground/75" />
            ) : null}
            {recent ? (
              <Collapsible
                open={recentOpen}
                onOpenChange={setRecentOpen}
                className={cn(summary || error ? "mt-2 border-t border-border/40 pt-2" : undefined)}
              >
                <CollapsibleTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 max-w-full justify-start px-0 text-xs font-normal text-muted-foreground hover:bg-transparent hover:text-foreground aria-expanded:bg-transparent"
                    />
                  }
                >
                  <span className="min-w-0 truncate text-left">{recentLabel}</span>
                  {recentOpen ? (
                    <ChevronDown data-icon="inline-end" aria-hidden="true" />
                  ) : (
                    <ChevronRight data-icon="inline-end" aria-hidden="true" />
                  )}
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-1">
                  <MarkdownContent value={recent} className="text-xs/relaxed text-foreground/70" />
                </CollapsibleContent>
              </Collapsible>
            ) : null}
          </BoundedScroll>
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  );
}
