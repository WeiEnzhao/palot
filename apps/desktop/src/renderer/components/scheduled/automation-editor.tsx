import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import {
  Archive,
  Bell,
  CircleAlert,
  Clock3,
  ExternalLink,
  MoreHorizontal,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { runtimeAtom } from "../../atoms/workspace";
import type {
  AutomationDraft,
  AutomationRecord,
  AutomationRun,
  AutomationSchedulePreview,
  AutomationTrigger,
  PalotProject,
  PalotSession,
} from "../../../shared";
import { useSettingsSnapshot } from "../../hooks/use-settings-snapshot";
import {
  automationScheduleLabel,
  automationRunActionLabel,
  automationRunOpenTarget,
  automationRunStateLabel,
  latestAutomationRun,
  runExecutionDuration,
  runIsActive,
  runTimestamp,
} from "../../lib/automation-view";
import { projectName } from "../../lib/view-models";
import { useProjectWorktrees } from "../../hooks/use-project-worktrees";
import { palot } from "../../services/palot";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";

type Frequency = "once" | "hourly" | "daily" | "weekdays" | "weekly" | "monthly" | "custom";

interface AutomationEditorProps {
  automation: AutomationRecord | null;
  initialDraft: AutomationDraft;
  projects: PalotProject[];
  sessions: PalotSession[];
  runs: AutomationRun[];
  selectedRunID?: string;
  saving: boolean;
  onClose(): void;
  onSave(draft: AutomationDraft): Promise<void>;
  onAction(action: "run-now" | "pause" | "resume" | "delete"): Promise<void>;
  onRunAction(run: AutomationRun, action: "open" | "cancel" | "read" | "archive"): void;
}

export function AutomationEditor({
  automation,
  initialDraft,
  projects,
  sessions,
  runs,
  selectedRunID,
  saving,
  onClose,
  onSave,
  onAction,
  onRunAction,
}: AutomationEditorProps) {
  const runtime = useAtomValue(runtimeAtom);
  const [draft, setDraft] = useState(initialDraft);
  const [frequency, setFrequency] = useState<Frequency>(() => frequencyFor(initialDraft.trigger));
  const [date, setDate] = useState(() => triggerDate(initialDraft.trigger));
  const [time, setTime] = useState(() => triggerTime(initialDraft.trigger));
  const [timezone, setTimezone] = useState(initialDraft.trigger.timezone);
  const [customRule, setCustomRule] = useState(() =>
    initialDraft.trigger.type === "recurring"
      ? initialDraft.trigger.rrule
      : "FREQ=DAILY;INTERVAL=1",
  );
  const [preview, setPreview] = useState<AutomationSchedulePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const detailsRef = useRef<HTMLDivElement>(null);
  const selectedRunRef = useRef<HTMLDivElement>(null);
  const standaloneDestination = draft.destination.type === "standalone" ? draft.destination : null;
  const sessionDestination = draft.destination.type === "session" ? draft.destination : null;
  const selectedSession = sessionDestination
    ? (sessions.find((session) => session.id === sessionDestination.sessionID) ?? null)
    : null;
  const selectedProject = standaloneDestination
    ? (projects.find((project) => project.id === standaloneDestination.projectID) ?? null)
    : null;
  const settingsQuery = useSettingsSnapshot(
    selectedProject
      ? { projectID: selectedProject.id, directory: selectedProject.canonical }
      : null,
  );
  const agents = (settingsQuery.data?.agents ?? []).filter(
    (agent) => !agent.hidden && agent.mode !== "subagent",
  );
  const models = settingsQuery.data?.catalog.models ?? [];
  const skills = settingsQuery.data?.skills ?? [];
  const worktreesQuery = useProjectWorktrees(selectedProject);
  const worktrees = (worktreesQuery.data ?? [])
    .filter((directory) => directory.strategy !== null)
    .map((directory) => directory.directory);
  const rootSessions = useMemo(
    () => sessions.filter((session) => !session.parentID && session.archivedAt === null),
    [sessions],
  );
  const selectedAgent = agents.find((agent) => agent.id === draft.action.agent) ?? null;
  const latestRun = useMemo(() => latestAutomationRun(runs), [runs]);
  const activeRun = automation?.activeRunID
    ? (runs.find((run) => run.id === automation.activeRunID) ?? null)
    : null;
  const featuredRun = activeRun ?? latestRun;

  const trigger = useMemo(
    () => buildTrigger(frequency, date, time, timezone, customRule),
    [customRule, date, frequency, time, timezone],
  );

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void palot
        .previewAutomationSchedule(trigger)
        .then((value) => {
          if (cancelled) return;
          setPreview(value);
          setPreviewError(null);
        })
        .catch((error) => {
          if (cancelled) return;
          setPreview(null);
          setPreviewError(error instanceof Error ? error.message : "此计划无效");
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [trigger]);

  useEffect(() => {
    if (!selectedRunID) return;
    const frame = window.requestAnimationFrame(() => {
      selectedRunRef.current?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedRunID]);

  function focusSetup() {
    detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => {
      detailsRef.current?.querySelector<HTMLElement>('[aria-label="运行目标"]')?.focus();
    }, 250);
  }

  const modelValue = draft.action.model
    ? `${draft.action.model.providerID}:${draft.action.model.id}`
    : "default";
  const canSave =
    draft.name.trim().length > 0 &&
    draft.action.prompt.trim().length > 0 &&
    previewError === null &&
    (draft.destination.type === "standalone" || draft.destination.sessionID.length > 0);

  async function save() {
    setSaveError(null);
    try {
      await onSave({ ...draft, trigger });
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "无法保存此计划任务");
    }
  }

  return (
    <aside
      className="flex h-full min-h-0 flex-col border-l bg-background"
      aria-label="计划任务编辑器"
    >
      <header className="window-drag flex h-(--shell-header-height) shrink-0 items-center gap-2 border-b px-4">
        <span className="text-xs text-muted-foreground">
          {automation ? "计划任务" : "新建"}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {automation ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                title={automation.status === "active" ? "暂停" : "恢复"}
                aria-label={
                  automation.status === "active" ? "暂停计划任务" : "恢复计划任务"
                }
                onClick={() => void onAction(automation.status === "active" ? "pause" : "resume")}
              >
                {automation.status === "active" ? <Pause /> : <Play />}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="更多计划任务操作"
                    />
                  }
                >
                  <MoreHorizontal />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => void onAction("run-now")}>
                    <Play /> 立即运行
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => void onAction("delete")}>
                    <Trash2 /> 删除
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="关闭编辑器"
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
      </header>

      <div className="palot-native-scrollbar min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-7 px-5 py-5">
          <section className="space-y-3">
            <Input
              value={draft.name}
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="计划任务标题"
              className="h-9 border-0 bg-transparent px-0 text-base font-medium shadow-none focus-visible:ring-0"
              aria-label="计划任务标题"
            />
            <Textarea
              value={draft.action.prompt}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  action: { ...current.action, prompt: event.target.value },
                }))
              }
              placeholder="描述 OpenCode 应该做什么"
              className="min-h-28 resize-y rounded-xl bg-muted/35 p-3 text-sm/relaxed"
              aria-label="计划任务提示"
            />
          </section>

          <div ref={detailsRef}>
            <EditorSection title="详情">
              <EditorRow label="运行于">
                <Select
                  value={draft.destination.type === "standalone" ? "standalone" : "session"}
                  onValueChange={(value) => {
                    if (value === "session") {
                      setDraft((current) => ({
                        ...current,
                        destination: { type: "session", sessionID: rootSessions[0]?.id ?? "" },
                      }));
                      return;
                    }
                    const project = projects[0];
                    if (!project) return;
                    setDraft((current) => ({
                      ...current,
                      destination: {
                        type: "standalone",
                        projectID: project.id,
                        sourceDirectory: project.canonical,
                        workspace: { type: "new-worktree" },
                      },
                    }));
                  }}
                >
                  <EditorSelect label="运行目标">
                    <SelectValue>
                      {draft.destination.type === "standalone" ? "新任务" : "现有任务"}
                    </SelectValue>
                  </EditorSelect>
                  <SelectContent align="end">
                    <SelectItem value="standalone">新任务</SelectItem>
                    <SelectItem value="session">现有任务</SelectItem>
                  </SelectContent>
                </Select>
              </EditorRow>

              {draft.destination.type === "standalone" ? (
                <>
                  <EditorRow label="项目">
                    <Select
                      value={draft.destination.projectID}
                      onValueChange={(value) => {
                        const project = projects.find((candidate) => candidate.id === value);
                        if (!project) return;
                        setDraft((current) => ({
                          ...current,
                          destination: {
                            type: "standalone",
                            projectID: project.id,
                            sourceDirectory: project.canonical,
                            workspace: { type: "new-worktree" },
                          },
                        }));
                      }}
                    >
                      <EditorSelect label="项目">
                        <SelectValue>
                          {selectedProject ? projectName(selectedProject) : "选择项目"}
                        </SelectValue>
                      </EditorSelect>
                      <SelectContent align="end">
                        {projects.map((project) => (
                          <SelectItem key={project.id} value={project.id}>
                            {projectName(project)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </EditorRow>
                  <EditorRow label="工作区">
                    <Select
                      value={
                        draft.destination.workspace.type === "existing-worktree"
                          ? `existing:${draft.destination.workspace.directory}`
                          : draft.destination.workspace.type
                      }
                      onValueChange={(value) => {
                        if (!value) return;
                        setDraft((current) => {
                          if (current.destination.type !== "standalone") return current;
                          return {
                            ...current,
                            destination: {
                              ...current.destination,
                              workspace: value.startsWith("existing:")
                                ? {
                                    type: "existing-worktree",
                                    directory: value.slice("existing:".length),
                                  }
                                : { type: value as "current" | "new-worktree" },
                            },
                          };
                        });
                      }}
                    >
                      <EditorSelect label="工作区">
                        <SelectValue>
                          {draft.destination.workspace.type === "new-worktree"
                            ? "新建工作树"
                            : draft.destination.workspace.type === "current"
                              ? "当前检出"
                              : "已有工作树"}
                        </SelectValue>
                      </EditorSelect>
                      <SelectContent align="end">
                        <SelectItem value="new-worktree">新建工作树</SelectItem>
                        <SelectItem value="current">当前检出</SelectItem>
                        {worktrees.map((directory) => (
                          <SelectItem key={directory} value={`existing:${directory}`}>
                            {directory.split("/").at(-1) ?? directory}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </EditorRow>
                  <EditorRow label="智能体">
                    <Select
                      value={draft.action.agent ?? "default"}
                      onValueChange={(value) =>
                        setDraft((current) => ({
                          ...current,
                          action: {
                            ...current.action,
                            agent: value === "default" ? null : String(value),
                          },
                        }))
                      }
                    >
                      <EditorSelect label="智能体">
                        <SelectValue>
                          {agents.find((agent) => agent.id === draft.action.agent)?.name ??
                            "项目默认"}
                        </SelectValue>
                      </EditorSelect>
                      <SelectContent align="end">
                        <SelectItem value="default">项目默认</SelectItem>
                        {agents.map((agent) => (
                          <SelectItem key={agent.id} value={agent.id}>
                            {agent.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </EditorRow>
                  <EditorRow label="模型">
                    <Select
                      value={modelValue}
                      onValueChange={(value) => {
                        const model = models.find(
                          (candidate) => `${candidate.providerID}:${candidate.modelID}` === value,
                        );
                        setDraft((current) => ({
                          ...current,
                          action: {
                            ...current.action,
                            model: model
                              ? { id: model.modelID, providerID: model.providerID }
                              : null,
                          },
                        }));
                      }}
                    >
                      <EditorSelect label="模型">
                        <SelectValue>
                          {models.find(
                            (model) =>
                              model.modelID === draft.action.model?.id &&
                              model.providerID === draft.action.model.providerID,
                          )?.name ?? "项目默认"}
                        </SelectValue>
                      </EditorSelect>
                      <SelectContent align="end">
                        <SelectItem value="default">项目默认</SelectItem>
                        {models.map((model) => (
                          <SelectItem key={model.id} value={`${model.providerID}:${model.modelID}`}>
                            {model.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </EditorRow>
                  <EditorRow label="技能">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button type="button" variant="ghost" size="sm" className="font-normal">
                            {draft.action.skills.length
                              ? `${draft.action.skills.length} 已选`
                              : "无技能"}
                          </Button>
                        }
                      />
                      <DropdownMenuContent
                        align="end"
                        className="max-h-72 min-w-64 overflow-y-auto"
                      >
                        {skills.length ? (
                          skills.map((skill) => (
                            <DropdownMenuCheckboxItem
                              key={skill.id}
                              checked={draft.action.skills.includes(skill.id)}
                              onCheckedChange={(checked) =>
                                setDraft((current) => ({
                                  ...current,
                                  action: {
                                    ...current.action,
                                    skills: checked
                                      ? [...new Set([...current.action.skills, skill.id])]
                                      : current.action.skills.filter((id) => id !== skill.id),
                                  },
                                }))
                              }
                            >
                              {skill.name}
                            </DropdownMenuCheckboxItem>
                          ))
                        ) : (
                          <DropdownMenuItem disabled>无项目技能</DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </EditorRow>
                </>
              ) : (
                <>
                  <EditorRow label="任务">
                    <Select
                      value={sessionDestination?.sessionID ?? ""}
                      onValueChange={(value) =>
                        setDraft((current) => ({
                          ...current,
                          destination: { type: "session", sessionID: String(value) },
                        }))
                      }
                    >
                      <EditorSelect label="已有任务">
                        <SelectValue>{selectedSession?.title ?? "选择任务"}</SelectValue>
                      </EditorSelect>
                      <SelectContent align="end">
                        {rootSessions.map((session) => (
                          <SelectItem key={session.id} value={session.id}>
                            {session.title ?? "未命名任务"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </EditorRow>
                  <EditorRow label="位置">
                    <span className="block max-w-64 truncate text-xs text-muted-foreground">
                      {selectedSession?.location.directory ?? "不可用"}
                    </span>
                  </EditorRow>
                  <EditorRow label="智能体">
                    <span className="text-xs text-muted-foreground">
                      {selectedSession?.agent ?? "任务默认"}
                    </span>
                  </EditorRow>
                  <EditorRow label="模型">
                    <span className="text-xs text-muted-foreground">
                      {selectedSession?.model
                        ? `${selectedSession.model.providerID}/${selectedSession.model.id}`
                        : "任务默认"}
                    </span>
                  </EditorRow>
                </>
              )}
            </EditorSection>
          </div>

          <section className="rounded-xl border bg-muted/20 px-3 py-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">运行时安全</p>
            <p className="mt-1">
              {draft.destination.type === "session"
                ? "此提示会排在现有工作之后，并沿用该任务的模型、Agent 和位置。"
                : draft.destination.workspace.type === "new-worktree"
                  ? "每次运行在全新的 OpenCode 管理的 worktree 中启动。Worktree 创建失败会中止运行。"
                  : draft.destination.workspace.type === "current"
                    ? "此次运行可能会修改你正在使用的工作副本。"
                    : "此次运行使用选定的已有 worktree。"}
            </p>
            {standaloneDestination && runtime?.capabilities?.localPathActions === false ? (
              <p className="mt-1">
                此服务器上的独立运行不共享记忆文件。如需对话连续性，请使用已有任务。
              </p>
            ) : null}
            <p className="mt-1">
              {selectedAgent
                ? `${selectedAgent.permissions.filter((rule) => rule.effect === "ask").length} 条 Agent 权限规则会在继续前询问。`
                : "应用项目默认权限。"}
              后续的工具选择可能仍需审批；Palot 不会自动批准。
            </p>
          </section>

          <EditorSection title="频率">
            <EditorRow label="重复">
              <Select value={frequency} onValueChange={(value) => setFrequency(value as Frequency)}>
                <EditorSelect label="重复">
                  <SelectValue>{frequencyLabel(frequency)}</SelectValue>
                </EditorSelect>
                <SelectContent align="end">
                  <SelectItem value="once">一次</SelectItem>
                  <SelectItem value="hourly">每小时</SelectItem>
                  <SelectItem value="daily">每天</SelectItem>
                  <SelectItem value="weekdays">工作日</SelectItem>
                  <SelectItem value="weekly">每周</SelectItem>
                  <SelectItem value="monthly">每月</SelectItem>
                  <SelectItem value="custom">自定义</SelectItem>
                </SelectContent>
              </Select>
            </EditorRow>
            {frequency === "once" || frequency === "weekly" || frequency === "monthly" ? (
              <EditorRow label={frequency === "once" ? "日期" : "起始"}>
                <Input
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  className="h-7 w-36 text-xs"
                  aria-label={frequency === "once" ? "日期" : "起始日期"}
                />
              </EditorRow>
            ) : null}
            {frequency !== "hourly" ? (
              <EditorRow label="在">
                <Input
                  type="time"
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                  className="h-7 w-28 text-xs"
                  aria-label="运行时间"
                />
              </EditorRow>
            ) : null}
            <EditorRow label="时区">
              <Input
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                className="h-7 w-48 text-right text-xs"
                aria-label="时区"
              />
            </EditorRow>
            {frequency === "custom" ? (
              <div className="border-t px-3 py-3">
                <Label htmlFor="automation-rrule" className="text-meta! text-muted-foreground">
                  RRULE
                </Label>
                <Input
                  id="automation-rrule"
                  value={customRule}
                  onChange={(event) => setCustomRule(event.target.value)}
                  className="mt-1.5 font-mono text-xs"
                  placeholder="FREQ=WEEKLY;BYDAY=MO,WE,FR"
                />
              </div>
            ) : null}
            <EditorRow label="错过的运行">
              <Select
                value={draft.missedRuns.type}
                onValueChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    missedRuns:
                      value === "skip"
                        ? { type: "skip" }
                        : { type: "catch-up-once", maxAgeMs: 24 * 60 * 60 * 1_000 },
                  }))
                }
              >
                <EditorSelect label="错过的运行">
                  <SelectValue>
                    {draft.missedRuns.type === "skip" ? "跳过" : "Palot 恢复后运行一次"}
                  </SelectValue>
                </EditorSelect>
                <SelectContent align="end">
                  <SelectItem value="catch-up-once">Palot 恢复后运行一次</SelectItem>
                  <SelectItem value="skip">跳过</SelectItem>
                </SelectContent>
              </Select>
            </EditorRow>
            <EditorRow label="通知">
              <Select
                value={draft.notifications}
                onValueChange={(value) =>
                  setDraft((current) => ({
                    ...current,
                    notifications: value as AutomationDraft["notifications"],
                  }))
                }
              >
                <EditorSelect label="通知">
                  <SelectValue>
                    {draft.notifications === "all-runs"
                      ? "所有运行"
                      : draft.notifications === "failures-only"
                        ? "仅失败"
                        : "Palot 在后台时"}
                  </SelectValue>
                </EditorSelect>
                <SelectContent align="end">
                  <SelectItem value="background-only">Palot 在后台时</SelectItem>
                  <SelectItem value="all-runs">所有运行</SelectItem>
                  <SelectItem value="failures-only">仅失败</SelectItem>
                </SelectContent>
              </Select>
            </EditorRow>
          </EditorSection>

          <section aria-label="计划预览">
            <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
              <Clock3 className="size-3.5" aria-hidden="true" />
              <span>{preview?.summary ?? automationScheduleLabel(trigger)}</span>
            </div>
            {previewError ? (
              <p className="flex gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                {previewError}
              </p>
            ) : (
              <div className="grid grid-cols-5 gap-1.5">
                {preview?.occurrences.map((occurrence) => (
                  <div key={occurrence} className="rounded-lg bg-muted/50 px-2 py-2 text-center">
                    <span className="block text-micro font-medium uppercase text-muted-foreground">
                      {formatInTimeZone(occurrence, timezone, "EEE")}
                    </span>
                    <span className="block text-xs">
                      {formatInTimeZone(occurrence, timezone, "MMM d")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {automation ? (
            <section className="space-y-2" aria-labelledby="previous-runs-heading">
              <div className="flex items-center justify-between">
                <h2 id="previous-runs-heading" className="text-xs text-muted-foreground">
                  Previous runs
                </h2>
                {featuredRun ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onRunAction(featuredRun, "open")}
                  >
                    <ExternalLink aria-hidden="true" />
                    {automationRunActionLabel(featuredRun)}
                  </Button>
                ) : null}
              </div>
              <div className="divide-y">
                {runs.length ? (
                  runs.map((run) => {
                    const selected = selectedRunID === run.id;
                    const target = automationRunOpenTarget(run);
                    return (
                      <div
                        key={run.id}
                        ref={selected ? selectedRunRef : undefined}
                        className={selected ? "bg-muted/45" : undefined}
                        data-selected={selected || undefined}
                      >
                        <div className="group flex min-w-0 items-center gap-2 py-2.5">
                          <span
                            className={
                              run.state === "needs-attention" ||
                              run.state === "failed" ||
                              run.state === "unknown"
                                ? "size-2 rounded-full bg-destructive"
                                : run.readAt === null
                                  ? "size-2 rounded-full bg-info"
                                  : "size-2 rounded-full bg-muted-foreground/55"
                            }
                            aria-hidden="true"
                          />
                          <button
                            type="button"
                            className="min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-current={selected ? "true" : undefined}
                            onClick={() => onRunAction(run, "open")}
                          >
                            <span className="block truncate text-xs font-medium">
                              {automationRunStateLabel(run)}
                            </span>
                            <span className="block truncate text-meta text-muted-foreground">
                              {run.summary ?? run.error?.message ?? runTimestamp(run)}
                            </span>
                          </button>
                          <span className="shrink-0 text-micro text-muted-foreground">
                            {[runExecutionDuration(run), runTimestamp(run)]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                                  aria-label="运行操作"
                                />
                              }
                            >
                              <MoreHorizontal />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => onRunAction(run, "open")}>
                                {target.type === "details" ? <CircleAlert /> : <ExternalLink />}
                                {target.type === "request"
                                  ? "处理输入"
                                  : target.type === "details"
                                    ? "查看运行详情"
                                    : "打开任务"}
                              </DropdownMenuItem>
                              {runIsActive(run) ? (
                                <DropdownMenuItem onClick={() => onRunAction(run, "cancel")}>
                                  <X /> 取消运行
                                </DropdownMenuItem>
                              ) : null}
                              <DropdownMenuItem onClick={() => onRunAction(run, "read")}>
                                <Bell /> 标记为{run.readAt === null ? "已读" : "未读"}
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => onRunAction(run, "archive")}>
                                {run.archivedAt ? <RotateCcw /> : <Archive />}
                                {run.archivedAt ? "取消归档" : "归档"}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                        {selected && target.type === "details" ? (
                          <div className="mb-2 ml-4 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
                            <p className="text-muted-foreground">
                              {run.attention?.message ??
                                run.error?.message ??
                                "此次运行未创建 OpenCode 任务。"}
                            </p>
                            {run.attention?.type === "configuration" ? (
                              <Button
                                type="button"
                                variant="link"
                                size="sm"
                                className="mt-1 h-auto px-0"
                                onClick={focusSetup}
                              >
                                Fix setup
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                ) : (
                  <p className="py-4 text-xs text-muted-foreground">此任务尚未运行。</p>
                )}
              </div>
            </section>
          ) : null}
        </div>
      </div>

      <footer className="flex shrink-0 items-center gap-3 border-t px-5 py-3">
        <div className="min-w-0 flex-1">
          {saveError ? <p className="truncate text-xs text-destructive">{saveError}</p> : null}
          {!saveError &&
          draft.destination.type === "standalone" &&
          draft.destination.workspace.type === "current" ? (
            <p className="truncate text-meta text-amber-600 dark:text-amber-400">
              This can modify the checkout you are using.
            </p>
          ) : null}
        </div>
        <Button type="button" disabled={!canSave || saving} onClick={() => void save()}>
          {saving ? "正在保存…" : automation ? "保存更改" : "创建"}
        </Button>
        {automation ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => (activeRun ? onRunAction(activeRun, "open") : void onAction("run-now"))}
          >
            {activeRun ? <ExternalLink aria-hidden="true" /> : <Play aria-hidden="true" />}
            {activeRun ? "打开当前运行" : "立即测试"}
          </Button>
        ) : null}
      </footer>
    </aside>
  );
}

function EditorSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 px-1 text-xs text-muted-foreground">{title}</h2>
      <div className="overflow-hidden rounded-xl border bg-muted/20">{children}</div>
    </section>
  );
}

function EditorRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-11 items-center gap-4 border-b px-3 last:border-b-0">
      <span className="text-xs font-medium">{label}</span>
      <div className="ml-auto min-w-0">{children}</div>
    </div>
  );
}

function EditorSelect({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <SelectTrigger
      className="max-w-64 border-0 bg-transparent text-right shadow-none"
      aria-label={label}
    >
      {children}
    </SelectTrigger>
  );
}

function frequencyFor(trigger: AutomationTrigger): Frequency {
  if (trigger.type === "once") return "once";
  const value = trigger.rrule.toUpperCase();
  if (value === "FREQ=HOURLY;INTERVAL=1") return "hourly";
  if (value === "FREQ=DAILY;INTERVAL=1") return "daily";
  if (value === "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR") return "weekdays";
  if (value.startsWith("FREQ=WEEKLY;BYDAY=")) return "weekly";
  if (value.startsWith("FREQ=MONTHLY;BYMONTHDAY=")) return "monthly";
  return "custom";
}

function frequencyLabel(frequency: Frequency): string {
  return frequency === "once"
    ? "一次"
    : frequency === "hourly"
      ? "每小时"
      : frequency === "daily"
        ? "每天"
        : frequency === "weekdays"
          ? "工作日"
          : frequency === "weekly"
            ? "每周"
            : frequency === "monthly"
              ? "每月"
              : "自定义";
}

export function triggerDate(trigger: AutomationTrigger): string {
  return formatInTimeZone(
    trigger.type === "once" ? trigger.at : trigger.dtstart,
    trigger.timezone,
    "yyyy-MM-dd",
  );
}

export function triggerTime(trigger: AutomationTrigger): string {
  return formatInTimeZone(
    trigger.type === "once" ? trigger.at : trigger.dtstart,
    trigger.timezone,
    "HH:mm",
  );
}

export function buildTrigger(
  frequency: Frequency,
  date: string,
  time: string,
  timezone: string,
  customRule: string,
): AutomationTrigger {
  const timestamp = fromZonedTime(`${date}T${time || "00:00"}`, timezone).getTime();
  if (frequency === "once") return { version: 1, type: "once", at: timestamp, timezone };
  const weekday = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][
    new Date(`${date}T12:00:00Z`).getUTCDay()
  ];
  const rrule =
    frequency === "hourly"
      ? "FREQ=HOURLY;INTERVAL=1"
      : frequency === "daily"
        ? "FREQ=DAILY;INTERVAL=1"
        : frequency === "weekdays"
          ? "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"
          : frequency === "weekly"
            ? `FREQ=WEEKLY;BYDAY=${weekday}`
            : frequency === "monthly"
              ? `FREQ=MONTHLY;BYMONTHDAY=${Number(date.slice(-2))}`
              : customRule.replace(/^RRULE:/i, "").trim();
  return { version: 1, type: "recurring", dtstart: timestamp, timezone, rrule };
}
