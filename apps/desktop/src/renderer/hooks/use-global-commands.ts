import {
  Activity,
  BarChart3,
  Bot,
  Copy,
  Code2,
  Cpu,
  Download,
  FileSearch,
  FolderTree,
  GitFork,
  GitPullRequest,
  Layers2,
  Inbox,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  PanelBottomClose,
  PanelBottomOpen,
  PanelRightClose,
  PanelRightOpen,
  RotateCw,
  ScanSearch,
  Redo2,
  Settings2,
  Shrink,
  Sparkles,
  SquarePen,
  TextCursorInput,
  Trash2,
  TextSearch,
  Undo2,
} from "lucide-react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import type { PalotSession } from "../../shared";
import { useAttentionItems } from "./use-attention-items";
import { catalogSessionIsUnread } from "./use-session-info";
import { commandPaletteReturnFocusAtom, navigationOpenAtom, sidebarModeAtom } from "../atoms/ui";
import { composerActionRequestAtom, type ComposerAction } from "../atoms/command-requests";
import { runtimeAtom } from "../atoms/workspace";
import { useWorkbenchCommands, useWorkbenchScope } from "../atoms/workbench";
import { toast } from "../components/ui/toast";
import {
  formatRelativeTime,
  projectForSession,
  projectLocation,
  projectName,
  visibleProjects,
} from "../lib/view-models";
import { palotBuild } from "../lib/build";
import { writeClipboardText } from "../lib/clipboard";
import type { GlobalCommand } from "../lib/global-commands";
import { boundShortcutKeys, useShortcutOverrides } from "../lib/keyboard-shortcuts";
import {
  paletteTaskCommandID,
  RECENT_TASK_LIMIT,
  type PaletteTask,
  type PaletteTaskStatus,
} from "../lib/palette-tasks";
import { cacheSessions } from "../lib/session-catalog-query";
import { SETTINGS_NAV_ITEMS } from "../lib/settings-navigation";
import { showErrorToast } from "../lib/toast-error";
import {
  readDiagnosticsPreferences,
  subscribeDiagnosticsPreferences,
  updateDiagnosticsPreferences,
} from "../lib/diagnostics-preferences";
import { palot } from "../services/palot";
import { openNewWorkbenchTerminal } from "../services/workbench-terminal";
import { usePalotNavigation } from "./use-navigation";
import { openTranscriptFindAtom } from "../components/transcript-find";
import { useSessionActivity } from "./use-session-activity";
import { useSessionFork } from "./use-session-fork";
import { useProjectCatalog, useSessionCatalog } from "./use-session-catalog";

interface UseGlobalCommandsOptions {
  /** Root tasks in recent-first order, including search results; see `mergePaletteTasks`. */
  tasks: readonly PaletteTask[];
  /** Loaded tasks in recent-first order; the first nine own Alt+1…Alt+9. */
  recentTasks: readonly PaletteTask[];
  onChooseProject(): void;
  /** Shows the palette on the Files tab for the open task. */
  onOpenFiles(): void;
}

export function useGlobalCommands({
  tasks,
  recentTasks,
  onChooseProject,
  onOpenFiles,
}: UseGlobalCommandsOptions) {
  // Command shortcuts follow personal bindings.
  useShortcutOverrides();
  const allProjects = useProjectCatalog();
  const loadedSessions = useSessionCatalog();
  const queryClient = useQueryClient();
  const runtime = useAtomValue(runtimeAtom);
  const activity = useSessionActivity().data;
  const attentionItems = useAttentionItems();
  const [navigationOpen, setNavigationOpen] = useAtom(navigationOpenAtom);
  const [sidebarMode, setSidebarMode] = useAtom(sidebarModeAtom);
  const diagnosticsPreferences = useSyncExternalStore(
    subscribeDiagnosticsPreferences,
    readDiagnosticsPreferences,
    readDiagnosticsPreferences,
  );
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const routeProjectID = useRouterState({
    select: (state) => {
      const projectID = (state.location.search as { projectID?: unknown }).projectID;
      return typeof projectID === "string" ? projectID : null;
    },
  });
  const openTranscriptFind = useSetAtom(openTranscriptFindAtom);
  const requestComposerAction = useSetAtom(composerActionRequestAtom);
  const setPaletteReturnFocus = useSetAtom(commandPaletteReturnFocusAtom);
  const forkSession = useSessionFork();
  const sessionID = useRouterState({
    select: (state) => {
      const value = state.matches
        .map((match) => match.params as { sessionID?: string })
        .find((params) => params.sessionID)?.sessionID;
      return typeof value === "string" ? value : null;
    },
  });
  const {
    openNewTask,
    openPullRequests,
    openSession,
    openSettings,
    openUsage,
    openWelcome,
    preloadSession,
  } = usePalotNavigation();
  const projects = visibleProjects(allProjects);
  const selectedSession = loadedSessions.find((session) => session.id === sessionID) ?? null;
  const workbenchScope = runtime && sessionID ? { profileID: runtime.profileID, sessionID } : null;
  const workbench = useWorkbenchScope(workbenchScope);
  const workbenchCommands = useWorkbenchCommands(workbenchScope);
  const currentProject = selectedSession
    ? projectForSession(allProjects, selectedSession)
    : projects.find((project) => project.id === routeProjectID);
  const workspaceRoute = !pathname.startsWith("/settings");
  const changesPane = (["right", "bottom"] as const).find((pane) =>
    workbench[pane].tabs.some((tab) => tab.kind === "changes"),
  );
  const changesTab = changesPane
    ? workbench[changesPane].tabs.find((tab) => tab.kind === "changes")
    : undefined;
  const changesOpen = Boolean(
    changesPane &&
    changesTab &&
    workbench[changesPane].requestedOpen &&
    workbench[changesPane].activeTabID === changesTab.id,
  );
  const terminalPane = (["bottom", "right"] as const).find((pane) =>
    workbench[pane].tabs.some((tab) => tab.kind === "terminal"),
  );
  const terminalTab = terminalPane
    ? workbench[terminalPane].tabs.find((tab) => tab.kind === "terminal")
    : undefined;
  const terminalOpen = Boolean(
    terminalPane &&
    terminalTab &&
    workbench[terminalPane].requestedOpen &&
    workbench[terminalPane].activeTabID === terminalTab.id,
  );
  const attentionSessionIDs = new Set(attentionItems.map((item) => item.sessionID));

  const projectCommands: GlobalCommand[] = projects.map((project) => ({
    id: `project.newTask:${project.id}`,
    title: `在 ${projectName(project)} 中新建任务`,
    description: projectLocation(project),
    group: "projects",
    icon: SquarePen,
    keywords: [project.name ?? "", project.canonical, ...project.sandboxes],
    kind: "project",
    run: () => openNewTask(project.id),
  }));

  const sessionRunning = (id: string) => {
    const status = activity?.statuses.get(id);
    return (
      activity?.execution.get(id)?.status === "running" ||
      status?.type === "busy" ||
      status?.type === "retry"
    );
  };

  /** Actions on the open task. Draft and menu actions go to its composer. */
  const taskActionCommands = (id: string): GlobalCommand[] => {
    const connectionID = runtime?.connectionID;
    const composerAction = (action: ComposerAction) =>
      requestComposerAction({
        action,
        profileID: runtime?.profileID ?? null,
        sessionID: id,
        requestedAt: Date.now(),
      });
    return [
      {
        id: "task.files.open",
        title: "打开文件",
        description: "搜索此任务的文件并在工作台中打开",
        group: "actions",
        icon: FileSearch,
        keywords: ["go to file", "quick open", "find file", "workspace", "/open"],
        kind: "action",
        closeOnRun: false,
        run: onOpenFiles,
      },
      {
        id: "task.fork",
        title: "分叉任务",
        description: "在新任务中继续此任务的历史",
        group: "actions",
        icon: GitFork,
        keywords: ["branch", "duplicate", "copy", "/fork"],
        kind: "action",
        run: async () => {
          try {
            await forkSession({ sessionID: id });
          } catch (error) {
            showErrorToast("无法分叉任务", error);
          }
        },
      },
      {
        id: "task.export",
        title: "导出任务",
        description: "将此任务的记录保存到文件",
        group: "actions",
        icon: Download,
        keywords: ["save", "download", "transcript", "json", "/export"],
        kind: "action",
        run: async () => {
          try {
            const path = await palot.exportSession(id, selectedSession?.title, connectionID);
            if (path) toast.add({ type: "success", title: "任务已导出", description: path });
          } catch (error) {
            showErrorToast("无法导出任务", error);
          }
        },
      },
      {
        id: "task.compact",
        title: "压缩任务",
        description: "总结对话历史以释放上下文空间",
        group: "actions",
        icon: Shrink,
        keywords: ["summarize", "context", "tokens", "/compact"],
        kind: "action",
        run: async () => {
          try {
            await palot.compactSession(id);
          } catch (error) {
            showErrorToast("压缩失败", error);
          }
        },
      },
      {
        id: "task.undo",
        title: "撤销上一步",
        description: "撤销上一步对话及其文件更改",
        group: "actions",
        icon: Undo2,
        keywords: ["revert", "rollback", "/undo"],
        kind: "action",
        runAfterClose: true,
        run: () => composerAction("undo"),
      },
      {
        id: "task.redo",
        title: "重做步骤",
        description: "重做一步已暂存的对话",
        group: "actions",
        icon: Redo2,
        keywords: ["restore", "/redo"],
        kind: "action",
        disabledReason: selectedSession && !selectedSession.revert ? "没有可重做的" : undefined,
        runAfterClose: true,
        run: () => composerAction("redo"),
      },
      {
        id: "task.background",
        title: "将工作移至后台",
        description: "让运行中的子代理和 shell 继续运行，不阻塞任务",
        group: "actions",
        icon: Layers2,
        keywords: ["subagent", "shell", "detach", "unblock"],
        kind: "action",
        disabledReason: sessionRunning(id) ? undefined : "没有正在运行的工作",
        run: async () => {
          try {
            await palot.backgroundSession(id);
          } catch (error) {
            showErrorToast("无法将工作移至后台", error);
          }
        },
      },
      {
        id: "task.model",
        title: "更改模型",
        description: "选择此任务的模型",
        group: "actions",
        icon: Cpu,
        keywords: ["provider", "llm", "switch", "/model"],
        kind: "action",
        runAfterClose: true,
        run: () => {
          // The model menu takes focus; the palette must not hand it back on close.
          setPaletteReturnFocus(null);
          composerAction("model");
        },
      },
      {
        id: "task.agent",
        title: "更改代理",
        description: "选择此任务的主代理",
        group: "actions",
        icon: Bot,
        keywords: ["build", "plan", "mode", "switch", "/agent"],
        kind: "action",
        runAfterClose: true,
        run: () => {
          setPaletteReturnFocus(null);
          composerAction("agent");
        },
      },
    ];
  };

  const commands: GlobalCommand[] = [];
  commands.push({
    id: "task.new",
    title: "新建任务",
    description: "选择服务器和项目，然后启动任务",
    group: "actions",
    icon: SquarePen,
    keywords: ["create", "conversation", "thread"],
    shortcut: boundShortcutKeys("task.new"),
    suggested: true,
    kind: "action",
    run: () => openNewTask(),
  });
  if (projects.length > 0) {
    commands.push({
      id: "task.choose-project",
      title: "为新任务选择项目",
      group: "actions",
      icon: SquarePen,
      keywords: ["new task", "project", "folder"],
      shortcut: boundShortcutKeys("task.choose-project"),
      defaultVisible: true,
      kind: "action",
      closeOnRun: false,
      run: onChooseProject,
    });
  }

  if (workspaceRoute) {
    commands.push(
      {
        id: "navigation.toggle",
        title: navigationOpen ? "隐藏导航栏" : "显示导航栏",
        group: "actions",
        icon: navigationOpen ? PanelLeftClose : PanelLeftOpen,
        keywords: ["sidebar", "panel", "projects", "inbox"],
        shortcut: boundShortcutKeys("navigation.toggle"),
        suggested: true,
        kind: "action",
        run: () => setNavigationOpen(!navigationOpen),
      },
      {
        id: "sidebar.mode.toggle",
        title: sidebarMode === "inbox" ? "显示项目" : "显示收件箱",
        description:
          sidebarMode === "inbox"
            ? "将侧边栏切换到项目"
            : "将侧边栏切换到收件箱",
        group: "actions",
        icon: sidebarMode === "inbox" ? FolderTree : Inbox,
        keywords: ["sidebar", "tasks", "attention"],
        suggested: true,
        kind: "action",
        run: () => setSidebarMode(sidebarMode === "inbox" ? "project" : "inbox"),
      },
    );
  }

  if (sessionID) {
    if (selectedSession && runtime?.capabilities?.localPathActions === true) {
      commands.push({
        id: "task.openExternal",
        title: "在首选应用中打开检出",
        description: "在首选编辑器中打开此任务的检出",
        group: "actions",
        icon: Code2,
        keywords: ["editor", "IDE", "Cursor", "VS Code", "Zed", "Finder"],
        suggested: true,
        kind: "action",
        run: async () => {
          await palot.externalOpen(
            {
              resource: { kind: "session-directory", sessionID: selectedSession.id },
            },
            runtime?.connectionID,
          );
        },
      });
    }
    commands.push(
      {
        id: "task.changes.toggle",
        title: changesOpen ? "隐藏变更" : "显示变更",
        description: changesOpen
          ? "关闭任务变更面板"
          : "打开此任务修改的文件",
        group: "actions",
        icon: changesOpen ? PanelRightClose : PanelRightOpen,
        keywords: ["diff", "files", "inspector"],
        shortcut: boundShortcutKeys("task.changes.toggle"),
        suggested: true,
        kind: "action",
        run: () => {
          if (!selectedSession) return;
          if (!changesPane || !changesTab) {
            workbenchCommands.openTab({
              kind: "changes",
              location: selectedSession.location,
              mode: "working",
              sourceSessionID: sessionID,
            });
            return;
          }
          if (changesOpen) {
            workbenchCommands.togglePane(changesPane);
            return;
          }
          workbenchCommands.activateTab(changesPane, changesTab.id);
        },
      },
      {
        id: "task.terminal.toggle",
        title: terminalOpen ? "隐藏终端" : "显示终端",
        description: terminalOpen
          ? "关闭终端面板但不停止其 OpenCode PTY"
          : "打开交互式 OpenCode 终端",
        group: "actions",
        icon: terminalOpen ? PanelBottomClose : PanelBottomOpen,
        keywords: ["terminal", "shell", "pty", "bottom panel"],
        shortcut: boundShortcutKeys("task.terminal.toggle"),
        suggested: true,
        kind: "action",
        run: async () => {
          if (!selectedSession) return;
          if (!terminalPane || !terminalTab) {
            await openNewWorkbenchTerminal(
              selectedSession.id,
              selectedSession.location,
              workbenchCommands.openTab,
              undefined,
              runtime?.connectionID,
            );
            return;
          }
          if (terminalOpen) {
            workbenchCommands.togglePane(terminalPane);
            return;
          }
          workbenchCommands.activateTab(terminalPane, terminalTab.id);
        },
      },
      {
        id: "task.find",
        title: "在任务中查找",
        description: "搜索此任务的消息",
        group: "actions",
        icon: TextSearch,
        keywords: ["search", "find", "transcript", "messages"],
        shortcut: boundShortcutKeys("task.find"),
        kind: "action",
        runAfterClose: true,
        run: () => openTranscriptFind(),
      },
      ...taskActionCommands(sessionID),
      {
        id: "task.copyId",
        title: "复制任务 ID",
        description: sessionID,
        group: "actions",
        icon: Copy,
        keywords: ["session", "identifier", "clipboard"],
        kind: "action",
        run: async () => {
          await writeClipboardText(sessionID);
          toast.add({ type: "success", title: "任务 ID 已复制" });
        },
      },
    );
  }

  if (workspaceRoute) {
    commands.push({
      id: "task.focusComposer",
      title: "聚焦输入框",
      description: "将光标移到消息输入框",
      group: "actions",
      icon: TextCursorInput,
      keywords: ["prompt", "message", "input", "write"],
      shortcut: boundShortcutKeys("composer.focus"),
      defaultVisible: true,
      kind: "action",
      runAfterClose: true,
      run: () => document.querySelector<HTMLElement>("[data-palot-composer-input]")?.focus(),
    });
  }

  commands.push(
    {
      id: "onboarding.open",
      title: "打开欢迎指南",
      description: "查看项目、服务器连接以及 Palot 如何展示 OpenCode 工作",
      group: "actions",
      icon: Sparkles,
      keywords: ["onboarding", "setup", "getting started", "providers"],
      kind: "setting",
      run: () => openWelcome(),
    },
    {
      id: "usage.open",
      title: "用量",
      description: "查看本地 OpenCode 活动、模型开销和工具可靠性",
      group: "actions",
      icon: BarChart3,
      keywords: ["tokens", "cost", "models", "statistics", "activity"],
      defaultVisible: true,
      kind: "action",
      run: () => openUsage(),
    },
    {
      id: "pull-requests.open",
      title: "拉取请求",
      description: "查看被请求评审、自己创建和最近合并的 GitHub 拉取请求",
      group: "actions",
      icon: GitPullRequest,
      keywords: ["github", "pr", "review", "merge"],
      defaultVisible: true,
      kind: "action",
      run: () => openPullRequests(),
    },
    ...SETTINGS_NAV_ITEMS.toSorted(
      (left, right) => Number(right.id === "general") - Number(left.id === "general"),
    ).map((item): GlobalCommand => ({
      id: `settings.open:${item.id}`,
      title: item.id === "general" ? "Settings" : item.label,
      description: item.description,
      group: "settings",
      icon: item.id === "general" ? Settings2 : item.icon,
      keywords: [item.keywords, "preferences"],
      shortcut: item.id === "general" ? boundShortcutKeys("settings.open") : undefined,
      kind: "setting",
      run: () => openSettings(item.id, routeProjectID ?? currentProject?.id),
    })),
  );

  const reactScanEnabled = diagnosticsPreferences.reactScanEnabled ?? __PALOT_REACT_SCAN_DEFAULT__;
  const runtimeSummary = runtime
    ? {
        connected: runtime.connected,
        phase: runtime.phase,
        version: runtime.version,
        managed: runtime.managed,
      }
    : null;
  commands.push(
    {
      id: "diagnostics.overlay.toggle",
      title: diagnosticsPreferences.overlayVisible
        ? "隐藏诊断覆盖层"
        : "显示诊断覆盖层",
      description: "切换实时 CPU、内存、帧、长任务和流式信号",
      group: "diagnostics",
      icon: Activity,
      keywords: ["performance", "hud", "fps", "memory", "cpu"],
      trailing: diagnosticsPreferences.overlayVisible ? "开启" : "关闭",
      defaultVisible: true,
      kind: "action",
      run: () => {
        updateDiagnosticsPreferences({
          overlayVisible: !diagnosticsPreferences.overlayVisible,
        });
      },
    },
    {
      id: "diagnostics.capture",
      title: "立即采集诊断",
      description: "刷新当前 Electron 进程和 GPU 快照",
      group: "diagnostics",
      icon: RotateCw,
      keywords: ["refresh", "sample", "performance"],
      kind: "action",
      run: async () => {
        const diagnostics = await loadDiagnosticsController();
        await diagnostics.captureNow();
        toast.add({ type: "success", title: "诊断已刷新" });
      },
    },
    {
      id: "diagnostics.copy",
      title: "复制诊断报告",
      description: "复制不含任务内容、路径或凭据的安全报告",
      group: "diagnostics",
      icon: Copy,
      keywords: ["support", "clipboard", "export", "report"],
      kind: "action",
      run: async () => {
        const diagnostics = await loadDiagnosticsController();
        await diagnostics.copySafeReport(runtimeSummary);
        toast.add({ type: "success", title: "诊断已复制" });
      },
    },
    {
      id: "diagnostics.history.clear",
      title: "清除诊断历史",
      description: "丢弃有界的内存历史记录",
      group: "diagnostics",
      icon: Trash2,
      keywords: ["reset", "samples"],
      kind: "action",
      run: async () => {
        const diagnostics = await loadDiagnosticsController();
        diagnostics.clearHistory();
        toast.add({ type: "success", title: "诊断历史已清除" });
      },
    },
    {
      id: "diagnostics.reactScan.toggle",
      title: reactScanEnabled ? "禁用 React Scan 并重新加载" : "启用 React Scan 并重新加载",
      description: "切换组件渲染轮廓",
      group: "diagnostics",
      icon: ScanSearch,
      keywords: ["react", "renders", "profiler", "instrumentation"],
      trailing: reactScanEnabled ? "开启" : "关闭",
      kind: "action",
      run: () => {
        updateDiagnosticsPreferences({ reactScanEnabled: !reactScanEnabled });
        window.location.reload();
      },
    },
  );

  if (palotBuild.channel !== "stable") {
    commands.push({
      id: "app.restart",
      title: "重启 Palot",
      description: "重启开发应用",
      group: "development",
      icon: RotateCw,
      keywords: ["reload", "development"],
      shortcut: boundShortcutKeys("app.restart"),
      kind: "action",
      run: () =>
        palot
          .restartApp("从命令面板请求的重启")
          .catch((error) => showErrorToast("无法重启 Palot", error)),
    });
  }

  const focusedProfileID = runtime?.profileID ?? null;
  const recentIndex = new Map(
    recentTasks
      .slice(0, RECENT_TASK_LIMIT)
      .map((task, index) => [paletteTaskCommandID(task), index] as const),
  );
  const focusedStatus = (session: PalotSession): PaletteTaskStatus | undefined =>
    attentionSessionIDs.has(session.id)
      ? "attention"
      : sessionRunning(session.id)
        ? "running"
        : catalogSessionIsUnread(session)
          ? "unread"
          : undefined;
  commands.push(
    ...tasks.map((task): GlobalCommand => {
      const { session } = task;
      const id = paletteTaskCommandID(task);
      const shortcutIndex = recentIndex.get(id);
      const focused = task.profileID === null || task.profileID === focusedProfileID;
      const project = focused ? projectForSession(allProjects, session) : undefined;
      const location = task.projectName ?? (project ? projectName(project) : null);
      const retainSession = () =>
        cacheSessions(queryClient, task.connectionID ?? runtime?.connectionID ?? "disconnected", [
          session,
        ]);
      return {
        id,
        title: session.title ?? "未命名任务",
        description: [location ?? session.location.directory, task.serverName]
          .filter(Boolean)
          .join(" · "),
        group: "tasks",
        icon: MessageSquare,
        keywords: [
          session.id,
          project?.canonical ?? "",
          project?.name ?? "",
          task.projectName ?? "",
          task.serverName ?? "",
          session.location.directory,
          "thread",
          "conversation",
        ],
        shortcut: shortcutIndex === undefined ? undefined : ["Alt", String(shortcutIndex + 1)],
        trailing: formatRelativeTime(session.updatedAt),
        status: task.status ?? (focused ? focusedStatus(session) : undefined),
        kind: "task",
        run: () => {
          retainSession();
          return task.profileID === null
            ? openSession(session.id)
            : openSession(session.id, { profileID: task.profileID });
        },
        preload: () => {
          if (!task.connected) return;
          retainSession();
          return preloadSession(session.id, task.profileID ?? undefined);
        },
      };
    }),
    ...projectCommands,
  );

  return { commands, projectCommands };
}

async function loadDiagnosticsController() {
  return (await import("../lib/diagnostics-controller")).diagnostics;
}
