import { defineChart, lineY, type ChartPoint, type ChartTooltipContent } from "@tanstack/charts";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scalePoint } from "@tanstack/charts/scales/point";
import { tooltip } from "@tanstack/charts/tooltip";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Copy,
  Cpu,
  Download,
  FolderOpen,
  Gauge,
  MemoryStick,
  Monitor,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useAtomValue } from "jotai";
import { useEffect, useState, type ReactNode } from "react";
import type { PalotDataLocations } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { palotBuild } from "../lib/build";
import { palot } from "../services/palot";
import { useDiagnostics } from "../hooks/use-diagnostics";
import {
  diagnostics,
  type DiagnosticsPhase,
  type DiagnosticsRuntimeSummary,
  type DiagnosticsSnapshot,
} from "../lib/diagnostics-controller";
import { SettingsEmpty, SettingsGroup, SettingsRow, SettingsSection } from "./settings-layout";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card";
import { Chart, chartTheme } from "./ui/chart";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Switch } from "./ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { toast } from "./ui/toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";

const DIAGNOSTICS_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

const RESOURCE_SERIES = [
  {
    label: "CPU",
    color: "var(--info)",
    read: (point: DiagnosticsHistoryPoint) => point.cpuPercent,
    format: (value: number) => `${value.toFixed(1)}%`,
  },
  {
    label: "工作集",
    color: "var(--success)",
    read: (point: DiagnosticsHistoryPoint) => point.workingSetMiB,
    format: (value: number) => `${value.toFixed(value >= 100 ? 0 : 1)} MiB`,
  },
] as const satisfies readonly HistorySeries[];

const RESPONSIVENESS_SERIES = [
  {
    label: "帧 p95",
    color: "var(--warning)",
    read: (point: DiagnosticsHistoryPoint) => point.frameP95Ms,
    format: formatMilliseconds,
  },
  {
    label: "流式 p95",
    color: "var(--info)",
    read: (point: DiagnosticsHistoryPoint) => point.streamingP95Ms,
    format: formatMilliseconds,
  },
] as const satisfies readonly HistorySeries[];

type DiagnosticsHistoryPoint = DiagnosticsSnapshot["history"][number];

interface HistorySeries {
  label: string;
  color: string;
  read(point: DiagnosticsHistoryPoint): number | null;
  format(value: number): string;
}

interface HistoryChartRow {
  capturedAt: number;
  series: string;
  value: number;
  displayValue: string;
}

export function DiagnosticsSettings() {
  const snapshot = useDiagnostics("dashboard");
  const runtime = useAtomValue(runtimeAtom);
  const [pendingAction, setPendingAction] = useState<"capture" | "copy" | null>(null);
  const runtimeSummary: DiagnosticsRuntimeSummary | null = runtime
    ? {
        connected: runtime.connected,
        phase: runtime.phase,
        version: runtime.version,
        managed: runtime.managed,
      }
    : null;

  async function captureNow() {
    setPendingAction("capture");
    try {
      await diagnostics.captureNow();
      toast.add({ type: "success", title: "诊断已刷新" });
    } catch (error) {
      showDiagnosticsError("无法刷新诊断", error);
    } finally {
      setPendingAction(null);
    }
  }

  async function copyReport() {
    setPendingAction("copy");
    try {
      await diagnostics.copySafeReport(runtimeSummary);
      toast.add({
        type: "success",
        title: "诊断已复制",
        description: "报告不包含任务内容、路径、URL 和凭据。",
      });
    } catch (error) {
      showDiagnosticsError("无法复制诊断", error);
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-8" data-diagnostics-status={snapshot.phase}>
      <SettingsSection
        title="实时信号"
        description="仅在打开此页面或覆盖层时收集的有界内存测量值。"
        action={
          <>
            <PhaseBadge phase={snapshot.phase} />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="刷新诊断"
              disabled={pendingAction !== null}
              onClick={() => void captureNow()}
            >
              <RefreshCw
                className={pendingAction === "capture" ? "animate-spin" : undefined}
                aria-hidden="true"
              />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pendingAction !== null}
              onClick={() => void copyReport()}
            >
              <Copy data-icon="inline-start" aria-hidden="true" />
              复制报告
            </Button>
          </>
        }
      >
        <Card className="min-w-0 rounded-xl border border-border ring-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-4 text-muted-foreground" aria-hidden="true" />
              诊断会话
            </CardTitle>
            <CardDescription className="text-compact">
              Electron 进程计数器、渲染器响应性和 OpenCode 流式延迟。
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 divide-x divide-y divide-border border-y border-border p-0 @xl/settings:grid-cols-4 @5xl/settings:grid-cols-8">
            <SignalMetric
              icon={<Cpu aria-hidden="true" />}
              label="CPU"
              value={formatCpu(snapshot)}
              detail={snapshot.current.cpuReady ? "Electron 间隔" : "预热间隔"}
            />
            <SignalMetric
              icon={<MemoryStick aria-hidden="true" />}
              label="内存"
              value={formatKiB(snapshot.current.workingSetKiB)}
              detail={`${snapshot.current.app?.processes.length ?? 0} 个进程`}
            />
            <SignalMetric
              icon={<Gauge aria-hidden="true" />}
              label="FPS"
              value={formatFps(snapshot.current.renderer?.frames.fps)}
              detail={`${snapshot.current.renderer?.frames.count ?? 0} 帧间隔`}
            />
            <SignalMetric
              icon={<Gauge aria-hidden="true" />}
              label="帧 p95"
              value={formatMilliseconds(snapshot.current.renderer?.frames.p95)}
              detail={`${snapshot.current.renderer?.frames.over25Ms ?? 0} 超过 25 ms`}
            />
            <SignalMetric
              icon={<Clock3 aria-hidden="true" />}
              label="长任务"
              value={String(snapshot.current.renderer?.longTasks.count ?? 0)}
              detail={`${formatMilliseconds(snapshot.current.renderer?.longTasks.max)} 最长`}
            />
            <SignalMetric
              icon={<Activity aria-hidden="true" />}
              label="React 渲染"
              value={
                snapshot.current.renderer?.reactScan
                  ? String(snapshot.current.renderer.reactScan.renderCount)
                  : "-"
              }
              detail={
                snapshot.current.renderer?.reactScan
                  ? `${snapshot.current.renderer.reactScan.commitCount} 次提交 / ${formatMilliseconds(snapshot.current.renderer.reactScan.totalRenderTimeMs)}`
                  : "React Scan 已关闭"
              }
            />
            <SignalMetric
              icon={<Activity aria-hidden="true" />}
              label="流 p95"
              value={formatMilliseconds(snapshot.current.renderer?.streamingLatency.p95)}
              detail={`${snapshot.current.renderer?.streamingLatency.count ?? 0} 次提交`}
            />
            <SignalMetric
              icon={<RefreshCw aria-hidden="true" />}
              label="采集器"
              value={formatMilliseconds(snapshot.collector.lastCollectionDurationMs)}
              detail={`每 ${formatDuration(snapshot.collector.sampleIntervalMs)}`}
            />
          </CardContent>
          <CardFooter className="flex-wrap justify-between gap-2 text-meta text-muted-foreground">
            <span>{lastSampleLabel(snapshot.collector.lastSampleAt)}</span>
            <span className="font-mono tabular-nums">
              {snapshot.collector.sampleCount} 个保留样本
            </span>
          </CardFooter>
        </Card>
      </SettingsSection>

      {snapshot.preferences.reactScanActive ? (
        <Alert>
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>React Scan 正在检测此渲染器</AlertTitle>
          <AlertDescription>
            渲染轮廓和此仪表板会增加观察器开销。在比较基准测试结果之前请禁用它们。
          </AlertDescription>
        </Alert>
      ) : snapshot.preferences.reactScanStatus === "failed" ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>React Scan 无法启动</AlertTitle>
          <AlertDescription>
            Palot 在没有渲染检测的情况下继续运行。在重试之前请禁用 React Scan 并重新加载。
          </AlertDescription>
        </Alert>
      ) : null}

      <SettingsSection
        title="检测"
        description="这些控制在每个 Palot 版本中都可用，并且默认保持关闭状态。"
      >
        <SettingsGroup>
          <p className="p-4 text-compact leading-relaxed text-muted-foreground">
            覆盖层共享此页面的采集器。React Scan 的渲染轮廓在 React 之前加载，因此需要重新加载渲染器。
          </p>
          <SettingsRow
            title="诊断覆盖层"
            description="显示一个紧凑的始终置顶的 HUD，包含 CPU、内存、帧、长任务和流式延迟。"
            control={
              <Switch
                aria-label="诊断覆盖层"
                checked={snapshot.preferences.overlayVisible}
                onCheckedChange={(checked) => diagnostics.setOverlayVisible(Boolean(checked))}
              />
            }
          />
          <SettingsRow
            title="React Scan"
            description="突出显示组件渲染。这会改变运行时行为，并且不是基准中立的。"
            control={
              <Switch
                aria-label="React Scan"
                checked={snapshot.preferences.reactScanRequested}
                onCheckedChange={(checked) => diagnostics.setReactScanEnabled(Boolean(checked))}
              />
            }
          />
          <div className="flex flex-wrap gap-2 p-4">
            <CapabilityBadge
              label="浏览器探测"
              enabled={snapshot.capabilities.animationFrames && snapshot.capabilities.longTasks}
            />
            <CapabilityBadge
              label="Electron 指标"
              enabled={snapshot.capabilities.nativeMetrics}
            />
            <CapabilityBadge label="渲染器堆" enabled={snapshot.capabilities.rendererHeap} />
            <Badge variant={snapshot.build.reactProfiling ? "secondary" : "outline"}>
              React 性能分析 {snapshot.build.reactProfiling ? "开启" : "关闭"}
            </Badge>
            <Badge variant={snapshot.build.reactCompilerMode ? "secondary" : "outline"}>
              编译器 {snapshot.build.reactCompilerMode ?? "关闭"}
            </Badge>
          </div>
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection
        title="资源历史"
        description="两分钟的渲染器本地历史，在 Palot 重新加载时丢弃。"
        action={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              diagnostics.clearHistory();
              toast.add({ type: "success", title: "诊断历史已清除" });
            }}
          >
            <Trash2 data-icon="inline-start" aria-hidden="true" />
            清除历史
          </Button>
        }
      >
        <div className="grid min-w-0 gap-4 @3xl/settings:grid-cols-2">
          <HistoryCard
            title="进程占用"
            description="聚合 Electron CPU 和工作集，各自显示在本地范围内。CPU 在一个预热样本后开始。"
            empty={snapshot.history.length < 2}
          >
            <ResourceHistoryChart snapshot={snapshot} />
          </HistoryCard>
          <HistoryCard
            title="渲染器响应性"
            description="帧间隔和接收到提交的样本共享毫秒刻度。"
            empty={snapshot.history.length < 2}
          >
            <ResponsivenessHistoryChart snapshot={snapshot} />
          </HistoryCard>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Electron 进程"
        description="来自 Electron 的实时进程指标。CPU 值基于间隔；内存值为 KiB。"
      >
        <Card className="min-w-0 rounded-xl border border-border ring-0">
          <CardHeader>
            <CardTitle>进程表</CardTitle>
            <CardDescription className="text-compact">
              名称是 Electron 服务标签，而不是命令行或 OpenCode 任务内容。
            </CardDescription>
          </CardHeader>
          <CardContent className="-mb-(--card-spacing) p-0">
            <ProcessTable snapshot={snapshot} />
          </CardContent>
        </Card>
      </SettingsSection>

      <SettingsSection title="系统和采集器">
        <div className="grid min-w-0 gap-4 @3xl/settings:grid-cols-2">
          <SystemCard snapshot={snapshot} runtime={runtimeSummary} />
          <GpuCard snapshot={snapshot} />
        </div>
      </SettingsSection>

      <DataManagement />
    </div>
  );
}

function DataManagement() {
  const [locations, setLocations] = useState<PalotDataLocations | null>(null);
  const [confirmation, setConfirmation] = useState<"settings" | "all" | null>(null);
  const [pending, setPending] = useState<"support" | "settings" | "all" | null>(null);

  useEffect(() => {
    void palot
      .dataLocations()
      .then(setLocations)
      .catch(() => setLocations(null));
  }, []);

  async function exportBundle() {
    setPending("support");
    try {
      const file = await palot.exportSupportBundle();
      if (file) toast.add({ type: "success", title: "支持包已导出" });
    } catch (error) {
      showDiagnosticsError("无法导出支持包", error);
    } finally {
      setPending(null);
    }
  }

  async function reset(scope: "settings" | "all") {
    setPending(scope);
    try {
      await palot.resetPalotData(scope);
    } catch (error) {
      setPending(null);
      setConfirmation(null);
      showDiagnosticsError(
        scope === "settings" ? "无法重置设置" : "无法移除 Palot 数据",
        error,
      );
    }
  }

  return (
    <SettingsSection
      title="数据和恢复"
      description="Palot 将其桌面状态与 OpenCode 的会话、身份验证、配置、项目和服务存储分开保留。"
    >
      <Card className="@container/details min-w-0 rounded-xl border border-border ring-0">
        <CardHeader>
          <CardTitle>Palot 拥有的数据</CardTitle>
          <CardDescription className="text-compact">
            检查本地位置、导出支持包已脱敏，或重置 Palot 而不删除 OpenCode 拥有的数据。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DetailRow label="数据" value={locations?.data ?? "不可用"} />
          <DetailRow label="日志" value={locations?.logs ?? "不可用"} />
          <DetailRow label="数据库备份" value={locations?.backups ?? "不可用"} />
        </CardContent>
        <CardFooter className="flex-wrap gap-2 border-t">
          <Button
            type="button"
            variant="outline"
            onClick={() => void palot.revealDataLocation("data")}
          >
            <FolderOpen data-icon="inline-start" aria-hidden="true" /> 显示数据
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void palot.revealDataLocation("logs")}
          >
            <FolderOpen data-icon="inline-start" aria-hidden="true" /> 显示日志
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending !== null}
            onClick={() => void exportBundle()}
          >
            <Download data-icon="inline-start" aria-hidden="true" />
            {pending === "support" ? "正在导出…" : "导出支持包"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending !== null}
            onClick={() => setConfirmation("settings")}
          >
            重置设置
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending !== null}
            onClick={() => setConfirmation("all")}
          >
            移除 Palot 数据
          </Button>
        </CardFooter>
      </Card>
      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(open) => !open && setConfirmation(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmation === "all" ? "移除所有 Palot 拥有的数据？" : "重置 Palot 设置？"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmation === "all"
                ? "这将永久移除 Palot 的数据库、偏好设置、本地 UI 状态、日志、临时附件、服务器配置文件和加密的服务器凭据。OpenCode 拥有的数据不会被删除。"
                : "这将清除 Palot 偏好设置和本地 UI 状态，然后重新启动。保存的 OpenCode 服务器配置文件和加密的服务器凭据会被保留。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending !== null}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant={confirmation === "all" ? "destructive" : "default"}
              disabled={pending !== null}
              onClick={() => confirmation && void reset(confirmation)}
            >
              {pending
                ? "正在处理…"
                : confirmation === "all"
                  ? "移除 Palot 数据"
                  : "重置设置"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  );
}

function SignalMetric({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="min-w-0 p-4">
      <div className="flex items-center gap-1.5 text-meta text-muted-foreground [&_svg]:size-3 [&_svg]:shrink-0">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 font-mono text-lg font-semibold tabular-nums wrap-anywhere">{value}</div>
      <div className="mt-1 text-meta text-muted-foreground wrap-anywhere">{detail}</div>
    </div>
  );
}

function HistoryCard({
  title,
  description,
  empty,
  children,
}: {
  title: string;
  description: string;
  empty: boolean;
  children: ReactNode;
}) {
  return (
    <Card className="min-w-0 rounded-xl border border-border ring-0">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription className="text-compact">{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {empty ? (
          <div className="flex min-h-48 items-center">
            <SettingsEmpty>
              <span className="mb-1 block text-sm font-medium text-foreground">
                正在收集第一个间隔
              </span>
              历史记录在预热和第一个计时样本后出现。
            </SettingsEmpty>
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

function ResourceHistoryChart({ snapshot }: { snapshot: DiagnosticsSnapshot }) {
  const rows = historyChartRows(snapshot.history, RESOURCE_SERIES, true);
  return <HistoryLineChart rows={rows} series={RESOURCE_SERIES} normalized />;
}

function ResponsivenessHistoryChart({ snapshot }: { snapshot: DiagnosticsSnapshot }) {
  const rows = historyChartRows(snapshot.history, RESPONSIVENESS_SERIES, false);
  return <HistoryLineChart rows={rows} series={RESPONSIVENESS_SERIES} />;
}

function HistoryLineChart({
  rows,
  series,
  normalized = false,
}: {
  rows: readonly HistoryChartRow[];
  series: readonly HistorySeries[];
  normalized?: boolean;
}) {
  const maximum = Math.max(1, ...rows.map((row) => row.value));
  const definition = defineChart({
    marks: [
      lineY(rows, {
        id: "diagnostic-history-lines",
        x: "capturedAt",
        y: "value",
        z: "series",
        color: "series",
        key: (row) => `${row.capturedAt}:${row.series}`,
        strokeWidth: 1.5,
      }),
    ],
    scales: {
      x: { scale: scalePoint, axis: false },
      y: {
        scale: scaleLinear().domain([0, normalized ? 1 : maximum]),
        grid: true,
        axis: false,
      },
    },
    color: {
      domain: series.map(({ label }) => label),
      range: series.map(({ color }) => color),
    },
    margin: { top: 8, right: 8, bottom: 8, left: 8 },
    theme: chartTheme,
    focus: "group-x",
    focusRing: false,
    svgAnimation: false,
    tooltip: {
      use: tooltip,
      className: "palot-chart-tooltip",
      anchor: "group-center",
      placement: "auto",
      sort: "color-domain",
      content: historyTooltipContent,
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <Chart
        definition={definition}
        height={180}
        initialWidth={480}
        ariaLabel={`${series.map(({ label }) => label).join(" and ")} history`}
      />
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-meta text-muted-foreground">
        {series.map(({ label, color }) => (
          <div key={label} className="flex items-center gap-1.5">
            <span
              className="size-2 rounded-[2px]"
              style={{ backgroundColor: color }}
              aria-hidden="true"
            />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

function ProcessTable({ snapshot }: { snapshot: DiagnosticsSnapshot }) {
  const processes = (snapshot.current.app?.processes ?? []).toSorted(
    (left, right) =>
      right.memory.workingSetSize - left.memory.workingSetSize || left.pid - right.pid,
  );
  if (processes.length === 0) {
    return (
      <SettingsEmpty>
        <span className="mb-1 block text-sm font-medium text-foreground">
          等待 Electron 指标
        </span>
        采集器尚未返回进程快照。
      </SettingsEmpty>
    );
  }

  return (
    <Table className="text-compact">
      <TableHeader>
        <TableRow>
          <TableHead>进程</TableHead>
          <TableHead>服务</TableHead>
          <TableHead className="text-right">CPU</TableHead>
          <TableHead className="text-right">内存</TableHead>
          <TableHead className="text-right">峰值</TableHead>
          <TableHead className="text-right">PID</TableHead>
          <TableHead className="text-right">沙箱</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {processes.map((process) => (
          <TableRow key={`${process.pid}:${process.creationTime}`}>
            <TableCell className="font-medium">{process.type}</TableCell>
            <TableCell className="max-w-60 whitespace-normal text-muted-foreground wrap-anywhere">
              {process.serviceName ?? process.name ?? "-"}
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {snapshot.current.cpuReady ? `${process.cpu.percentCPUUsage.toFixed(1)}%` : "-"}
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">
              {formatKiB(process.memory.workingSetSize)}
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
              {formatKiB(process.memory.peakWorkingSetSize)}
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
              {process.pid}
            </TableCell>
            <TableCell className="text-right text-muted-foreground">
              {process.sandboxed === null ? "未知" : process.sandboxed ? "是" : "否"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function SystemCard({
  snapshot,
  runtime,
}: {
  snapshot: DiagnosticsSnapshot;
  runtime: DiagnosticsRuntimeSummary | null;
}) {
  const versions = snapshot.current.app?.versions;
  return (
    <Card className="@container/details min-w-0 rounded-xl border border-border ring-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Monitor className="size-4" aria-hidden="true" />
          运行时
        </CardTitle>
        <CardDescription className="text-compact">
          构建标识和已连接服务状态。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DetailRow label="Palot" value={`${palotBuild.version} / ${palotBuild.channel}`} />
        <DetailRow
          label="构建"
          value={`${palotBuild.commitSha.slice(0, 12)} / ${palotBuild.buildNumber}${palotBuild.dirty ? " / dirty" : ""}`}
        />
        <DetailRow label="OpenCode 契约" value={palotBuild.openCodeContractVersion} />
        <DetailRow label="Electron" value={versions?.electron ?? "不可用"} />
        <DetailRow label="Chromium" value={versions?.chromium ?? "不可用"} />
        <DetailRow label="Node" value={versions?.node ?? "不可用"} />
        <DetailRow
          label="平台"
          value={versions ? `${versions.platform} / ${versions.architecture}` : "不可用"}
        />
        <DetailRow
          label="OpenCode"
          value={runtime ? `${runtime.version ?? "unknown"} / ${runtime.phase}` : "不可用"}
        />
        <DetailRow label="窗口" value={windowStateLabel(snapshot.current.app?.window ?? null)} />
      </CardContent>
    </Card>
  );
}

function GpuCard({ snapshot }: { snapshot: DiagnosticsSnapshot }) {
  const app = snapshot.current.app;
  const features = Object.entries(app?.gpuFeatureStatus ?? {}).toSorted(([left], [right]) =>
    left.localeCompare(right),
  );
  return (
    <Card className="@container/details min-w-0 rounded-xl border border-border ring-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="size-4" aria-hidden="true" />
          GPU 和采集
        </CardTitle>
        <CardDescription className="text-compact">
          能力状态和诊断观察器自身的开销。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DetailRow
          label="硬件加速"
          value={app ? (app.hardwareAcceleration ? "已启用" : "已禁用") : "不可用"}
        />
        <DetailRow
          label="采集时间"
          value={formatMilliseconds(snapshot.collector.lastCollectionDurationMs)}
        />
        <DetailRow
          label="平均采集"
          value={formatMilliseconds(snapshot.collector.averageCollectionDurationMs)}
        />
        {features.length > 0 ? (
          features.map(([name, value]) => (
            <DetailRow key={name} label={sentenceCase(name.replaceAll("_", " "))} value={value} />
          ))
        ) : (
          <DetailRow label="GPU 功能" value="等待快照" />
        )}
      </CardContent>
    </Card>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1 border-t border-border py-3 first:border-t-0 @md/details:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] @md/details:gap-4">
      <span className="text-compact text-muted-foreground">{label}</span>
      <span className="min-w-0 font-mono text-code-compact tabular-nums wrap-anywhere @md/details:text-right">
        {value}
      </span>
    </div>
  );
}

function PhaseBadge({ phase }: { phase: DiagnosticsPhase }) {
  return (
    <Badge
      variant={phase === "live" ? "secondary" : phase === "degraded" ? "destructive" : "outline"}
    >
      {phase === "live" ? <CheckCircle2 data-icon="inline-start" aria-hidden="true" /> : null}
      {phase}
    </Badge>
  );
}

function CapabilityBadge({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <Badge variant={enabled ? "secondary" : "destructive"}>
      {label} {enabled ? "可用" : "不可用"}
    </Badge>
  );
}

function formatCpu(snapshot: DiagnosticsSnapshot): string {
  if (!snapshot.current.cpuReady) return "预热中";
  return snapshot.current.cpuPercent === null ? "-" : `${snapshot.current.cpuPercent.toFixed(1)}%`;
}

function formatKiB(value: number | null): string {
  if (value === null) return "-";
  const mib = value / 1_024;
  return `${mib.toFixed(mib >= 100 ? 0 : 1)} MiB`;
}

function formatMilliseconds(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return `${value.toFixed(value >= 100 ? 0 : 1)} ms`;
}

function formatFps(value: number | null | undefined): string {
  return value === null || value === undefined ? "-" : value.toFixed(0);
}

function formatDuration(value: number): string {
  return value < 1_000 ? `${value} ms` : `${value / 1_000}s`;
}

function lastSampleLabel(value: number | null): string {
  if (value === null) return "等待第一个样本";
  return `采样时间 ${DIAGNOSTICS_TIME_FORMATTER.format(value)}`;
}

function formatChartTime(value: unknown): string {
  return typeof value === "number" ? DIAGNOSTICS_TIME_FORMATTER.format(value) : "样本";
}

function historyChartRows(
  history: DiagnosticsSnapshot["history"],
  series: readonly HistorySeries[],
  normalize: boolean,
): HistoryChartRow[] {
  const ranges = new Map(
    series.map((item) => {
      const values = history.flatMap((point) => {
        const value = item.read(point);
        return value === null ? [] : [value];
      });
      return [
        item.label,
        {
          minimum: values.length ? Math.min(...values) : 0,
          maximum: values.length ? Math.max(...values) : 0,
        },
      ] as const;
    }),
  );

  return history.flatMap((point) =>
    series.flatMap((item) => {
      const rawValue = item.read(point);
      if (rawValue === null) return [];
      const range = ranges.get(item.label);
      const spread = range ? range.maximum - range.minimum : 0;
      const value = normalize
        ? spread > 0
          ? (rawValue - (range?.minimum ?? 0)) / spread
          : 0.5
        : rawValue;
      return [
        {
          capturedAt: point.capturedAt,
          series: item.label,
          value,
          displayValue: item.format(rawValue),
        },
      ];
    }),
  );
}

function historyTooltipContent(
  points: readonly ChartPoint<HistoryChartRow>[],
): ChartTooltipContent {
  return {
    title: formatChartTime(points[0]?.datum.capturedAt),
    rows: points.map((point) => ({
      label: point.datum.series,
      value: point.datum.displayValue,
      color: point.color,
    })),
  };
}

function windowStateLabel(
  windowState: DiagnosticsSnapshot["current"]["app"] extends infer _T
    ? NonNullable<DiagnosticsSnapshot["current"]["app"]>["window"]
    : never,
): string {
  if (!windowState) return "不可用";
  if (windowState.minimized) return "已最小化";
  if (!windowState.visible) return "已隐藏";
  return windowState.focused ? "可见 / 已聚焦" : "可见 / 非活动";
}

function sentenceCase(value: string): string {
  return value ? `${value[0]?.toUpperCase()}${value.slice(1)}` : value;
}

function showDiagnosticsError(title: string, cause: unknown) {
  toast.add({
    type: "error",
    title,
    description: cause instanceof Error ? cause.message : "诊断操作失败。",
  });
}
