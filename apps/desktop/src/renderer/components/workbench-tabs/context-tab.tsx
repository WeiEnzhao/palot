import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, CornerDownRight, RefreshCw, Trash2 } from "lucide-react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { PalotSession } from "../../../shared";
import { contextMessageTargetAtom, transcriptJumpTargetAtom } from "../../atoms/workbench";
import { runtimeAtom } from "../../atoms/workspace";
import { useModelCatalog } from "../../hooks/use-model-catalog";
import { useCatalogSession } from "../../hooks/use-session-catalog";
import { useSessionTranscript } from "../../hooks/use-session-transcript";
import { likelyCacheBusts } from "../../lib/cache-bust";
import { cn } from "../../lib/cn";
import {
  compactionHistory,
  contextStatus,
  describeContextEntry,
  describeContextUsage,
  describeInstructionEntry,
  findContextModel,
  formatAgo,
  formatTokenCount,
  formatTokenExact,
  formatUpdated,
  formatUsd,
  getContextUsage,
  sumTokens,
  type CompactionRecord,
  type InstructionEntryView,
} from "../../lib/context-usage";
import {
  readDiagnosticsPreferences,
  subscribeDiagnosticsPreferences,
} from "../../lib/diagnostics-preferences";
import { openCodeKeys } from "../../lib/opencode-query";
import { showErrorToast } from "../../lib/toast-error";
import type { WorkbenchTab } from "../../lib/workbench-tabs";
import { palot } from "../../services/palot";
import { ContextBar, ContextLegend } from "../context-meter";
import { useArmedConfirm } from "../pull-requests/use-armed-confirm";
import { SettingsDisclosure, SettingsFacts, SettingsSection } from "../settings-layout";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../ui/accordion";
import { Badge } from "../ui/badge";
import { Banner } from "../ui/banner";
import { Button } from "../ui/button";
import { CopyField } from "../ui/copy-field";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { ScrollArea } from "../ui/scroll-area";
import { Spinner } from "../ui/spinner";

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const STATUS_TEXT = {
  unavailable: "text-foreground",
  normal: "text-foreground",
  warning: "text-warning",
  critical: "text-destructive",
} as const;

export function ContextTab({
  tab,
  active = true,
}: {
  tab: Extract<WorkbenchTab, { kind: "context" }>;
  active?: boolean;
}) {
  const session = useCatalogSession(tab.resource.sessionID);

  if (!session) {
    return (
      <Empty className="rounded-none p-5">
        <EmptyHeader>
          <EmptyTitle>上下文不可用</EmptyTitle>
          <EmptyDescription>
            此会话在会话目录中不再可用。
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return <SessionContext session={session} active={active} />;
}

/** Re-renders relative times while the tab is visible. */
function useNow(active: boolean, intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [active, intervalMs]);
  return now;
}

function SessionContext({ session, active }: { session: PalotSession; active: boolean }) {
  const transcript = useSessionTranscript(session);
  const modelCatalog = useModelCatalog(session.location, active);
  const models = modelCatalog.data?.models ?? [];
  const providers = modelCatalog.data?.providers ?? [];
  const messages = transcript.messages;
  const now = useNow(active);
  const usage = useMemo(() => getContextUsage(messages, models), [messages, models]);
  const compactions = useMemo(() => compactionHistory(messages), [messages]);
  const setJumpTarget = useSetAtom(transcriptJumpTargetAtom);
  const [messageTarget, setMessageTarget] = useAtom(contextMessageTargetAtom);
  const diagnosticsPreferences = useSyncExternalStore(
    subscribeDiagnosticsPreferences,
    readDiagnosticsPreferences,
  );
  const [diagnosticsRequested, setDiagnosticsRequested] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const showDiagnostics = diagnosticsPreferences.overlayVisible || diagnosticsRequested;
  const [diagnosticTarget, setDiagnosticTarget] = useState<string | null>(null);

  useEffect(() => {
    if (messageTarget?.sessionID !== session.id) return;
    // A timeline cache warning asked for this record: reveal diagnostics for it.
    setDiagnosticsRequested(true);
    setDiagnosticsOpen(true);
    setDiagnosticTarget(messageTarget.messageID);
    setMessageTarget(null);
  }, [messageTarget, session.id, setMessageTarget]);

  if (transcript.isPending && messages.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
        <Spinner /> 正在加载上下文
      </div>
    );
  }

  if (transcript.error && messages.length === 0) {
    return (
      <Empty className="rounded-none p-5">
        <EmptyHeader>
          <EmptyTitle>无法加载上下文</EmptyTitle>
          <EmptyDescription>{transcript.error.message}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const modelRef = usage?.model ?? session.model;
  const model = findContextModel(models, modelRef);
  const provider = providers.find((candidate) => candidate.id === modelRef?.providerID);
  const modelLabel = model?.name ?? modelRef?.id ?? "未知模型";
  const wording = usage && !usage.compacted ? describeContextUsage(usage) : null;
  const status = contextStatus(usage && !usage.compacted ? usage.percentage : null);
  const processed = sumTokens(session.tokens);

  return (
    <ScrollArea className="@container min-h-0 flex-1 bg-background">
      <div className="flex min-w-0 flex-col gap-8 px-5 pt-4 pb-10 @min-[42rem]:px-6">
        <SettingsSection
          title="窗口"
          action={
            usage ? (
              <span className="text-meta text-muted-foreground">
                {formatUpdated(usage.updatedAt, now)}
              </span>
            ) : null
          }
        >
          <div className="flex min-w-0 flex-col gap-3">
            {usage?.compacted ? (
              <Banner status="info" title="上下文已压缩">
                窗口将在下一次回复后更新。
              </Banner>
            ) : usage && wording ? (
              <div className="flex min-w-0 flex-col gap-2">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <p className={cn("m-0 text-sm font-medium", STATUS_TEXT[status])}>
                    {wording.summary}
                  </p>
                  <p className="m-0 text-meta text-muted-foreground tabular-nums">
                    {wording.detail}
                  </p>
                </div>
                <ContextBar breakdown={usage.breakdown} limit={usage.limit} size="lg" />
                <ContextLegend breakdown={usage.breakdown} exact />
              </div>
            ) : (
              <p className="m-0 text-compact text-muted-foreground">
                尚无模型回复。窗口将在首次回复后出现。
              </p>
            )}
            <SettingsFacts
              layout="columns"
              facts={[
                {
                  label: "模型",
                  value: provider ? `${modelLabel} · ${provider.name}` : modelLabel,
                },
                {
                  label: "窗口",
                  value: model?.contextLimit
                    ? `${formatTokenExact(model.contextLimit)} tokens`
                    : "未知",
                },
                {
                  label: "会话费用",
                  value: (
                    <span className="text-sm font-semibold tabular-nums">
                      {session.cost === null ? "不可用" : formatUsd(session.cost)}
                    </span>
                  ),
                },
                { label: "已处理总计", value: `${formatTokenCount(processed)} tokens` },
              ]}
            />
          </div>
        </SettingsSection>

        <ActiveContextSection session={session} active={active} />

        <InstructionsSection session={session} active={active} />

        <SettingsSection
          title="压缩历史"
          description="每次压缩都会用摘要替换较早的历史记录。"
        >
          <div className="flex min-w-0 flex-col gap-3">
            {compactions.length > 0 ? (
              <ol
                className="m-0 list-none overflow-hidden rounded-xl border border-border bg-card p-0"
                aria-label="压缩"
              >
                {compactions.toReversed().map((record) => (
                  <CompactionRow
                    key={record.messageID}
                    record={record}
                    now={now}
                    onJump={(messageID) => setJumpTarget({ sessionID: session.id, messageID })}
                  />
                ))}
              </ol>
            ) : (
              <p className="m-0 text-compact text-muted-foreground">
                {transcript.hasNextPage
                  ? "已加载的历史中没有压缩记录。"
                  : "此任务尚未被压缩。"}
              </p>
            )}
            {transcript.hasNextPage ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="self-start"
                disabled={transcript.isFetchingNextPage}
                onClick={() => void transcript.fetchNextPage()}
              >
                {transcript.isFetchingNextPage ? <Spinner /> : <RefreshCw aria-hidden="true" />}
                加载更早的历史
              </Button>
            ) : null}
            <SettingsDisclosure
              title="会话总计"
              description="此任务中所有模型调用处理的所有 token。"
            >
              <div className="px-4 py-3">
                <SettingsFacts
                  facts={[
                    { label: "未缓存输入", value: formatTokenExact(session.tokens.input) },
                    { label: "缓存读取", value: formatTokenExact(session.tokens.cache.read) },
                    { label: "缓存写入", value: formatTokenExact(session.tokens.cache.write) },
                    { label: "输出", value: formatTokenExact(session.tokens.output) },
                    { label: "推理", value: formatTokenExact(session.tokens.reasoning) },
                    { label: "总计", value: formatTokenExact(processed) },
                    {
                      label: "费用",
                      value: session.cost === null ? "不可用" : formatUsd(session.cost),
                    },
                  ]}
                />
              </div>
            </SettingsDisclosure>
          </div>
        </SettingsSection>

        {showDiagnostics ? (
          <DeveloperDiagnostics
            transcript={transcript}
            open={diagnosticsOpen}
            onOpenChange={setDiagnosticsOpen}
            target={diagnosticTarget}
            onTargetHandled={() => setDiagnosticTarget(null)}
          />
        ) : null}
      </div>
    </ScrollArea>
  );
}

function CompactionRow({
  record,
  now,
  onJump,
}: {
  record: CompactionRecord;
  now: number;
  onJump(messageID: string): void;
}) {
  const label = record.reason === "auto" ? "自动" : record.reason === "manual" ? "手动" : "";
  const sizes =
    record.status === "completed"
      ? `${record.before === null ? "未知" : formatTokenCount(record.before)} → ${
          record.after === null ? "下一次回复后" : formatTokenCount(record.after)
        } tokens`
      : record.status === "failed"
        ? (record.error ?? "压缩失败")
        : "正在总结较早的历史…";
  return (
    <li
      className="flex min-w-0 items-center gap-3 border-b border-border px-3 py-2.5 last:border-b-0"
      aria-label={`${label || "压缩"} ${formatAgo(record.at, now)}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-compact">
          <span className="font-medium">{label || "压缩"}</span>
          <span className="text-muted-foreground" title={DATE_FORMATTER.format(record.at)}>
            {formatAgo(record.at, now)}
          </span>
          {record.status === "failed" ? (
            <Badge variant="destructive" size="sm">
              失败
            </Badge>
          ) : record.status === "running" ? (
            <Badge variant="info" size="sm">
              运行中
            </Badge>
          ) : null}
        </div>
        <div
          className={cn(
            "mt-0.5 truncate text-meta tabular-nums",
            record.status === "failed" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {sizes}
          {record.cost !== null ? ` · ${formatUsd(record.cost)}` : ""}
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`跳转到${formatAgo(record.at, now)}的${(label || "压缩").toLowerCase()}压缩`}
        onClick={() => onJump(record.messageID)}
      >
        <CornerDownRight aria-hidden="true" />
        跳转到
      </Button>
    </li>
  );
}

function ActiveContextSection({ session, active }: { session: PalotSession; active: boolean }) {
  const runtime = useAtomValue(runtimeAtom);
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState(false);
  const context = useQuery({
    queryKey: openCodeKeys.sessionContext(runtime?.connectionID ?? "disconnected", session.id),
    queryFn: ({ signal }) => palot.loadSessionContext(session.id, runtime?.connectionID, signal),
    enabled: runtime?.connected === true && active && open,
    staleTime: 30_000,
  });
  const entries = useMemo(() => (context.data ?? []).map(describeContextEntry), [context.data]);
  const estimated = entries.reduce((sum, entry) => sum + entry.tokens, 0);

  return (
    <SettingsDisclosure
      title="模型所见"
      description="压缩后 OpenCode 为下一次模型调用保留的消息。"
      open={open}
      onOpenChange={setOpen}
    >
      <div className="flex min-w-0 flex-col gap-2 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-meta text-muted-foreground tabular-nums">
            {context.data
              ? `${entries.length} 条消息 · 约 ${formatTokenCount(estimated)} tokens`
              : null}
          </span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-pressed={raw}
              onClick={() => setRaw((value) => !value)}
            >
              查看原始数据
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={context.isFetching}
              onClick={() => void context.refetch()}
            >
              {context.isFetching ? <Spinner /> : <RefreshCw aria-hidden="true" />}
              刷新
            </Button>
          </div>
        </div>
        {context.error ? (
          <p className="m-0 text-compact text-destructive">无法加载模型所见内容。</p>
        ) : !context.data ? (
          <p className="m-0 text-compact text-muted-foreground">{open ? "正在加载…" : null}</p>
        ) : entries.length === 0 ? (
          <p className="m-0 text-compact text-muted-foreground">上下文中尚无消息。</p>
        ) : raw ? (
          <pre className="m-0 max-h-[32rem] overflow-auto rounded-md border border-border/70 bg-background p-3 font-mono text-code-compact/relaxed whitespace-pre-wrap break-words text-foreground/75 select-text">
            {JSON.stringify(context.data, null, 2)}
          </pre>
        ) : (
          <ol className="m-0 list-none p-0" aria-label="上下文中的消息">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="flex min-w-0 items-baseline gap-2 border-b border-border/60 py-1.5 last:border-b-0"
              >
                <span className="w-20 shrink-0 text-meta font-medium">{entry.role}</span>
                {entry.summary ? (
                  <Badge variant="info" size="sm">
                    摘要
                  </Badge>
                ) : null}
                <span className="min-w-0 flex-1 truncate text-compact text-muted-foreground">
                  {entry.preview}
                </span>
                <span
                  className="shrink-0 text-meta text-muted-foreground tabular-nums"
                  title="粗略估计"
                >
                  {entry.tokens > 0 ? `~${formatTokenCount(entry.tokens)}` : ""}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </SettingsDisclosure>
  );
}

function InstructionsSection({ session, active }: { session: PalotSession; active: boolean }) {
  const runtime = useAtomValue(runtimeAtom);
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState<string | null>(null);
  const connectionKey = runtime?.connectionID ?? "disconnected";
  const entries = useQuery({
    queryKey: openCodeKeys.sessionInstructionEntries(connectionKey, session.id),
    queryFn: ({ signal }) =>
      palot.listSessionInstructionEntries(session.id, runtime?.connectionID, signal),
    enabled: runtime?.connected === true && active,
    staleTime: 30_000,
  });
  const views = useMemo(() => (entries.data ?? []).map(describeInstructionEntry), [entries.data]);

  const remove = useCallback(
    async (key: string) => {
      if (removing) return;
      setRemoving(key);
      try {
        await palot.removeSessionInstructionEntry(session.id, key, runtime?.connectionID);
        await queryClient.invalidateQueries({
          queryKey: openCodeKeys.sessionInstructionEntries(connectionKey, session.id),
        });
        await queryClient.invalidateQueries({
          queryKey: openCodeKeys.sessionContext(connectionKey, session.id),
        });
      } catch (error) {
        showErrorToast("无法移除指令", error);
      } finally {
        setRemoving(null);
      }
    },
    [connectionKey, queryClient, removing, runtime?.connectionID, session.id],
  );

  return (
    <SettingsSection
      title="指令与规则"
      description="附加到此任务的额外指令。OpenCode 会在每次模型调用中包含它们。"
    >
      {entries.error ? (
        <p className="m-0 text-compact text-destructive">无法加载指令。</p>
      ) : views.length > 0 ? (
        <ul
          className="m-0 list-none overflow-hidden rounded-xl border border-border bg-card p-0"
          aria-label="指令"
        >
          {views.map((view) => (
            <InstructionRow
              key={view.key}
              view={view}
              removing={removing === view.key}
              disabled={removing !== null}
              onRemove={() => void remove(view.key)}
            />
          ))}
        </ul>
      ) : (
        <p className="m-0 text-compact text-muted-foreground">
          {entries.isPending && runtime?.connected
            ? "正在加载指令…"
            : "此任务未附加任何指令。"}
        </p>
      )}
    </SettingsSection>
  );
}

function InstructionRow({
  view,
  removing,
  disabled,
  onRemove,
}: {
  view: InstructionEntryView;
  removing: boolean;
  disabled: boolean;
  onRemove(): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const confirm = useArmedConfirm(onRemove);
  return (
    <li
      className="flex min-w-0 flex-col gap-2 border-b border-border px-3 py-2.5 last:border-b-0"
      aria-label={view.title}
    >
      <div className="flex min-w-0 items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          <span className="text-compact font-medium">{view.title}</span>
          <Badge variant="neutral" size="sm">
            {view.source}
          </Badge>
        </div>
        <Button
          type="button"
          variant={confirm.armed ? "destructive" : "ghost"}
          size="sm"
          disabled={disabled}
          aria-label={confirm.armed ? `确认移除 ${view.title}` : `移除 ${view.title}`}
          {...confirm.buttonProps}
        >
          {removing ? <Spinner /> : <Trash2 aria-hidden="true" />}
          {confirm.armed ? "确认" : "移除"}
        </Button>
      </div>
      {view.path ? <CopyField label="路径" value={view.path} /> : null}
      {expanded ? (
        <pre className="m-0 max-h-80 overflow-auto rounded-md border border-border/70 bg-background p-2.5 font-mono text-code-compact/relaxed whitespace-pre-wrap break-words text-foreground/80 select-text">
          {view.text}
        </pre>
      ) : (
        <p className="m-0 line-clamp-3 text-compact text-muted-foreground">{view.preview}</p>
      )}
      <Button
        type="button"
        variant="link"
        size="xs"
        className="self-start px-0"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? "收起" : "显示全文"}
      </Button>
    </li>
  );
}

type Transcript = ReturnType<typeof useSessionTranscript>;

function DeveloperDiagnostics({
  transcript,
  open,
  onOpenChange,
  target,
  onTargetHandled,
}: {
  transcript: Transcript;
  open: boolean;
  onOpenChange(open: boolean): void;
  target: string | null;
  onTargetHandled(): void;
}) {
  const messages = transcript.messages;
  const cacheBusts = useMemo(() => likelyCacheBusts(messages), [messages]);
  const [sections, setSections] = useState<string[]>([]);
  const [expandedMessageIDs, setExpandedMessageIDs] = useState<string[]>([]);

  const openRawMessage = useCallback((messageID: string) => {
    setSections((current) => (current.includes("projected") ? current : [...current, "projected"]));
    setExpandedMessageIDs((current) =>
      current.includes(messageID) ? current : [...current, messageID],
    );
    requestAnimationFrame(() => {
      document.getElementById(`context-message-${messageID}`)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }, []);

  useEffect(() => {
    if (!target) return;
    openRawMessage(target);
    onTargetHandled();
  }, [onTargetHandled, openRawMessage, target]);

  return (
    <SettingsDisclosure
      title="开发者诊断"
      description="派生的缓存信号和 Palot 映射的消息记录。"
      open={open}
      onOpenChange={onOpenChange}
    >
      <div className="p-3">
        <Accordion
          multiple
          value={sections}
          onValueChange={setSections}
          className="min-w-0 bg-card"
        >
          <AccordionItem value="cache">
            <AccordionTrigger className="px-3 py-2.5 text-xs hover:no-underline">
              缓存诊断
            </AccordionTrigger>
            <AccordionContent className="px-1 pb-1">
              {sections.includes("cache") ? (
                cacheBusts.length > 0 ? (
                  <div className="overflow-hidden rounded-lg border border-warning/30 bg-warning/6">
                    {cacheBusts.map((warning) => (
                      <div
                        key={warning.messageID}
                        className="flex items-start gap-2 border-b border-warning/20 px-3 py-2.5 text-xs last:border-b-0"
                      >
                        <CircleAlert
                          className="mt-0.5 size-3.5 shrink-0 text-warning"
                          aria-hidden="true"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">
                            可能的缓存失效：比上一步少 {formatTokenExact(warning.drop)} 个缓存 token
                          </div>
                          <button
                            type="button"
                            className="mt-0.5 block max-w-full truncate font-mono text-code-compact text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                            aria-label={`打开预测消息 ${warning.messageID}`}
                            onClick={() => openRawMessage(warning.messageID)}
                          >
                            {warning.messageID}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <DiagnosticsNote>
                    {transcript.hasNextPage
                      ? "在已加载消息中未检测到可能的缓存失效。加载更早的记录以扫描更多会话。"
                      : "在已加载的记录中未检测到可能的缓存失效。"}
                  </DiagnosticsNote>
                )
              ) : null}
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="projected">
            <AccordionTrigger className="px-3 py-2.5 hover:no-underline">
              <span className="min-w-0">
                <span className="block text-xs font-medium">预测消息记录</span>
                <span className="block text-meta font-normal text-muted-foreground">
                  从 OpenCode 记录映射的 PalotMessage 值
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent className="px-1 pb-1">
              {sections.includes("projected") ? (
                <div className="flex min-w-0 flex-col gap-2">
                  {transcript.hasNextPage ? (
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={transcript.isFetchingNextPage}
                        onClick={() => void transcript.fetchNextPage()}
                      >
                        {transcript.isFetchingNextPage ? (
                          <Spinner />
                        ) : (
                          <RefreshCw aria-hidden="true" />
                        )}
                        加载更早
                      </Button>
                    </div>
                  ) : null}
                  {transcript.isFetchNextPageError ? (
                    <p className="text-xs text-destructive">
                      无法加载更早的预测记录。
                    </p>
                  ) : null}
                  {messages.length > 0 ? (
                    <Accordion
                      multiple
                      value={expandedMessageIDs}
                      onValueChange={setExpandedMessageIDs}
                      className="min-w-0 bg-background"
                    >
                      {messages.map((message) => (
                        <AccordionItem
                          key={message.id}
                          value={message.id}
                          id={`context-message-${message.id}`}
                          data-context-message-id={message.id}
                        >
                          <AccordionTrigger className="min-w-0 items-center gap-3 px-3 py-2 text-xs hover:no-underline">
                            <span className="min-w-0 flex-1 truncate font-medium">
                              {message.type}{" "}
                              <span className="font-normal text-muted-foreground">
                                · {message.id}
                              </span>
                            </span>
                            <span className="shrink-0 pr-1 text-meta font-normal text-muted-foreground tabular-nums">
                              {DATE_FORMATTER.format(message.createdAt)}
                            </span>
                          </AccordionTrigger>
                          <AccordionContent className="px-1 pb-1">
                            {expandedMessageIDs.includes(message.id) ? (
                              <pre className="m-0 max-h-[32rem] overflow-auto rounded-md border border-border/70 bg-background p-3 font-mono text-code-compact/relaxed whitespace-pre-wrap break-words text-foreground/75 select-text">
                                {JSON.stringify(message, null, 2)}
                              </pre>
                            ) : null}
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  ) : (
                    <DiagnosticsNote>
                      预测记录将在会话开始后出现。
                    </DiagnosticsNote>
                  )}
                </div>
              ) : null}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </SettingsDisclosure>
  );
}

function DiagnosticsNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground">
      {children}
    </div>
  );
}
