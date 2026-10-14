import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { SessionStatsInfo, SessionStatsModelUsage } from "@opencode/client";
import type { PalotModel, PalotProvider } from "../../../shared";
import { BarChart3, RefreshCw, TriangleAlert } from "lucide-react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo, useState } from "react";
import { runtimeAtom } from "../../atoms/workspace";
import { usageRangeAtom, usageToolDetailsOpenAtom } from "../../atoms/ui";
import { useModelCatalog } from "../../hooks/use-model-catalog";
import { useSessionStats } from "../../hooks/use-session-stats";
import { useProjectCatalogState } from "../../hooks/use-session-catalog";
import { openCodeKeys } from "../../lib/opencode-query";
import {
  isUsageRangeDays,
  USAGE_RANGE_OPTIONS,
  validateUsageSearch,
  type UsageRangeDays,
} from "../../lib/route-search";
import {
  formatUsageDateRange,
  previousUsageDateRange,
  usageDateRange,
} from "../../lib/session-stats-range";
import { orderProjects, projectLocation, visibleProjects } from "../../lib/view-models";
import { ProjectSelect } from "../project-select";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group";
import { UsageActivityChart } from "./usage-activity-chart";

type ModelSort = "cost" | "tokens" | "steps";

const CURRENCY = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });
const NUMBER = new Intl.NumberFormat(undefined);
const COMPACT = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const PERCENT = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 0 });
const UPDATED = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function UsagePage() {
  const search = useRouterState({
    select: (state) => validateUsageSearch(state.location.search as Record<string, unknown>),
  });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const runtime = useAtomValue(runtimeAtom);
  const setUsageRange = useSetAtom(usageRangeAtom);
  const projectCatalog = useProjectCatalogState();
  const projects = projectCatalog.projects;
  const visible = useMemo(() => visibleProjects(orderProjects(projects, [])), [projects]);
  const selectedProject = visible.find((project) => project.id === search.projectID) ?? null;
  const modelCatalog = useModelCatalog(
    { directory: selectedProject ? projectLocation(selectedProject) : "" },
    Boolean(selectedProject),
  );
  const [rangeAnchorMs, setRangeAnchorMs] = useState(() => Date.now());
  const [freshnessNowMs, setFreshnessNowMs] = useState(() => Date.now());
  const [lastSuccessfulUpdateAt, setLastSuccessfulUpdateAt] = useState(0);
  const [modelSort, setModelSort] = useState<ModelSort>("cost");
  const [compareOpen, setCompareOpen] = useState(false);
  const [toolDetailsOpen, setToolDetailsOpen] = useAtom(usageToolDetailsOpenAtom);
  const range = useMemo(
    () => usageDateRange(search.days, rangeAnchorMs),
    [rangeAnchorMs, search.days],
  );
  const previousRange = useMemo(() => previousUsageDateRange(range), [range]);
  const projectScopeReady = !search.projectID || (projectCatalog.ready && Boolean(selectedProject));
  const summaryInput = useMemo(
    () => ({
      from: range.from,
      to: range.to,
      timezone: range.timezone,
      tools: "summary" as const,
      ...(search.projectID ? { project: search.projectID } : {}),
    }),
    [range.from, range.timezone, range.to, search.projectID],
  );
  const detailInput = useMemo(
    () => ({ ...summaryInput, tools: "detail" as const }),
    [summaryInput],
  );
  const previousInput = useMemo(
    () => ({ ...summaryInput, from: previousRange.from, to: previousRange.to }),
    [summaryInput, previousRange.from, previousRange.to],
  );
  const summary = useSessionStats(summaryInput, projectScopeReady);
  const details = useSessionStats(detailInput, toolDetailsOpen && projectScopeReady);
  const previous = useSessionStats(previousInput, compareOpen && projectScopeReady);
  const data = summary.data;
  const projectScopeError = search.projectID ? projectCatalog.error : null;
  const displayedUpdateAt = summary.dataUpdatedAt || lastSuccessfulUpdateAt;

  useEffect(() => {
    const delay = Math.max(1_000, range.to - Date.now() + 1_000);
    const timer = setTimeout(() => setRangeAnchorMs(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [range.to]);

  useEffect(() => {
    if (summary.dataUpdatedAt > 0) setLastSuccessfulUpdateAt(summary.dataUpdatedAt);
  }, [summary.dataUpdatedAt]);

  useEffect(() => {
    const timer = setInterval(() => setFreshnessNowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (projectCatalog.ready && search.projectID && !selectedProject) {
      void navigate({ to: "/usage", search: { days: search.days }, replace: true });
    }
  }, [navigate, projectCatalog.ready, search.days, search.projectID, selectedProject]);

  const updateSearch = (input: { days?: UsageRangeDays; projectID?: string | null }) =>
    navigate({
      to: "/usage",
      search: {
        days: input.days ?? search.days,
        ...((input.projectID === undefined ? search.projectID : input.projectID)
          ? { projectID: input.projectID === undefined ? search.projectID : input.projectID! }
          : {}),
      },
      replace: true,
    });

  return (
    <main
      className="palot-main-surface @container/usage relative size-full min-h-0 min-w-0 overflow-hidden bg-background"
      aria-label="用量"
    >
      <div className="window-drag h-(--shell-header-height) shrink-0" aria-hidden="true" />
      <div className="palot-native-scrollbar h-[calc(100%-var(--shell-header-height))] overflow-y-auto px-6 pb-16 @max-[42rem]/usage:px-3">
        <div className="mx-auto w-full max-w-5xl pt-5">
          <header className="mb-7 flex flex-wrap items-start gap-4 px-2">
            <div className="min-w-0 flex-1">
              <h1 className="text-page-title/tight font-medium tracking-[-0.035em]">用量</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {data
                  ? `${formatUsageDateRange({ ...data.range, timezone: range.timezone })} · ${updatedLabel(displayedUpdateAt, freshnessNowMs)}${runtime?.connected === false ? " · 已缓存" : ""}`
                  : "本地 OpenCode 活动、模型用量和工具可靠性。"}
                {(summary.isFetching || summary.isPlaceholderData) && data ? " · 更新中" : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <ProjectSelect
                projects={visible}
                value={selectedProject?.id ?? null}
                onValueChange={(projectID) => void updateSearch({ projectID })}
                ariaLabel="按项目筛选用量"
                allLabel="所有项目"
              />
              <ToggleGroup
                value={[String(search.days)]}
                onValueChange={(values) => {
                  const days = Number(values[0]);
                  if (isUsageRangeDays(days)) {
                    setUsageRange(days);
                    void updateSearch({ days });
                  }
                }}
                variant="outline"
                size="sm"
                aria-label="用量日期范围"
              >
                {USAGE_RANGE_OPTIONS.map((days) => (
                  <ToggleGroupItem
                    key={days}
                    value={String(days)}
                    aria-label={days === 1 ? "今天" : `${days} 天`}
                  >
                    {days === 1 ? "今天" : `${days}天`}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <Button
                type="button"
                variant={compareOpen ? "secondary" : "outline"}
                size="sm"
                aria-pressed={compareOpen}
                onClick={() => setCompareOpen((open) => !open)}
              >
                对比时段
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="刷新用量"
                disabled={
                  runtime?.connected !== true ||
                  summary.isFetching ||
                  (compareOpen && previous.isFetching) ||
                  (toolDetailsOpen && details.isFetching)
                }
                onClick={() => {
                  void summary.refetch();
                  if (compareOpen) void previous.refetch();
                  if (toolDetailsOpen) void details.refetch();
                  else if (runtime?.connectionID)
                    void queryClient.invalidateQueries({
                      queryKey: openCodeKeys.sessionStats(runtime.connectionID, detailInput),
                      refetchType: "none",
                    });
                }}
              >
                <RefreshCw className={summary.isFetching ? "animate-spin" : undefined} />
              </Button>
            </div>
          </header>

          {!data && runtime?.connected === false ? <UsageUnavailable /> : null}
          {!data && runtime?.connected !== false && projectScopeError ? (
            <UsageError
              message={projectScopeError.message}
              retry={() => void projectCatalog.refetch()}
            />
          ) : null}
          {!data && runtime?.connected !== false && !projectScopeError && summary.isPending ? (
            <UsageSkeleton />
          ) : null}
          {!data && runtime?.connected !== false && !projectScopeError && summary.error ? (
            <UsageError message={summary.error.message} retry={() => void summary.refetch()} />
          ) : null}
          {data ? (
            <>
              {summary.isPlaceholderData ? (
                <div
                  role="status"
                  className="mb-5 rounded-lg border border-border/70 bg-muted/35 px-3 py-2 text-xs text-muted-foreground"
                >
                  此用量范围更新时，显示上一次的选择。
                </div>
              ) : null}
              <UsageContent
                data={data}
                catalogModels={modelCatalog.data?.models ?? []}
                catalogProviders={modelCatalog.data?.providers ?? []}
                timezone={range.timezone}
                compareOpen={compareOpen}
                previousRange={previousRange}
                previousData={
                  summary.isPlaceholderData || previous.isPlaceholderData
                    ? null
                    : (previous.data ?? null)
                }
                previousLoading={
                  runtime?.connected !== false && (previous.isFetching || summary.isPlaceholderData)
                }
                previousError={previous.error?.message ?? null}
                previousOffline={runtime?.connected === false}
                retryPrevious={() => void previous.refetch()}
                modelSort={modelSort}
                onModelSortChange={setModelSort}
                toolDetailsOpen={toolDetailsOpen}
                onToolDetailsOpenChange={setToolDetailsOpen}
                detailData={details.isPlaceholderData ? null : (details.data ?? null)}
                detailPending={details.isFetching}
                detailError={details.error?.message ?? null}
                detailWaitingForConnection={
                  runtime?.connected !== true && details.isPlaceholderData
                }
                toolDetailsDisabled={
                  runtime?.connected !== true && (!details.data || details.isPlaceholderData)
                }
                detailRetryDisabled={runtime?.connected !== true}
                retryDetails={() => void details.refetch()}
              />
            </>
          ) : null}
          {data && summary.error ? (
            <Alert className="mt-5">
              <TriangleAlert aria-hidden="true" />
              <AlertTitle>显示缓存的用量</AlertTitle>
              <AlertDescription>
                最近的后台刷新失败。请刷新重试。
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
      </div>
    </main>
  );
}

function UsageContent({
  data,
  catalogModels,
  catalogProviders,
  timezone,
  compareOpen,
  previousRange,
  previousData,
  previousLoading,
  previousError,
  previousOffline,
  retryPrevious,
  modelSort,
  onModelSortChange,
  toolDetailsOpen,
  onToolDetailsOpenChange,
  detailData,
  detailPending,
  detailError,
  detailWaitingForConnection,
  toolDetailsDisabled,
  detailRetryDisabled,
  retryDetails,
}: {
  data: SessionStatsInfo;
  catalogModels: readonly PalotModel[];
  catalogProviders: readonly PalotProvider[];
  timezone: string;
  compareOpen: boolean;
  previousRange: { from: number; to: number; timezone: string };
  previousData: SessionStatsInfo | null;
  previousLoading: boolean;
  previousError: string | null;
  previousOffline: boolean;
  retryPrevious(): void;
  modelSort: ModelSort;
  onModelSortChange(value: ModelSort): void;
  toolDetailsOpen: boolean;
  onToolDetailsOpenChange(value: boolean): void;
  detailData: SessionStatsInfo | null;
  detailPending: boolean;
  detailError: string | null;
  detailWaitingForConnection: boolean;
  toolDetailsDisabled: boolean;
  detailRetryDisabled: boolean;
  retryDetails(): void;
}) {
  const modelTokens = modelTokenTotal(data.tokens);
  const models = useMemo(() => sortModels(data.models, modelSort), [data.models, modelSort]);
  const providers = useMemo(() => summarizeProviders(data.models), [data.models]);
  const toolTotals = data.tools.mode === "none" ? null : data.tools.totals;
  const toolUsage = detailData?.tools.mode === "detail" ? detailData.tools.usage : [];

  return (
    <div className="flex flex-col gap-8">
      <section className="overflow-hidden rounded-2xl border border-border/75 bg-card/55">
        <div className="grid @min-[42rem]/usage:grid-cols-2">
          <div className="border-b border-border/70 p-6 @min-[42rem]/usage:border-r">
            <div className="text-xs text-muted-foreground">报告费用</div>
            <div className="mt-2 text-4xl font-semibold tracking-[-0.05em] tabular-nums">
              {CURRENCY.format(data.cost)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              OpenCode 返回的模型费用合计
            </div>
          </div>
          <div className="border-b border-border/70 p-6">
            <div className="text-xs text-muted-foreground">模型令牌</div>
            <div className="mt-2 text-4xl font-semibold tracking-[-0.05em] tabular-nums">
              {COMPACT.format(modelTokens)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {NUMBER.format(modelTokens)} 个输入、输出和推理令牌
            </div>
          </div>
        </div>
        <div className="border-b border-border/70 p-5">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <UsageSectionHeading
              title="令牌构成"
              description="缓存活动与模型令牌总量分开报告。"
            />
            <TokenCompositionBar tokens={data.tokens} />
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 @min-[34rem]/usage:grid-cols-5">
            <UsageValue label="输入" value={COMPACT.format(data.tokens.input)} />
            <UsageValue label="输出" value={COMPACT.format(data.tokens.output)} />
            <UsageValue label="推理" value={COMPACT.format(data.tokens.reasoning)} />
            <UsageValue label="缓存读取" value={COMPACT.format(data.tokens.cache.read)} />
            <UsageValue label="缓存写入" value={COMPACT.format(data.tokens.cache.write)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 p-5 @min-[42rem]/usage:grid-cols-6">
          <UsageValue label="会话" value={NUMBER.format(data.sessions)} compact />
          <UsageValue label="提示" value={NUMBER.format(data.prompts)} compact />
          <UsageValue label="子智能体" value={NUMBER.format(data.subagents)} compact />
          <UsageValue label="活跃天数" value={NUMBER.format(data.activeDays)} compact />
          <UsageValue label="连续天数" value={NUMBER.format(data.streak)} compact />
          <UsageValue label="步骤" value={NUMBER.format(data.steps)} compact />
        </div>
      </section>

      {compareOpen ? (
        <UsagePeriodComparison
          current={data}
          previous={previousData}
          range={previousRange}
          loading={previousLoading}
          error={previousError}
          offline={previousOffline}
          retry={retryPrevious}
        />
      ) : null}

      <section className="grid gap-5 @min-[52rem]/usage:grid-cols-[minmax(15rem,0.72fr)_minmax(0,1.4fr)]">
        <div className="min-w-0 rounded-xl border border-border/75 p-5">
          <UsageSectionHeading
            title="提供者"
            description="报告费用的占比"
            className="mb-4"
          />
          {providers.length ? (
            <div className="flex flex-col gap-4">
              {providers.map((provider) => (
                <ProviderUsageRow
                  key={provider.providerID}
                  provider={provider}
                  displayName={
                    catalogProviders.find((candidate) => candidate.id === provider.providerID)
                      ?.name ?? provider.providerID
                  }
                  totalCost={data.cost}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">此范围内没有提供者用量。</p>
          )}
        </div>
        <div className="min-w-0 rounded-xl border border-border/75 p-5">
          <div className="mb-3 flex items-center justify-between gap-4">
            <UsageSectionHeading
              title="每日活动"
              description="步骤是 OpenCode 返回的唯一每日序列数据。"
            />
            <BarChart3 className="size-4 text-info" aria-hidden="true" />
          </div>
          <UsageActivityChart
            activity={data.activity}
            from={data.range.from}
            to={data.range.to}
            timezone={timezone}
          />
        </div>
      </section>

      <section className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
          <UsageSectionHeading
            title="模型"
            description="费用、模型令牌、缓存活动和支持的步骤计数"
          />
          <ToggleGroup
            value={[modelSort]}
            onValueChange={(values) => {
              const value = values[0];
              if (value === "cost" || value === "tokens" || value === "steps")
                onModelSortChange(value);
            }}
            variant="outline"
            size="sm"
            aria-label="排序模型用量"
          >
            <ToggleGroupItem value="cost">费用</ToggleGroupItem>
            <ToggleGroupItem value="tokens">令牌</ToggleGroupItem>
            <ToggleGroupItem value="steps">步骤</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="hidden overflow-x-auto rounded-xl border border-border/75 @min-[44rem]/usage:block">
          <Table className="min-w-[46rem]">
            <TableHeader>
              <TableRow>
                <TableHead>模型</TableHead>
                <TableHead className="text-right">费用</TableHead>
                <TableHead className="text-right">模型令牌</TableHead>
                <TableHead className="text-right">缓存读取</TableHead>
                <TableHead className="text-right">步骤</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {models.length ? (
                models.map((item) => (
                  <ModelUsageRow
                    key={`${item.model.providerID}/${item.model.id}/${item.model.variant ?? ""}`}
                    usage={item}
                    models={catalogModels}
                    providers={catalogProviders}
                    totalCost={data.cost}
                    totalModelTokens={modelTokens}
                  />
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                    此范围内没有模型用量。
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <div className="grid gap-2 @min-[44rem]/usage:hidden">
          {models.length ? (
            models.map((item) => (
              <ModelUsageCard
                key={`${item.model.providerID}/${item.model.id}/${item.model.variant ?? ""}`}
                usage={item}
                models={catalogModels}
                providers={catalogProviders}
                totalCost={data.cost}
                totalModelTokens={modelTokens}
              />
            ))
          ) : (
            <div className="rounded-xl border border-border/75 p-5 text-center text-sm text-muted-foreground">
              此范围内没有模型用量。
            </div>
          )}
        </div>
      </section>

      <section className="min-w-0 rounded-xl border border-border/75 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <UsageSectionHeading
            title="工具可靠性"
            description="已完成和未完成工具调用"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={toolDetailsDisabled}
            aria-expanded={toolDetailsOpen}
            aria-controls="usage-tool-details"
            onClick={() => onToolDetailsOpenChange(!toolDetailsOpen)}
          >
            {toolDetailsOpen ? "隐藏详情" : "显示详情"}
          </Button>
        </div>
        {toolTotals ? (
          <div className="mt-5 grid grid-cols-2 gap-4 @min-[34rem]/usage:grid-cols-4">
            <UsageValue label="调用" value={NUMBER.format(toolTotals.calls)} />
            <UsageValue label="成功" value={NUMBER.format(toolTotals.succeeded)} />
            <UsageValue label="失败" value={NUMBER.format(toolTotals.failed)} />
            <UsageValue label="未完成" value={NUMBER.format(toolTotals.unfinished)} />
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">工具总量不可用。</p>
        )}
        <div
          id="usage-tool-details"
          hidden={!toolDetailsOpen}
          aria-live="polite"
          aria-busy={toolDetailsOpen && detailPending}
          className="mt-5 border-t border-border/70 pt-4"
        >
          {toolDetailsOpen ? (
            <>
              <p className="sr-only" role="status">
                {detailPending
                  ? "正在加载工具详情。"
                  : detailError
                    ? "无法加载工具详情。"
                    : detailData
                      ? `已加载 ${toolUsage.length} 个工具的详情。`
                      : ""}
              </p>
              {detailPending && !detailData ? <Skeleton className="h-24 w-full" /> : null}
              {detailWaitingForConnection ? (
                <p className="text-sm text-muted-foreground">
                  重新连接 OpenCode 以更新此范围的工具详情。
                </p>
              ) : null}
              {detailError ? (
                <div className="flex items-center justify-between gap-3 text-sm text-destructive">
                  <span>无法加载工具详情。</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={detailRetryDisabled}
                    onClick={retryDetails}
                  >
                    重试
                  </Button>
                </div>
              ) : null}
              {toolUsage.length ? (
                <div className="grid gap-2">
                  {toolUsage.map((tool) => (
                    <div
                      key={tool.name}
                      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg bg-muted/45 px-3 py-2 text-sm"
                    >
                      <span className="truncate font-mono text-xs">{tool.name}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {tool.calls} calls · {tool.succeeded} succeeded · {tool.failed} failed ·{" "}
                        {tool.unfinished} unfinished
                        {tool.durationP50 === undefined
                          ? ""
                          : ` · ${Math.round(tool.durationP50)} ms p50`}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
              {!detailPending && !detailError && detailData && toolUsage.length === 0 ? (
                <p className="text-sm text-muted-foreground">此范围内没有逐工具用量。</p>
              ) : null}
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function UsagePeriodComparison({
  current,
  previous,
  range,
  loading,
  error,
  offline,
  retry,
}: {
  current: SessionStatsInfo;
  previous: SessionStatsInfo | null;
  range: { from: number; to: number; timezone: string };
  loading: boolean;
  error: string | null;
  offline: boolean;
  retry(): void;
}) {
  const metrics = previous
    ? [
        {
          label: "报告费用",
          current: current.cost,
          previous: previous.cost,
          format: CURRENCY,
        },
        {
          label: "模型令牌",
          current: modelTokenTotal(current.tokens),
          previous: modelTokenTotal(previous.tokens),
          format: COMPACT,
        },
        { label: "提示", current: current.prompts, previous: previous.prompts, format: NUMBER },
        { label: "步骤", current: current.steps, previous: previous.steps, format: NUMBER },
      ]
    : [];

  return (
    <section
      className="min-w-0 rounded-xl border border-border/75 p-5"
      aria-label="时段对比"
    >
      <UsageSectionHeading
        title="与上一时段对比"
        description={`上期：${formatUsageDateRange(range)}。今天仍在进行中；上一时段已结束。`}
      />
      {previous ? (
        <div className="mt-5 grid grid-cols-2 gap-4 @min-[42rem]/usage:grid-cols-4">
          {metrics.map((metric) => (
            <div key={metric.label} className="min-w-0">
              <div className="text-meta text-muted-foreground">{metric.label}</div>
              <div className="mt-1 text-xl font-medium tracking-tight tabular-nums">
                {metric.format.format(metric.current)}
              </div>
              <div className="text-meta text-muted-foreground tabular-nums">
                {metric.format.format(metric.previous)} 前期
              </div>
              <div className="mt-1 text-meta font-medium tabular-nums">
                {periodChange(metric.current, metric.previous)}
              </div>
            </div>
          ))}
        </div>
      ) : loading ? (
        <Skeleton className="mt-5 h-24 w-full" />
      ) : offline ? (
        <p className="mt-4 text-sm text-muted-foreground">
          重新连接 OpenCode 以加载上一时段。
        </p>
      ) : error ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-destructive">
          <span>无法加载上一时段。</span>
          <Button type="button" variant="outline" size="sm" onClick={retry}>
            重试对比
          </Button>
        </div>
      ) : null}
      {previous && error ? (
        <p className="mt-3 text-meta text-muted-foreground">
          上一时段已缓存，因为最近一次刷新失败。
        </p>
      ) : null}
    </section>
  );
}

function periodChange(current: number, previous: number): string {
  if (current === previous) return "无变化";
  if (previous === 0) return "新活动";
  const change = (current - previous) / previous;
  return `${change > 0 ? "+" : ""}${PERCENT.format(change)} 对比上期`;
}

function ModelUsageRow({
  usage,
  models,
  providers,
  totalCost,
  totalModelTokens,
}: {
  usage: SessionStatsModelUsage;
  models: readonly PalotModel[];
  providers: readonly PalotProvider[];
  totalCost: number;
  totalModelTokens: number;
}) {
  const identity = modelUsageIdentity(usage, models, providers);
  const tokens = modelTokenTotal(usage.tokens);
  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{identity.modelName}</div>
        <div className="text-meta text-muted-foreground">
          {identity.providerName} · {usage.model.id}
          {usage.model.variant ? ` · ${usage.model.variant}` : ""}
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        <div>{CURRENCY.format(usage.cost)}</div>
        <div className="text-micro text-muted-foreground">
          {formatShare(usage.cost, totalCost)} 费用占比
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        <div>{COMPACT.format(tokens)}</div>
        <div className="text-micro text-muted-foreground">
          {COMPACT.format(usage.tokens.input)} 输入 · {COMPACT.format(usage.tokens.output)} 输出
          {usage.tokens.reasoning > 0
            ? ` · ${COMPACT.format(usage.tokens.reasoning)} 推理`
            : ""}
        </div>
        <div className="text-micro text-muted-foreground">
          {formatShare(tokens, totalModelTokens)} 模型令牌占比
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        <div>{COMPACT.format(usage.tokens.cache.read)}</div>
        <div className="text-micro text-muted-foreground">
          {COMPACT.format(usage.tokens.cache.write)} 写入
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums">{NUMBER.format(usage.steps)}</TableCell>
    </TableRow>
  );
}

function ModelUsageCard({
  usage,
  models,
  providers,
  totalCost,
  totalModelTokens,
}: {
  usage: SessionStatsModelUsage;
  models: readonly PalotModel[];
  providers: readonly PalotProvider[];
  totalCost: number;
  totalModelTokens: number;
}) {
  const identity = modelUsageIdentity(usage, models, providers);
  const tokens = modelTokenTotal(usage.tokens);
  return (
    <article className="rounded-xl border border-border/75 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium">{identity.modelName}</h3>
          <p className="truncate text-meta text-muted-foreground">
            {identity.providerName} · {usage.model.id}
            {usage.model.variant ? ` · ${usage.model.variant}` : ""}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-sm font-medium tabular-nums">{CURRENCY.format(usage.cost)}</div>
          <div className="text-micro text-muted-foreground">
            {formatShare(usage.cost, totalCost)} 费用占比
          </div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3">
        <UsageValue label="模型令牌" value={COMPACT.format(tokens)} compact />
        <UsageValue
          label="缓存读取 / 写入"
          value={`${COMPACT.format(usage.tokens.cache.read)} / ${COMPACT.format(usage.tokens.cache.write)}`}
          compact
        />
        <UsageValue label="步骤" value={NUMBER.format(usage.steps)} compact />
        <UsageValue label="令牌占比" value={formatShare(tokens, totalModelTokens)} compact />
      </div>
      <p className="mt-3 text-meta text-muted-foreground tabular-nums">
        {COMPACT.format(usage.tokens.input)} 输入 · {COMPACT.format(usage.tokens.output)} 输出
        {usage.tokens.reasoning > 0 ? ` · ${COMPACT.format(usage.tokens.reasoning)} 推理` : ""}
      </p>
    </article>
  );
}

function ProviderUsageRow({
  provider,
  displayName,
  totalCost,
}: {
  provider: ProviderUsageSummary;
  displayName: string;
  totalCost: number;
}) {
  const share = totalCost > 0 ? provider.cost / totalCost : 0;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-4">
        <div className="min-w-0 truncate text-sm font-medium">{displayName}</div>
        <div className="shrink-0 text-sm font-medium tabular-nums">
          {CURRENCY.format(provider.cost)}
        </div>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="h-full rounded-full bg-primary" style={{ width: `${share * 100}%` }} />
      </div>
      <div className="mt-1 flex items-center justify-between gap-3 text-meta text-muted-foreground">
        <span>
          {provider.models} 个{provider.models === 1 ? "模型" : "模型"} ·{" "}
          {COMPACT.format(provider.tokens)} 个令牌
        </span>
        <span className="tabular-nums">{PERCENT.format(share)}</span>
      </div>
    </div>
  );
}

function TokenCompositionBar({ tokens }: { tokens: SessionStatsInfo["tokens"] }) {
  const total = modelTokenTotal(tokens);
  if (total <= 0) return null;
  const parts = [
    { key: "input", label: "输入", value: tokens.input, className: "bg-info" },
    { key: "output", label: "输出", value: tokens.output, className: "bg-success" },
    { key: "reasoning", label: "推理", value: tokens.reasoning, className: "bg-primary" },
  ];
  return (
    <div
      className="flex h-1.5 w-full max-w-56 overflow-hidden rounded-full bg-muted"
      role="img"
      aria-label={parts
        .map((part) => `${part.label} ${PERCENT.format(part.value / total)}`)
        .join(", ")}
    >
      {parts.map((part) => (
        <span
          key={part.key}
          className={part.className}
          style={{ width: `${(part.value / total) * 100}%` }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

function UsageValue({
  label,
  value,
  compact = false,
}: {
  label: string;
  value: string;
  compact?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div
        className={`${compact ? "text-base" : "text-lg"} font-medium tracking-tight tabular-nums`}
      >
        {value}
      </div>
      <div className="truncate text-meta text-muted-foreground">{label}</div>
    </div>
  );
}

function UsageSectionHeading({
  title,
  description,
  className,
}: {
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <div className={`grid gap-0.5 ${className ?? ""}`}>
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

function UsageSkeleton() {
  return (
    <div className="grid gap-6">
      <Skeleton className="h-[340px] rounded-2xl" />
      <Skeleton className="h-64 rounded-xl" />
      <Skeleton className="h-40 rounded-xl" />
    </div>
  );
}

function UsageUnavailable() {
  return (
    <div className="flex min-h-72 items-center justify-center">
      <div className="max-w-md text-center">
        <TriangleAlert className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
        <h2 className="mt-3 text-base font-medium">OpenCode 已断开</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          本地 OpenCode 服务重新连接后将加载用量。
        </p>
      </div>
    </div>
  );
}

function UsageError({ message, retry }: { message: string; retry(): void }) {
  return (
    <div className="flex min-h-72 items-center justify-center">
      <div className="max-w-md text-center">
        <TriangleAlert className="mx-auto size-8 text-destructive" aria-hidden="true" />
        <h2 className="mt-3 text-base font-medium">无法加载用量</h2>
        <p className="mt-1 text-sm text-muted-foreground">{message}</p>
        <Button type="button" variant="outline" size="sm" className="mt-4" onClick={retry}>
          重试
        </Button>
      </div>
    </div>
  );
}

function sortModels(models: readonly SessionStatsModelUsage[], sort: ModelSort) {
  return [...models].toSorted((left, right) => {
    const metricDifference =
      sort === "steps"
        ? right.steps - left.steps
        : sort === "tokens"
          ? modelTokenTotal(right.tokens) - modelTokenTotal(left.tokens)
          : right.cost - left.cost;
    return (
      metricDifference ||
      right.cost - left.cost ||
      modelTokenTotal(right.tokens) - modelTokenTotal(left.tokens) ||
      modelUsageKey(left).localeCompare(modelUsageKey(right))
    );
  });
}

function modelUsageKey(usage: SessionStatsModelUsage): string {
  return `${usage.model.providerID}/${usage.model.id}/${usage.model.variant ?? ""}`;
}

function modelTokenTotal(tokens: SessionStatsInfo["tokens"]): number {
  return tokens.input + tokens.output + tokens.reasoning;
}

interface ProviderUsageSummary {
  providerID: string;
  models: number;
  cost: number;
  tokens: number;
}

function summarizeProviders(models: readonly SessionStatsModelUsage[]): ProviderUsageSummary[] {
  const providers = new Map<string, { summary: ProviderUsageSummary; modelIDs: Set<string> }>();
  for (const model of models) {
    const current = providers.get(model.model.providerID) ?? {
      summary: {
        providerID: model.model.providerID,
        models: 0,
        cost: 0,
        tokens: 0,
      },
      modelIDs: new Set<string>(),
    };
    current.modelIDs.add(model.model.id);
    current.summary.models = current.modelIDs.size;
    current.summary.cost += model.cost;
    current.summary.tokens += modelTokenTotal(model.tokens);
    providers.set(model.model.providerID, current);
  }
  return [...providers.values()]
    .map(({ summary }) => summary)
    .toSorted(
      (left, right) =>
        right.cost - left.cost ||
        right.tokens - left.tokens ||
        left.providerID.localeCompare(right.providerID),
    );
}

function modelUsageIdentity(
  usage: SessionStatsModelUsage,
  models: readonly PalotModel[],
  providers: readonly PalotProvider[],
) {
  const model = models.find(
    (candidate) =>
      candidate.providerID === usage.model.providerID && candidate.modelID === usage.model.id,
  );
  const provider = providers.find((candidate) => candidate.id === usage.model.providerID);
  return {
    modelName: model?.name ?? usage.model.id,
    providerName: provider?.name ?? usage.model.providerID,
  };
}

function formatShare(value: number, total: number): string {
  return PERCENT.format(total > 0 ? value / total : 0);
}

function updatedLabel(updatedAt: number, now: number): string {
  if (!updatedAt) return "尚未更新";
  const minutes = Math.min(0, Math.round((updatedAt - now) / 60_000));
  return `更新于 ${UPDATED.format(minutes, "minute")}`;
}
