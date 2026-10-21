import {
  ArrowLeft,
  Bell,
  Boxes,
  Braces,
  BrainCircuit,
  Check,
  CircleAlert,
  Code2,
  Command,
  Download,
  FileCog,
  FolderGit2,
  ExternalLink,
  Link2,
  LoaderCircle,
  Monitor,
  Moon,
  Palette,
  PlugZap,
  Plus,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { useAtom, useAtomValue } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import type { LocationRef } from "@opencode/client";
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  APPEARANCE_MODES,
  APPEARANCE_THEMES,
  CODE_FONT_OPTIONS,
  CODE_THEME_IDS,
  CODE_THEME_OPTIONS,
  DEFAULT_APPEARANCE_PREFERENCES,
  NATIVE_GLASS_VARIANTS,
  SIDEBAR_MATERIALS,
  UI_FONT_OPTIONS,
  WINDOW_MATERIALS,
  effectiveAppearanceTreatment,
  appearanceTheme,
  effectiveNativeGlass,
} from "../../shared";
import type {
  AppearanceMode,
  AppearancePreferences,
  AppearanceTerminalPalette,
  AppearanceThemeID,
  AppearanceThemeVariant,
  CodeThemeID,
  AutomationHostSettings,
  DesktopNotificationDeliveryStatus,
  DesktopNotificationSettings,
  PalotMcpConfig,
  PalotMcpServer,
  PalotPlugin,
  PalotProject,
  PalotSettingsSnapshot,
  SettingsCapability,
} from "../../shared";
import {
  autoBackgroundOnSteerAtom,
  browserLocalLinksAtom,
  browserSearchEngineAtom,
  browserShowFullURLAtom,
  browserWebLinksAtom,
  compactBeforeSendSuggestionAtom,
  contextMeterVisibleAtom,
  defaultDeliveryAtom,
  remoteMarkdownFaviconsAtom,
  showTimelineCacheBustsAtom,
  defaultSidebarModeAtom,
  autoSettleAfterDaysAtom,
  AUTO_SETTLE_DAY_CHOICES,
  type AutoSettleAfterDays,
  defaultWorktreeBaseAtom,
  defaultWorkspaceModeAtom,
  experimentalBrowserAtom,
  sessionProjectionPreferenceAtom,
} from "../atoms/ui";
import {
  appearancePreferencesAtom,
  appearanceRestartRequiredAtom,
  resolvedAppearanceAtom,
} from "../atoms/appearance";
import { MarkdownCodeBlock } from "./markdown-code-block";
import { runtimeAtom } from "../atoms/workspace";
import { desktopNotificationSettingsAtom } from "../atoms/notification-sounds";
import { cn } from "../lib/cn";
import { showErrorToast } from "../lib/toast-error";
import { openCodeKeys } from "../lib/opencode-query";
import { isAppearanceFontAvailable } from "../lib/font-loading";
import { SETTINGS_NAV_ITEMS, type SettingsCategory } from "../lib/settings-navigation";
import {
  ACTIVITY_CATEGORIES,
  resolveSessionProjectionPreference,
  type ActivityCategory,
  type ActivityProjectionPreference,
  type GroupTitleMode,
  type SessionProjectionPreset,
} from "../lib/session-projection-policy";
import { projectForSession, projectLocation, orderProjects } from "../lib/view-models";
import { palotBuild } from "../lib/build";
import { usePalotNavigation } from "../hooks/use-navigation";
import { useCheckPlugins, useSettingsSnapshot } from "../hooks/use-settings-snapshot";
import { useSelectedSession } from "../hooks/use-session-catalog";
import { SettingsOwnerContext, useSettingsOwner } from "../hooks/use-settings-owner";
import { useSettingsServer } from "../hooks/use-settings-server";
import { palot } from "../services/palot";
import { BuildBadge, PalotMark } from "./branding";
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
import { Button } from "./ui/button";
import { AppIcon, type AppIconName } from "./ui/app-icon";
import { Badge } from "./ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { ProjectSelect } from "./project-select";
import { ProjectSettings, projectDetailsKey } from "./project-settings";
import { ScrollArea } from "./ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Slider } from "./ui/slider";
import { sidebarItemVariants, sidebarSectionLabelVariants } from "./ui/sidebar-styles";
import { Switch } from "./ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Textarea } from "./ui/textarea";
import { toast } from "./ui/toast";
import { NavigationRail } from "./navigation-rail";
import { SettingsEmpty, SettingsGroup, SettingsRow, SettingsSection } from "./settings-layout";
import { ModelSettings } from "./settings/models-settings";
import { ProviderSettings } from "./settings/providers-settings";
import { KeyboardShortcutsSettings } from "./keyboard-shortcuts-settings";
import { NotificationSoundSettings } from "./notification-sound-settings";
import { DefaultShellSetting } from "./default-shell-setting";

const CATEGORY_COPY: Record<SettingsCategory, { title: string; description: string }> = {
  general: {
    title: "通用",
    description: "选择新任务如何启动以及 Palot 显示多少活动。",
  },
  browser: {
    title: "浏览器",
    description: "控制浏览器访问、搜索、链接目标和地址显示。",
  },
  project: {
    title: "项目",
    description: "管理项目详情、工作树启动和主检出目录。",
  },
  connections: {
    title: "连接",
    description: "选择 Palot 连接位置以及如何访问 OpenCode。",
  },
  appearance: {
    title: "外观",
    description: "选择工作区的主题、材质和排版。",
  },
  notifications: {
    title: "通知",
    description: "选择 Palot 何时提醒您或为需要您关注的任务播放声音。",
  },
  shortcuts: {
    title: "键盘快捷键",
    description: "Palot 在任务、面板和编辑器中响应的按键。",
  },
  models: {
    title: "模型",
    description:
      "选择新任务使用的默认模型，以及 Palot 选择器中显示哪些模型。连接提供者以添加模型。",
  },
  providers: {
    title: "提供者",
    description:
      "连接模型提供者并管理其凭据。选择要在「模型」中显示哪些提供者的模型。",
  },
  tools: {
    title: "工具",
    description: "管理插件和 MCP 服务器，并浏览此项目发现的工具。",
  },
  agents: {
    title: "智能体",
    description: "查看此项目中可用的主智能体和子智能体。",
  },
  permissions: {
    title: "权限",
    description: "查看已保存的批准和生效的配置策略。",
  },
  config: {
    title: "配置",
    description: "查看 OpenCode 解析的配置源和能力。",
  },
  diagnostics: {
    title: "诊断",
    description: "查看实时渲染器、Electron、GPU 和 OpenCode 运行时信号。",
  },
  about: {
    title: "关于",
    description: "查看 Palot 构建详情和已连接的 OpenCode 服务。",
  },
};

const SETTINGS_APP_ICONS: Record<SettingsCategory, AppIconName> = {
  project: "config",
  general: "settings",
  browser: "browser",
  appearance: "appearance",
  notifications: "notifications",
  shortcuts: "keyboard",
  connections: "servers",
  models: "models",
  providers: "providers",
  tools: "tools",
  agents: "agents",
  permissions: "permissions",
  config: "config",
  diagnostics: "diagnostics",
  about: "info",
};

const DiagnosticsSettings = lazy(() =>
  import("./diagnostics-settings").then((module) => ({ default: module.DiagnosticsSettings })),
);
const ConnectionSettings = lazy(() =>
  import("./connection-settings").then((module) => ({ default: module.ConnectionSettings })),
);

const SETTINGS_CAPABILITIES: Partial<Record<SettingsCategory, SettingsCapability[]>> = {
  models: ["catalog", "config", "agents"],
  providers: ["integrations", "catalog", "config"],
  tools: [
    "mcp",
    "mcpResources",
    "plugins",
    "skills",
    "commands",
    "references",
    "websearchProviders",
  ],
  agents: ["agents"],
  permissions: ["config", "savedPermissions"],
  config: ["config"],
};

export function Settings({
  category,
  projectID: routeProjectID,
  connectionTab = "profiles",
}: {
  category: SettingsCategory;
  projectID?: string;
  connectionTab?: "profiles" | "web-access" | "local-service";
}) {
  const { closeSettings, openSettings } = usePalotNavigation();
  const queryClient = useQueryClient();
  const serverScoped = [
    "project",
    "models",
    "providers",
    "tools",
    "agents",
    "permissions",
    "config",
  ].includes(category);
  const server = useSettingsServer(serverScoped);
  const runtime = server.runtime;
  const allProjects = server.projects;
  const selectedSession = useSelectedSession();
  const selectedRuntime = useAtomValue(runtimeAtom);
  const [entryTask] = useState(() => ({
    session: selectedSession,
    profileID: selectedRuntime?.profileID,
  }));
  const session = entryTask.profileID === server.profileID ? entryTask.session : null;
  const projects = orderProjects(allProjects, session ? [session] : []);
  const [projectChoice, setProjectChoice] = useState<string | null>(routeProjectID ?? null);
  const sessionProject = session ? projectForSession(allProjects, session) : undefined;
  const initialProject =
    sessionProject ??
    projects.find((project) => project.id === projectChoice) ??
    projects[0] ??
    null;
  const projectID = projectChoice ?? initialProject?.id ?? "";
  const project = projects.find((item) => item.id === projectID) ?? initialProject;
  const settingsLocation =
    project && session && sessionProject?.id === project.id
      ? session.location
      : project
        ? { directory: projectLocation(project) }
        : null;
  const capabilities = SETTINGS_CAPABILITIES[category];
  const settingsInput =
    capabilities && project && settingsLocation
      ? {
          connectionID: runtime?.connectionID,
          projectID: project.id,
          directory: settingsLocation.directory,
          capabilities,
          ...(settingsLocation.workspaceID ? { workspaceID: settingsLocation.workspaceID } : {}),
        }
      : null;
  const settings = useSettingsSnapshot(settingsInput, serverScoped && server.available, runtime);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key !== "Escape") return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        event.target.blur();
        return;
      }
      event.preventDefault();
      void closeSettings();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeSettings]);

  async function refresh() {
    if (!serverScoped || !server.available) return;
    if (!project || server.projectError) {
      await queryClient.invalidateQueries({
        queryKey: openCodeKeys.projects(runtime!.connectionID),
      });
      return;
    }
    if (category === "project" && project) {
      await queryClient.invalidateQueries({
        queryKey: projectDetailsKey(runtime?.connectionID ?? "disconnected", project.id),
      });
      return;
    }
    await settings.refetch();
  }

  const normalizedQuery = query.trim().toLowerCase();
  const visibleSnapshot = settings.data ?? null;
  const capabilityStates: Partial<Record<SettingsCapability, InventoryLoadState>> = {};
  for (const capability of capabilities ?? []) {
    const queryState = settingsInput
      ? queryClient.getQueryState(
          openCodeKeys.settingsSnapshot(runtime?.connectionID ?? "disconnected", {
            ...settingsInput,
            capabilities: [capability],
          }),
        )
      : undefined;
    capabilityStates[capability] = queryState?.error
      ? { status: "error", message: queryState.error.message }
      : queryState?.data
        ? inventoryState(visibleSnapshot, capability)
        : { status: queryState?.fetchStatus === "fetching" ? "loading" : "unavailable" };
  }
  const loading = settings.isFetching;
  const error = settings.error
    ? settings.error instanceof Error
      ? settings.error.message
      : "无法加载 OpenCode 设置。"
    : null;
  const visibleNav = normalizedQuery
    ? SETTINGS_NAV_ITEMS.filter((item) =>
        `${item.label} ${item.description} ${item.keywords}`
          .toLowerCase()
          .includes(normalizedQuery),
      )
    : SETTINGS_NAV_ITEMS;
  const activeCopy = CATEGORY_COPY[category];

  return (
    <main
      className="flex size-full min-h-0 flex-col bg-transparent md:flex-row"
      aria-label="设置"
    >
      <div className="palot-navigation-rail hidden shrink-0 flex-col bg-sidebar md:flex">
        <div className="window-drag h-(--shell-header-height) shrink-0" aria-hidden="true" />
        <NavigationRail className="min-h-0 flex-1" />
      </div>
      <aside className="palot-settings-sidebar flex max-h-[196px] shrink-0 flex-col border-b border-sidebar-border bg-sidebar pt-(--shell-header-height) md:max-h-none md:w-[248px] md:border-r md:border-b-0">
        <div className="px-3 pt-3 pb-2 md:px-3.5">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              autoFocus
              value={query}
              placeholder="搜索设置"
              aria-label="搜索设置"
              className="h-8 bg-background/55 pr-8 pl-8"
              onChange={(event) => setQuery(event.target.value)}
            />
            {query ? (
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label="清除设置搜索"
                className="absolute top-1/2 right-1.5 -translate-y-1/2"
                onClick={() => setQuery("")}
              >
                <X aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        </div>
        <ScrollArea className="min-h-0 flex-1 px-2 md:px-2.5">
          <nav
            className="flex gap-1 py-1 md:flex md:flex-col md:gap-3"
            aria-label="设置分类"
          >
            {(["Palot", "OpenCode", "系统"] as const).map((group) => {
              const items = visibleNav.filter((item) => item.group === group);
              if (items.length === 0) return null;
              return (
                <div key={group} className="contents md:flex md:flex-col md:gap-px">
                  <div className={cn("hidden md:flex", sidebarSectionLabelVariants())}>{group}</div>
                  <div className="flex gap-1 md:flex md:flex-col md:gap-px">
                    {items.map((item) => {
                      return (
                        <button
                          key={item.id}
                          type="button"
                          data-active={category === item.id || undefined}
                          aria-current={category === item.id ? "page" : undefined}
                          title={item.description}
                          className={cn(
                            "group flex shrink-0 items-center text-left md:w-full",
                            sidebarItemVariants(),
                            "data-[active]:bg-(--palot-sidebar-selected) data-[active]:font-medium data-[active]:text-sidebar-foreground",
                          )}
                          onClick={() => void openSettings(item.id, project?.id, true)}
                        >
                          <AppIcon
                            name={SETTINGS_APP_ICONS[item.id]}
                            className="size-3.5 shrink-0 opacity-75 group-data-[active]:opacity-100"
                            aria-hidden="true"
                          />
                          <span>{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {visibleNav.length === 0 ? (
              <p className="px-3 py-5 text-center text-xs text-muted-foreground">
                没有匹配“{query}”的设置。
              </p>
            ) : null}
          </nav>
        </ScrollArea>
        <div className="hidden border-t border-sidebar-border p-2 md:block">
          <Button
            type="button"
            variant="ghost"
            className="h-9 w-full justify-start gap-2 px-2.5"
            onClick={() => void closeSettings()}
          >
            <ArrowLeft aria-hidden="true" />
            返回任务
          </Button>
        </div>
      </aside>
      <section className="palot-main-surface @container/settings-page relative flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        <header className="palot-main-surface-header window-drag flex h-(--shell-header-height) shrink-0 items-center gap-2 border-b border-sidebar-border bg-background px-5 pr-(--window-controls-width)">
          <div className="flex min-w-0 items-center gap-2 pl-1">
            <span className="text-sm font-semibold">设置</span>
            <span className="text-muted-foreground/45">/</span>
            <span className="truncate text-xs text-muted-foreground">{activeCopy.title}</span>
          </div>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            {serverScoped ? (
              <Select
                value={server.profileID}
                onValueChange={(value) => {
                  if (!value) return;
                  server.setProfileID(value);
                  setProjectChoice(null);
                }}
              >
                <SelectTrigger
                  aria-label="配置服务器"
                  className="window-no-drag w-auto min-w-28 max-w-52"
                >
                  <SelectValue className="min-w-0 truncate" placeholder="配置服务器">
                    {server.profiles.find((profile) => profile.id === server.profileID)?.name ??
                      runtime?.profileID ??
                      "选择服务器"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {server.profiles.length === 0 && server.profileID ? (
                    <SelectItem value={server.profileID}>
                      {runtime?.profileID ?? server.profileID}
                    </SelectItem>
                  ) : null}
                  {server.profiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            {serverScoped && projects.length > 1 ? (
              <ProjectSelect
                projects={projects}
                value={project?.id ?? null}
                onValueChange={(value) => value && setProjectChoice(value)}
                ariaLabel="设置项目"
                align="end"
                variant="settings"
              />
            ) : null}
            {serverScoped ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="刷新设置"
                disabled={loading || server.projectsPending || !server.available}
                onClick={() => void refresh()}
              >
                <RefreshCw className={loading ? "animate-spin" : undefined} aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        </header>
        <ScrollArea className="min-h-0 flex-1">
          <div
            className={cn(
              "mx-auto flex w-full flex-col gap-8 px-4 py-6 @2xl/settings-page:px-8",
              category === "diagnostics" ? "max-w-[1180px]" : "max-w-5xl",
            )}
          >
            <div className="space-y-2">
              <h1 className="text-page-title font-semibold">{activeCopy.title}</h1>
              <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
                {activeCopy.description}
              </p>
            </div>
            {serverScoped ? (
              <p role="status" className="text-sm text-muted-foreground">
                {server.status}
                {server.available
                  ? " · Changes apply only to this server. Your open task stays on its server."
                  : " · Settings are read-only. Enable and connect this server in Connections to make changes."}
              </p>
            ) : null}
            {serverScoped && server.projectError ? (
              <p role="alert" className="text-sm text-destructive">
                {server.projectError.message}
              </p>
            ) : null}
            {visibleSnapshot?.errors.length ? (
              <div className="rounded-xl border border-warning/25 bg-warning/5 p-4 text-compact">
                <div className="flex items-center gap-2 font-medium text-warning">
                  <CircleAlert className="size-4" aria-hidden="true" />
                  Some settings need attention
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {visibleSnapshot.errors.map((item) => (
                    <Badge
                      key={`${item.capability}:${item.message}`}
                      variant="outline"
                      title={item.message}
                    >
                      {item.label}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
            {visibleSnapshot && settings.pendingCapabilities.length > 0 ? (
              <p role="status" className="text-compact text-muted-foreground">
                Some settings are still loading. Available settings are shown below.
              </p>
            ) : null}
            {error ? (
              <div className="flex items-start gap-3 rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-xs text-destructive">
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1">{error}</span>
                <Button type="button" variant="ghost" size="xs" onClick={() => void refresh()}>
                  Retry
                </Button>
              </div>
            ) : null}
            {!project &&
            ![
              "general",
              "browser",
              "appearance",
              "notifications",
              "shortcuts",
              "connections",
              "diagnostics",
              "about",
            ].includes(category) ? (
              <SettingsSection title="未选择项目" icon={FolderGit2}>
                <p className="px-4 text-sm text-muted-foreground">
                  {server.projectsPending
                    ? "正在加载此服务器的项目…"
                    : "在配置项目范围的 OpenCode 设置之前，请先在此服务器上添加项目。"}
                </p>
              </SettingsSection>
            ) : (
              <SettingsOwnerContext.Provider value={runtime}>
                <fieldset
                  disabled={serverScoped && !server.available}
                  aria-disabled={serverScoped && !server.available}
                  onClickCapture={(event) => {
                    if (serverScoped && !server.available) {
                      event.preventDefault();
                      event.stopPropagation();
                    }
                  }}
                  onKeyDownCapture={(event) => {
                    if (serverScoped && !server.available && ["Enter", " "].includes(event.key)) {
                      event.preventDefault();
                      event.stopPropagation();
                    }
                  }}
                  className="min-w-0 space-y-8"
                >
                  <SettingsContent
                    key={
                      serverScoped
                        ? `${runtime?.connectionID ?? server.profileID}:${project?.id}:${settingsLocation?.directory}:${settingsLocation?.workspaceID ?? ""}:${server.available}`
                        : category
                    }
                    category={category}
                    project={project}
                    location={settingsLocation}
                    snapshot={visibleSnapshot}
                    loading={loading}
                    pendingCapabilities={settings.pendingCapabilities}
                    capabilityStates={capabilityStates}
                    refresh={refresh}
                    connectionTab={connectionTab}
                  />
                </fieldset>
              </SettingsOwnerContext.Provider>
            )}
          </div>
        </ScrollArea>
      </section>
    </main>
  );
}

function SettingsContent({
  category,
  project,
  location,
  snapshot,
  loading,
  pendingCapabilities,
  capabilityStates,
  refresh,
  connectionTab,
}: {
  category: SettingsCategory;
  project: PalotProject | null;
  location: LocationRef | null;
  snapshot: PalotSettingsSnapshot | null;
  loading: boolean;
  pendingCapabilities: SettingsCapability[];
  capabilityStates: Partial<Record<SettingsCapability, InventoryLoadState>>;
  refresh(): Promise<void>;
  connectionTab: "profiles" | "web-access" | "local-service";
}) {
  if (loading && !snapshot && category !== "tools") return <SettingsSkeleton />;
  if (category === "general") return <GeneralSettings />;
  if (category === "browser") return <BrowserSettings />;
  if (category === "appearance") return <AppearanceSettings />;
  if (category === "notifications") return <NotificationSettings />;
  if (category === "shortcuts") return <KeyboardShortcutsSettings />;
  if (category === "connections") {
    return (
      <Suspense fallback={<SettingsSkeleton />}>
        <ConnectionSettings tab={connectionTab} />
      </Suspense>
    );
  }
  if (category === "diagnostics") {
    return (
      <Suspense fallback={<SettingsSkeleton />}>
        <DiagnosticsSettings />
      </Suspense>
    );
  }
  if (category === "about") return <AboutSettings snapshot={snapshot} />;
  if (category === "config") return <ConfigSettings snapshot={snapshot} refresh={refresh} />;
  if (!project) return null;
  if (category === "project") return <ProjectSettings project={project} />;
  if (category === "models") return <ModelSettings project={project} snapshot={snapshot} />;
  if (category === "providers") {
    return (
      <ProviderSettings
        project={project}
        location={location!}
        snapshot={snapshot}
        refresh={refresh}
      />
    );
  }
  if (category === "tools") {
    return (
      <ToolSettings
        project={project}
        location={location!}
        snapshot={snapshot}
        pendingCapabilities={pendingCapabilities}
        capabilityStates={capabilityStates}
        refresh={refresh}
      />
    );
  }
  if (category === "agents") return <AgentSettings snapshot={snapshot} />;
  if (category === "permissions") {
    return (
      <PermissionSettings
        snapshot={snapshot}
        pendingCapabilities={pendingCapabilities}
        capabilityStates={capabilityStates}
        refresh={refresh}
      />
    );
  }
  return null;
}

const ACTIVITY_CATEGORY_LABELS: Record<ActivityCategory, string> = {
  reasoning: "推理",
  read: "读取",
  "code-search": "代码搜索",
  edit: "编辑",
  command: "命令",
  web: "网页活动",
  delegation: "委托",
  other: "其他工具",
};

const PROJECTION_PRESET_DESCRIPTIONS: Record<SessionProjectionPreset, string> = {
  "code-focus": "保持最终响应突出，活动以摘要形式呈现。",
  compact:
    "保持当前阶段展开并显示推理摘要，已完成工作保持紧凑。",
  expanded: "显示每个活动行，同时保持原始工具输入和输出可检查。",
};

const PROJECTION_PRESET_LABELS: Record<SessionProjectionPreset, string> = {
  "code-focus": "聚焦",
  compact: "平衡",
  expanded: "详细",
};

const ACTIVITY_PRESENTATION_LABELS: Record<ActivityProjectionPreference["presentation"], string> = {
  individual: "单独",
  grouped: "分组",
  hidden: "完成后隐藏",
};

const DETAIL_DEFAULT_LABELS: Record<ActivityProjectionPreference["details"], string> = {
  collapsed: "折叠",
  expanded: "展开",
};

const FOLDED_TURN_LABELS: Record<ActivityProjectionPreference["foldedTurn"], string> = {
  inside: "内部",
  pinned: "保持可见",
};

const GROUP_TITLE_LABELS: Record<GroupTitleMode, string> = {
  summary: "活动摘要",
  "latest-reasoning": "推理意图",
};

function autoSettleLabel(days: AutoSettleAfterDays): string {
  if (days === null) return "关闭";
  if (days === 7) return "1 周后";
  if (days === 14) return "2 周后";
  return days === 1 ? "1 天后" : `${days} 天后`;
}

const SIDEBAR_MODE_LABELS = {
  remember: "记住",
  project: "项目",
  inbox: "收件箱",
} as const;

const WORKSPACE_MODE_LABELS = {
  worktree: "工作树",
  current: "当前检出",
} as const;

const WORKTREE_BASE_LABELS = {
  "repository-default": "仓库默认",
  current: "当前分支",
} as const;

const DELIVERY_LABELS = {
  steer: "引导",
  queue: "队列",
} as const;

function BrowserSettings() {
  const runtime = useAtomValue(runtimeAtom);
  const selectedSession = useSelectedSession();
  const [experimentalBrowser, setExperimentalBrowser] = useAtom(experimentalBrowserAtom);
  const [searchEngine, setSearchEngine] = useAtom(browserSearchEngineAtom);
  const [webLinks, setWebLinks] = useAtom(browserWebLinksAtom);
  const [localLinks, setLocalLinks] = useAtom(browserLocalLinksAtom);
  const [showFullURL, setShowFullURL] = useAtom(browserShowFullURLAtom);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const selectedTask = runtime?.connected && selectedSession ? selectedSession : null;

  const clearData = async () => {
    if (!selectedTask || !runtime) return;
    setClearing(true);
    try {
      await palot.browserClearData({
        sessionID: selectedTask.id,
        profileID: runtime.profileID,
        connectionID: runtime.connectionID,
      });
      toast.add({ type: "success", title: "任务浏览器数据已清除" });
    } catch (error) {
      showErrorToast("无法清除浏览器数据", error);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="space-y-8">
      <SettingsSection
        title="浏览器访问"
        description="实验性的任务工作台浏览器。"
      >
        <SettingsGroup>
          <SettingsRow
            title="启用浏览器"
            description="允许任务在工作台中打开浏览器标签。需要连接服务器上的 OpenCode 浏览器插件。浏览器工具可以访问从该服务器可达的站点，包括 localhost 和私有网络。Palot 尚不支持逐站点审批。"
            control={
              <Switch
                checked={experimentalBrowser}
                aria-label="启用实验性浏览器"
                onCheckedChange={(checked) => setExperimentalBrowser(Boolean(checked))}
              />
            }
          />
        </SettingsGroup>
      </SettingsSection>
      <SettingsSection
        title="导航"
        description="选择链接打开位置和地址显示方式。"
      >
        <SettingsGroup>
          <SettingsRow
            title="搜索引擎"
            description="在浏览器地址栏输入搜索词而非 URL 时使用。"
            control={
              <Select
                value={searchEngine}
                onValueChange={(value) => setSearchEngine(value as typeof searchEngine)}
              >
                <SelectTrigger className="w-full @lg/settings:w-44" aria-label="搜索引擎">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="google">Google</SelectItem>
                  <SelectItem value="duckduckgo">DuckDuckGo</SelectItem>
                  <SelectItem value="bing">Bing</SelectItem>
                </SelectContent>
              </Select>
            }
          />
          <SettingsRow
            title="网页链接"
            description="选择在 Palot 中点击公共网页链接时的打开位置。"
            control={
              <Select
                value={webLinks}
                onValueChange={(value) => setWebLinks(value as typeof webLinks)}
              >
                <SelectTrigger className="w-full @lg/settings:w-44" aria-label="网页链接">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="external">外部浏览器</SelectItem>
                  <SelectItem value="browser">Palot 浏览器</SelectItem>
                </SelectContent>
              </Select>
            }
          />
          <SettingsRow
            title="本地开发链接"
            description="选择在 Palot 中点击本地开发链接时的打开位置。"
            control={
              <Select
                value={localLinks}
                onValueChange={(value) => setLocalLinks(value as typeof localLinks)}
              >
                <SelectTrigger className="w-full @lg/settings:w-44" aria-label="本地开发链接">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="external">外部浏览器</SelectItem>
                  <SelectItem value="browser">Palot 浏览器</SelectItem>
                </SelectContent>
              </Select>
            }
          />
          <SettingsRow
            title="显示完整 URL"
            description="在浏览器栏中显示完整页面地址而非缩短地址。"
            control={
              <Switch
                checked={showFullURL}
                aria-label="显示完整 URL"
                onCheckedChange={(checked) => setShowFullURL(Boolean(checked))}
              />
            }
          />
        </SettingsGroup>
      </SettingsSection>
      <SettingsSection title="浏览器数据和权限">
        <SettingsGroup>
          <SettingsRow
            title="清除任务浏览器数据"
            description="关闭此任务的浏览器页面并删除其保存的标签 URL、临时捕获和下载、站点数据和缓存。其他任务和导出到服务器的文件不受影响。"
            control={
              <Button
                type="button"
                variant="outline"
                disabled={!selectedTask || clearing}
                onClick={() => setConfirmClear(true)}
              >
                {clearing ? "正在清除…" : "清除数据"}
              </Button>
            }
          />
          <SettingsRow
            title="Palot 不提供"
            description="Palot 不提供下载管理器、浏览历史、保存的密码、扩展或逐站点权限。此处没有单独的 WebMCP 或 CDP 设置。"
          />
        </SettingsGroup>
      </SettingsSection>
      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear browser data for this task?</AlertDialogTitle>
            <AlertDialogDescription>
              This closes its browser pages and deletes their saved URLs, private site data, cache,
              and temporary files. It does not delete files already exported to the server.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirmClear(false);
                void clearData();
              }}
            >
              Clear task data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function GeneralSettings() {
  const [workspaceMode, setWorkspaceMode] = useAtom(defaultWorkspaceModeAtom);
  const [worktreeBase, setWorktreeBase] = useAtom(defaultWorktreeBaseAtom);
  const [projection, setProjection] = useAtom(sessionProjectionPreferenceAtom);
  const [customizeProjection, setCustomizeProjection] = useState(false);
  const [delivery, setDelivery] = useAtom(defaultDeliveryAtom);
  const [autoBackgroundOnSteer, setAutoBackgroundOnSteer] = useAtom(autoBackgroundOnSteerAtom);
  const [contextMeterVisible, setContextMeterVisible] = useAtom(contextMeterVisibleAtom);
  const [compactBeforeSend, setCompactBeforeSend] = useAtom(compactBeforeSendSuggestionAtom);
  const [showTimelineCacheBusts, setShowTimelineCacheBusts] = useAtom(showTimelineCacheBustsAtom);
  const [remoteMarkdownFavicons, setRemoteMarkdownFavicons] = useAtom(remoteMarkdownFaviconsAtom);
  const [defaultSidebarMode, setDefaultSidebarMode] = useAtom(defaultSidebarModeAtom);
  const [autoSettleAfterDays, setAutoSettleAfterDays] = useAtom(autoSettleAfterDaysAtom);
  const [automationHostSettings, setAutomationHostSettings] =
    useState<AutomationHostSettings | null>(null);
  const resolvedProjection = useMemo(
    () => resolveSessionProjectionPreference(projection),
    [projection],
  );
  const customized =
    projection.foldCompletedTurns !== undefined ||
    projection.groupTitle !== undefined ||
    projection.groupSameFileReads !== undefined ||
    projection.showReasoningSummaries !== undefined ||
    projection.keepCurrentActivityExpanded !== undefined ||
    (projection.categories !== undefined && Object.keys(projection.categories).length > 0);
  const updateCategory = (
    category: ActivityCategory,
    patch: Partial<ActivityProjectionPreference>,
  ) => {
    setProjection((current) => ({
      ...current,
      categories: {
        ...current.categories,
        [category]: { ...current.categories?.[category], ...patch },
      },
    }));
  };
  useEffect(() => {
    let active = true;
    void palot
      .loadAutomationHostSettings()
      .then((settings) => {
        if (active) setAutomationHostSettings(settings);
      })
      .catch((error) => {
        toast.add({
          type: "error",
          title: error instanceof Error ? error.message : "无法加载计划设置",
        });
      });
    return () => {
      active = false;
    };
  }, []);
  const updateAutomationHostSettings = async (patch: Partial<AutomationHostSettings>) => {
    if (!automationHostSettings) return;
    const previous = automationHostSettings;
    const next = { ...previous, ...patch };
    setAutomationHostSettings(next);
    try {
      setAutomationHostSettings(await palot.updateAutomationHostSettings(next));
    } catch (error) {
      setAutomationHostSettings(previous);
      toast.add({
        type: "error",
        title: error instanceof Error ? error.message : "无法更新计划设置",
      });
    }
  };
  return (
    <div className="space-y-8">
      <SettingsSection
        title="任务默认值"
        description="新任务和运行中消息的初始选项。"
      >
        <SettingsGroup>
          <SettingsRow
            title="默认工作区"
            description="默认创建隔离工作树，或在项目检出中启动。"
            control={
              <Select
                value={workspaceMode}
                onValueChange={(value) => setWorkspaceMode(value as typeof workspaceMode)}
              >
                <SelectTrigger className="w-full @lg/settings:w-44" aria-label="默认工作区">
                  <SelectValue>{WORKSPACE_MODE_LABELS[workspaceMode]}</SelectValue>
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="worktree">新建工作树</SelectItem>
                  <SelectItem value="current">当前检出</SelectItem>
                </SelectContent>
              </Select>
            }
          />
          <SettingsRow
            title="新工作树起点"
            description="从仓库默认分支或当前分支启动新任务工作树。"
            control={
              <Select
                value={worktreeBase}
                onValueChange={(value) => setWorktreeBase(value as typeof worktreeBase)}
              >
                <SelectTrigger
                  className="w-full @lg/settings:w-48"
                  aria-label="新工作树起点"
                >
                  <SelectValue>{WORKTREE_BASE_LABELS[worktreeBase]}</SelectValue>
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="repository-default">仓库默认</SelectItem>
                  <SelectItem value="current">当前分支</SelectItem>
                </SelectContent>
              </Select>
            }
          />
          <SettingsRow
            title="运行时的消息"
            description="引导更新当前轮次。队列等待当前轮次结束后启动。"
            control={
              <Select
                value={delivery}
                onValueChange={(value) => setDelivery(value as typeof delivery)}
              >
                <SelectTrigger
                  className="w-full @lg/settings:w-44"
                  aria-label="运行时的消息"
                >
                  <SelectValue>{DELIVERY_LABELS[delivery]}</SelectValue>
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="steer">引导当前轮次</SelectItem>
                  <SelectItem value="queue">队列下一轮次</SelectItem>
                </SelectContent>
              </Select>
            }
          />
          <SettingsRow
            title="自动将阻塞工作发送到后台"
            description="若引导被阻塞超过五秒，让支持的前台工作在后台继续。"
            control={
              <Switch
                checked={autoBackgroundOnSteer}
                aria-label="引导时自动将阻塞工作发送到后台"
                onCheckedChange={(checked) => setAutoBackgroundOnSteer(Boolean(checked))}
              />
            }
          />
          <SettingsRow
            title="Context meter"
            description="Show how full the model's context window is next to Send."
            control={
              <Switch
                checked={contextMeterVisible}
                aria-label="Show the context meter in the composer"
                onCheckedChange={(checked) => setContextMeterVisible(Boolean(checked))}
              />
            }
          />
          <SettingsRow
            title="Suggest compacting before sending"
            description="When a large task has been idle for an hour, its prompt cache has likely expired. Offer to summarize the history first so the next message doesn't re-read all of it."
            control={
              <Switch
                checked={compactBeforeSend}
                aria-label="Suggest compacting before sending"
                onCheckedChange={(checked) => setCompactBeforeSend(Boolean(checked))}
              />
            }
          />
          <DefaultShellSetting />
        </SettingsGroup>
      </SettingsSection>
      <SettingsSection
        title="桌面行为"
        description="启动、本地计划和网站图标。"
      >
        <SettingsGroup>
          <SettingsRow
            title="默认侧边栏"
            description="选择 Palot 启动时打开哪个侧栏，或返回上次使用的侧栏。"
            control={
              <Select
                value={defaultSidebarMode}
                onValueChange={(value) => setDefaultSidebarMode(value as typeof defaultSidebarMode)}
              >
                <SelectTrigger className="w-full @lg/settings:w-44" aria-label="默认侧边栏">
                  <SelectValue>{SIDEBAR_MODE_LABELS[defaultSidebarMode]}</SelectValue>
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="remember">记住上次使用</SelectItem>
                  <SelectItem value="project">项目</SelectItem>
                  <SelectItem value="inbox">收件箱</SelectItem>
                </SelectContent>
              </Select>
            }
          />
          <SettingsRow
            title="自动结算闲置任务"
            description="一段时间无活动后将收件箱任务移至已结算。正在运行、需要输入、失败、已置顶或你手动移回收件箱的任务不受影响。新活动会将任务移回收件箱。"
            control={
              <Select
                value={autoSettleAfterDays === null ? "off" : String(autoSettleAfterDays)}
                onValueChange={(value) =>
                  setAutoSettleAfterDays(
                    value === "off" ? null : (Number(value) as AutoSettleAfterDays),
                  )
                }
              >
                <SelectTrigger
                  className="w-full @lg/settings:w-44"
                  aria-label="自动结算闲置任务"
                >
                  <SelectValue>{autoSettleLabel(autoSettleAfterDays)}</SelectValue>
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="off">关闭</SelectItem>
                  {AUTO_SETTLE_DAY_CHOICES.map((days) => (
                    <SelectItem key={days} value={String(days)}>
                      {autoSettleLabel(days)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
          <SettingsRow
            title="登录时启动"
            description="登录时启动 Palot，以便本地计划可以运行。"
            control={
              <Switch
                aria-label="登录时启动"
                checked={automationHostSettings?.launchAtLogin ?? false}
                disabled={!automationHostSettings}
                onCheckedChange={(checked) =>
                  void updateAutomationHostSettings({ launchAtLogin: Boolean(checked) })
                }
              />
            }
          />
          <SettingsRow
            title="运行时防止休眠"
            description="仅在计划任务准备、排队、运行或完成时保持电脑唤醒。"
            control={
              <Switch
                aria-label="计划任务运行时防止休眠"
                checked={automationHostSettings?.preventSleepWhileRunning ?? false}
                disabled={!automationHostSettings}
                onCheckedChange={(checked) =>
                  void updateAutomationHostSettings({
                    preventSleepWhileRunning: Boolean(checked),
                  })
                }
              />
            }
          />
          <SettingsRow
            title="链接中的网站图标"
            description="从 DuckDuckGo 加载消息中链接的公开网站图标。这会分享每个完整主机名（含子域名），但不分享页面路径。"
            control={
              <Switch
                checked={remoteMarkdownFavicons}
                aria-label="从 DuckDuckGo 加载网站图标"
                onCheckedChange={(checked) => setRemoteMarkdownFavicons(Boolean(checked))}
              />
            }
          />
        </SettingsGroup>
      </SettingsSection>
      <SettingsSection
        title="时间线"
        description="选择推理和工具活动在任务中的显示方式。"
      >
        <SettingsGroup>
          <SettingsRow
            title="可能破坏缓存"
            description="当匹配模型步骤间缓存重用意外下降时，在时间线中显示警告。选中警告会在上下文标签页的诊断中打开它。"
            control={
              <Switch
                checked={showTimelineCacheBusts}
                aria-label="在时间线中显示可能的缓存破坏"
                onCheckedChange={(checked) => setShowTimelineCacheBusts(Boolean(checked))}
              />
            }
          />
          <SettingsRow
            title="时间线活动"
            description={PROJECTION_PRESET_DESCRIPTIONS[projection.preset]}
            control={
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="自定义时间线活动"
                  aria-expanded={customizeProjection}
                  title="自定义时间线活动"
                  onClick={() => setCustomizeProjection((open) => !open)}
                >
                  <SlidersHorizontal aria-hidden="true" />
                </Button>
                <Select
                  value={projection.preset}
                  onValueChange={(value) =>
                    setProjection({ version: 2, preset: value as SessionProjectionPreset })
                  }
                >
                  <SelectTrigger className="w-full @lg/settings:w-44" aria-label="时间线样式">
                    <SelectValue>
                      {PROJECTION_PRESET_LABELS[projection.preset]}
                      {customized ? "，已自定义" : ""}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent align="end">
                    <SelectItem value="code-focus">聚焦</SelectItem>
                    <SelectItem value="compact">均衡</SelectItem>
                    <SelectItem value="expanded">详细</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            }
          />
          <SettingsRow
            title="推理摘要"
            description="在活动组内显示代理的推理摘要。"
            control={
              <Switch
                checked={resolvedProjection.showReasoningSummaries}
                aria-label="在时间线中显示推理摘要"
                onCheckedChange={(checked) =>
                  setProjection((current) => ({
                    ...current,
                    showReasoningSummaries: Boolean(checked),
                  }))
                }
              />
            }
          />
          <SettingsRow
            title="当前活动"
            description="代理工作时保持当前活动组展开。"
            control={
              <Switch
                checked={resolvedProjection.keepCurrentActivityExpanded}
                aria-label="保持当前活动展开"
                onCheckedChange={(checked) =>
                  setProjection((current) => ({
                    ...current,
                    keepCurrentActivityExpanded: Boolean(checked),
                  }))
                }
              />
            }
          />
        </SettingsGroup>
        {customizeProjection ? (
          <div className="overflow-hidden rounded-xl border bg-card">
            <div className="flex items-center justify-between gap-3 border-b bg-muted/20 px-3 py-2.5">
              <div className="text-xs font-medium">
                {projection.preset === "code-focus"
                  ? "聚焦"
                  : projection.preset === "compact"
                    ? "均衡"
                    : "详细"}
                {customized ? "，已自定义" : ""}
              </div>
              {customized ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => setProjection({ version: 2, preset: projection.preset })}
                >
                  重置
                </Button>
              ) : null}
            </div>
            <div className="hidden grid-cols-[minmax(7rem,1fr)_repeat(3,minmax(7rem,auto))] gap-x-2 border-b px-4 py-2 text-meta font-medium text-muted-foreground @3xl/settings:grid">
              <span>活动</span>
              <span>显示</span>
              <span>详情</span>
              <span>折叠轮次</span>
            </div>
            {ACTIVITY_CATEGORIES.map((category) => {
              const preference = resolvedProjection.categories[category];
              return (
                <div
                  key={category}
                  className="grid gap-2 border-b px-4 py-3 last:border-b-0 @3xl/settings:grid-cols-[minmax(7rem,1fr)_repeat(3,minmax(7rem,auto))] @3xl/settings:items-center"
                >
                  <span className="text-xs font-medium">{ACTIVITY_CATEGORY_LABELS[category]}</span>
                  <Select
                    value={preference.presentation}
                    onValueChange={(value) =>
                      updateCategory(category, {
                        presentation: value as ActivityProjectionPreference["presentation"],
                      })
                    }
                  >
                    <SelectTrigger
                      className="w-full @3xl/settings:w-36"
                      aria-label={`${ACTIVITY_CATEGORY_LABELS[category]} display`}
                    >
                      <SelectValue>
                        {ACTIVITY_PRESENTATION_LABELS[preference.presentation]}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent align="end">
                      <SelectItem value="individual">单独</SelectItem>
                      <SelectItem value="grouped">分组</SelectItem>
                      <SelectItem value="hidden">完成后隐藏</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={preference.details}
                    onValueChange={(value) =>
                      updateCategory(category, {
                        details: value as ActivityProjectionPreference["details"],
                      })
                    }
                  >
                    <SelectTrigger
                      className="w-full @3xl/settings:w-32"
                      aria-label={`${ACTIVITY_CATEGORY_LABELS[category]} details`}
                    >
                      <SelectValue>{DETAIL_DEFAULT_LABELS[preference.details]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent align="end">
                      <SelectItem value="collapsed">折叠</SelectItem>
                      <SelectItem value="expanded">展开</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    value={preference.foldedTurn}
                    onValueChange={(value) =>
                      updateCategory(category, {
                        foldedTurn: value as ActivityProjectionPreference["foldedTurn"],
                      })
                    }
                  >
                    <SelectTrigger
                      className="w-full @3xl/settings:w-32"
                      aria-label={`${ACTIVITY_CATEGORY_LABELS[category]} folded turns`}
                    >
                      <SelectValue>{FOLDED_TURN_LABELS[preference.foldedTurn]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent align="end">
                      <SelectItem value="inside">内置</SelectItem>
                      <SelectItem value="pinned">保持可见</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
            <div className="flex items-center justify-between gap-3 border-t bg-muted/10 px-3 py-3">
              <span className="text-xs font-medium">分组标题</span>
              <Select
                value={resolvedProjection.groupTitle}
                onValueChange={(value) =>
                  setProjection((current) => ({
                    ...current,
                    groupTitle: value as GroupTitleMode,
                  }))
                }
              >
                <SelectTrigger className="w-44" aria-label="分组标题">
                  <SelectValue>{GROUP_TITLE_LABELS[resolvedProjection.groupTitle]}</SelectValue>
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="summary">活动摘要</SelectItem>
                  <SelectItem value="latest-reasoning">推理意图</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-3 border-t bg-muted/10 px-3 py-3">
              <span className="text-xs font-medium">重复文件读取</span>
              <Select
                value={resolvedProjection.groupSameFileReads ? "grouped" : "separate"}
                onValueChange={(value) =>
                  setProjection((current) => ({
                    ...current,
                    groupSameFileReads: value === "grouped",
                  }))
                }
              >
                <SelectTrigger className="w-44" aria-label="重复文件读取">
                  <SelectValue>
                    {resolvedProjection.groupSameFileReads ? "每个文件一张卡片" : "单独卡片"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="separate">单独卡片</SelectItem>
                  <SelectItem value="grouped">每个文件一张卡片</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-3 border-t bg-muted/10 px-3 py-3">
              <span className="text-xs font-medium">已完成轮次</span>
              <Select
                value={resolvedProjection.foldCompletedTurns ? "folded" : "expanded"}
                onValueChange={(value) =>
                  setProjection((current) => ({
                    ...current,
                    foldCompletedTurns: value === "folded",
                  }))
                }
              >
                <SelectTrigger className="w-36" aria-label="已完成轮次">
                  <SelectValue>
                    {resolvedProjection.foldCompletedTurns ? "折叠" : "展开"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="folded">折叠</SelectItem>
                  <SelectItem value="expanded">展开</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : null}
      </SettingsSection>
    </div>
  );
}

const TURN_NOTIFICATION_LABELS: Record<DesktopNotificationSettings["turnCompletion"], string> = {
  never: "从不",
  unfocused: "仅在未聚焦时",
  always: "始终",
};

function NotificationSettings() {
  const [settings, setSettings] = useAtom(desktopNotificationSettingsAtom);
  const [deliveryStatus, setDeliveryStatus] = useState<DesktopNotificationDeliveryStatus | null>(
    null,
  );
  const [deliveryBusy, setDeliveryBusy] = useState(false);
  const isMac = document.documentElement.dataset.platform === "darwin";

  useEffect(() => {
    let active = true;
    void palot
      .loadDesktopNotificationSettings()
      .then((value) => {
        if (active) setSettings(value);
      })
      .catch((error) => showError("无法加载通知设置", error));
    return () => {
      active = false;
    };
  }, [setSettings]);

  useEffect(() => {
    if (!isMac) return;
    let active = true;
    const refresh = () => {
      void palot
        .desktopNotificationDeliveryStatus()
        .then((value) => {
          if (active) setDeliveryStatus(value);
        })
        .catch((error) => showError("无法检查通知投递", error));
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
    };
  }, [isMac]);

  const updateSettings = async (patch: Partial<DesktopNotificationSettings>) => {
    if (!settings) return;
    const previous = settings;
    const next = { ...previous, ...patch };
    setSettings(next);
    try {
      setSettings(await palot.updateDesktopNotificationSettings(next));
    } catch (error) {
      setSettings(previous);
      showError("无法更新通知设置", error);
    }
  };

  const refreshDeliveryStatus = async () => {
    setDeliveryBusy(true);
    try {
      setDeliveryStatus(await palot.desktopNotificationDeliveryStatus());
    } catch (error) {
      showError("无法检查通知投递", error);
    } finally {
      setDeliveryBusy(false);
    }
  };

  const runDeliveryAction = async () => {
    if (!deliveryStatus) return;
    setDeliveryBusy(true);
    try {
      if (deliveryStatus.authorization === "not-determined") {
        setDeliveryStatus(await palot.requestDesktopNotificationPermission());
      } else if (deliveryStatus.authorization === "denied" || deliveryStatus.delivery === "off") {
        await palot.openDesktopNotificationSystemSettings();
      } else {
        await palot.sendDesktopTestNotification();
      }
    } catch (error) {
      showError("无法更新通知投递", error);
    } finally {
      setDeliveryBusy(false);
    }
  };

  const delivery = notificationDeliveryPresentation(deliveryStatus);

  return (
    <div className="space-y-8">
      <SettingsSection
        title="原生提醒"
        description="Palot 使用 macOS 通知中心，点击提醒时会打开相关任务。"
        icon={Bell}
      >
        <SettingsGroup>
          {isMac ? (
            <SettingsRow
              title="投递检查"
              description={delivery.description}
              control={
                <>
                  <Badge variant={delivery.badgeVariant}>{delivery.label}</Badge>
                  {delivery.action ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={deliveryBusy || !deliveryStatus}
                      onClick={() => void runDeliveryAction()}
                    >
                      {deliveryBusy ? <LoaderCircle className="animate-spin" /> : delivery.icon}
                      {delivery.action}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label="重新检查通知投递"
                    disabled={deliveryBusy}
                    onClick={() => void refreshDeliveryStatus()}
                  >
                    <RefreshCw className={deliveryBusy ? "animate-spin" : undefined} />
                  </Button>
                </>
              }
            />
          ) : null}
          <SettingsRow
            title="回合完成通知"
            description="设置 Palot 何时提醒您任务已完成。"
            control={
              <Select
                value={settings?.turnCompletion ?? "always"}
                disabled={!settings}
                onValueChange={(value) =>
                  void updateSettings({
                    turnCompletion: value as DesktopNotificationSettings["turnCompletion"],
                  })
                }
              >
                <SelectTrigger
                  className="w-full @lg/settings:w-48"
                  aria-label="回合完成通知"
                >
                  <SelectValue>
                    {TURN_NOTIFICATION_LABELS[settings?.turnCompletion ?? "always"]}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="never">从不</SelectItem>
                  <SelectItem value="unfocused">仅在未聚焦时</SelectItem>
                  <SelectItem value="always">始终</SelectItem>
                </SelectContent>
              </Select>
            }
          />
          <SettingsRow
            title="权限通知"
            description="任务需要权限才能继续时显示提醒。"
            control={
              <Switch
                aria-label="权限通知"
                checked={settings?.permissionRequests ?? false}
                disabled={!settings}
                onCheckedChange={(checked) =>
                  void updateSettings({ permissionRequests: Boolean(checked) })
                }
              />
            }
          />
          <SettingsRow
            title="问题通知"
            description="需要您输入才能继续时显示提醒。"
            control={
              <Switch
                aria-label="问题通知"
                checked={settings?.questionRequests ?? false}
                disabled={!settings}
                onCheckedChange={(checked) =>
                  void updateSettings({ questionRequests: Boolean(checked) })
                }
              />
            }
          />
        </SettingsGroup>
      </SettingsSection>
      <NotificationSoundSettings deliveryStatus={deliveryStatus} />
    </div>
  );
}

function notificationDeliveryPresentation(status: DesktopNotificationDeliveryStatus | null): {
  label: string;
  description: string;
  action: string | null;
  icon: ReactNode;
  badgeVariant: "secondary" | "outline" | "destructive";
} {
  if (!status) {
    return {
      label: "检查中",
      description: "正在从 macOS 读取 Palot 当前的通知投递路径。",
      action: null,
      icon: null,
      badgeVariant: "outline",
    };
  }
  if (status.authorization === "not-determined") {
    return {
      label: "未设置",
      description: "选择 Palot 是否可以在工作需要关注时提醒您。",
      action: "允许提醒",
      icon: <Bell />,
      badgeVariant: "outline",
    };
  }
  if (status.authorization === "denied") {
    return {
      label: "已阻止",
      description: "macOS 正在阻止 Palot 提醒。您的应用内选择仍会保留。",
      action: "打开 macOS 设置",
      icon: <ExternalLink />,
      badgeVariant: "destructive",
    };
  }
  if (status.delivery === "off") {
    return {
      label: "已暂停",
      description: "Palot 已被允许，但横幅和通知中心投递均已关闭。",
      action: "打开 macOS 设置",
      icon: <ExternalLink />,
      badgeVariant: "destructive",
    };
  }
  if (status.delivery === "notification-center" || status.authorization === "provisional") {
    return {
      label: "安静",
      description: "更新会进入通知中心，不会打断当前任务。",
      action: "发送测试",
      icon: <Bell />,
      badgeVariant: "outline",
    };
  }
  if (status.authorization === "authorized" || status.authorization === "ephemeral") {
    return {
      label: "就绪",
      description:
        "横幅和通知中心可用。您可以随时验证投递路径。",
      action: "发送测试",
      icon: <Check />,
      badgeVariant: "secondary",
    };
  }
  return {
    label: "不可用",
    description: "Palot 无法从 macOS 读取通知投递状态。",
    action: null,
    icon: null,
    badgeVariant: "outline",
  };
}

function AppearanceSettings() {
  const [preferences, setPreferences] = useAtom(appearancePreferencesAtom);
  const resolved = useAtomValue(resolvedAppearanceAtom);
  const restartRequired = useAtomValue(appearanceRestartRequiredAtom);
  const [nativeMaterial, setNativeMaterial] = useState(() => ({
    tier: document.documentElement.dataset.chromeTier ?? "opaque",
    reducedTransparency: document.documentElement.dataset.reducedTransparency === "true",
  }));
  const [source, setSource] = useState<string | null>(null);
  useEffect(() => {
    void window.palot
      .getWallpaperBackdrop()
      .then((state) => setSource(state.source))
      .catch(() => setSource(null));
  }, []);
  const [fontAvailability] = useState<Record<string, boolean>>(() => {
    const platform = document.documentElement.dataset.platform ?? "browser";
    return Object.fromEntries(
      [...Object.entries(UI_FONT_OPTIONS), ...Object.entries(CODE_FONT_OPTIONS)].map(
        ([id, option]) => [id, isAppearanceFontAvailable(option, platform)],
      ),
    );
  });
  const update = (patch: Partial<AppearancePreferences>) =>
    setPreferences((current) => ({ ...current, ...patch }));

  useEffect(() => {
    const api = window.palot;
    if (!api) return;
    const unsubscribeTier = api.onChromeTierChanged((tier) =>
      setNativeMaterial((current) => ({ ...current, tier })),
    );
    const unsubscribeReduced = api.onReducedTransparencyChanged((reducedTransparency) =>
      setNativeMaterial((current) => ({ ...current, reducedTransparency })),
    );
    return () => {
      unsubscribeTier();
      unsubscribeReduced();
    };
  }, []);

  const effectiveMaterial = nativeMaterial.reducedTransparency
    ? "因减少透明度已启用而不透明"
    : nativeMaterial.tier === "liquid-glass"
      ? "液态玻璃"
      : nativeMaterial.tier === "vibrancy"
        ? "鲜艳"
        : "不透明";
  const themeNativeGlass = effectiveNativeGlass(
    {
      ...preferences,
      nativeGlassVariant: "theme",
    },
    resolved.scheme,
  );
  const themeTreatment = effectiveAppearanceTreatment(
    {
      ...preferences,
      glassOpacity: DEFAULT_APPEARANCE_PREFERENCES.glassOpacity,
      nativeGlassTint: DEFAULT_APPEARANCE_PREFERENCES.nativeGlassTint,
      windowMaterial: "automatic",
      sidebarMaterial: "automatic",
    },
    resolved.scheme,
  );

  return (
    <>
      <SettingsSection
        title="主题"
        description="跟随桌面或选择调色板。更改立即生效。"
        icon={Palette}
      >
        <SettingsGroup>
          <AppearanceSelectRow
            title="主题"
            description={
              preferences.source === "system"
                ? preferences.systemPalette === "macos"
                  ? "跟随 macOS 外观。"
                  : preferences.omarchyTheme
                    ? `跟随 Omarchy · ${preferences.omarchyTheme.name}`
                    : "跟随桌面浅色/深色模式，使用您保存的调色板。"
                : `${resolved.scheme === "light" ? "浅色" : "深色"}模式的调色板。浅色和深色调色板独立保存。`
            }
            value={
              preferences.source === "system"
                ? "system"
                : resolved.scheme === "light"
                  ? preferences.lightTheme
                  : preferences.darkTheme
            }
            options={[
              { value: "system", label: "系统" },
              ...Object.values(APPEARANCE_THEMES).flatMap((theme) => {
                const variant = theme[resolved.scheme];
                return variant
                  ? [
                      {
                        value: theme.id,
                        label: theme.name,
                        preview: <ThemeSwatch variant={variant} />,
                      },
                    ]
                  : [];
              }),
            ]}
            onChange={(theme) =>
              update(
                theme === "system"
                  ? { source: "system" }
                  : resolved.scheme === "light"
                    ? { lightTheme: theme as AppearanceThemeID, source: "palot" }
                    : { darkTheme: theme as AppearanceThemeID, source: "palot" },
              )
            }
          />
          <SettingsRow
            title="对比度"
            description={`调整当前${resolved.scheme === "light" ? "浅色" : "深色"}主题中表面、控件、边框和次要文本之间的区分度。`}
            control={
              <AppearanceSlider
                label={`${resolved.scheme === "light" ? "浅色" : "深色"}主题对比度`}
                value={
                  resolved.scheme === "light" ? preferences.lightContrast : preferences.darkContrast
                }
                min={0}
                max={100}
                defaultValue={50}
                onChange={(value) =>
                  update(
                    resolved.scheme === "light"
                      ? { lightContrast: value }
                      : { darkContrast: value },
                  )
                }
              />
            }
          />
          <AppearanceSelectRow
            title="代码主题"
            description="文件预览、diff、Markdown 代码和终端 ANSI 颜色。"
            value={
              resolved.scheme === "light" ? preferences.lightCodeTheme : preferences.darkCodeTheme
            }
            options={codeThemeOptions(preferences, resolved.scheme)}
            onChange={(theme) =>
              update(
                resolved.scheme === "light"
                  ? { lightCodeTheme: theme as CodeThemeID }
                  : { darkCodeTheme: theme as CodeThemeID },
              )
            }
          />
          <CodeThemePreview theme={resolved.codeThemeName} terminal={resolved.terminal} />
        </SettingsGroup>
      </SettingsSection>

      {preferences.source === "palot" ? (
        <SettingsSection
          title="颜色模式"
          description="选择 Palot 何时使用您的浅色和深色调色板。"
          icon={Palette}
        >
          <div className="grid gap-3 @lg/settings:grid-cols-3">
            {APPEARANCE_MODES.map((mode) => (
              <AppearanceModeCard
                key={mode}
                mode={mode}
                selected={preferences.mode === mode}
                onSelect={() => update({ mode })}
              />
            ))}
          </div>
        </SettingsSection>
      ) : null}

      <SettingsSection
        title="滚动"
        description="滚动条在滚动或与面板交互时显示。"
        icon={Palette}
      >
        <SettingsGroup>
          <SettingsRow
            title="始终显示滚动条"
            description="保持滚动手柄可见，而不是在空闲时隐藏。"
            control={
              <Switch
                checked={preferences.alwaysShowScrollbars}
                onCheckedChange={(alwaysShowScrollbars) => update({ alwaysShowScrollbars })}
                aria-label="始终显示滚动条"
              />
            }
          />
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection
        title="玻璃和材质"
        description="独立于窗口背后的原生材质控制渲染器半透明度。"
        icon={Sparkles}
      >
        <SettingsGroup>
          {window.palot?.platform === "linux" ? (
            <SettingsRow
              title="窗口背景不透明度"
              description="使窗口背景半透明同时保持文字清晰。启用或禁用透明度需要重启 Palot。您的合成器控制桌面模糊，还可以额外淡化整个窗口。"
              control={
                <AppearanceSlider
                  label="窗口背景不透明度"
                  value={preferences.linuxBackgroundOpacity}
                  min={60}
                  max={100}
                  defaultValue={100}
                  onChange={(linuxBackgroundOpacity) => update({ linuxBackgroundOpacity })}
                />
              }
            />
          ) : null}
          <SettingsRow
            title="表面色调"
            description="值越高，合成器、检查器、菜单和对话框越不透明。原生 Liquid Glass 侧栏保持透明。"
            control={
              <AppearanceSlider
                label="表面色调"
                value={
                  preferences.glassOpacity === "theme"
                    ? themeTreatment.sidebar.opacity
                    : preferences.glassOpacity
                }
                min={30}
                max={100}
                defaultValue={themeTreatment.sidebar.opacity}
                isDefault={preferences.glassOpacity === "theme"}
                onChange={(glassOpacity) => update({ glassOpacity })}
                onReset={() => update({ glassOpacity: "theme" })}
              />
            }
          />
          <SettingsRow
            title="主要内容不透明度"
            description="让原生材质透过聊天表面和右侧或底部工作台面板显示。"
            control={
              <AppearanceSlider
                label="主要内容不透明度"
                value={preferences.contentOpacity}
                min={55}
                max={100}
                defaultValue={DEFAULT_APPEARANCE_PREFERENCES.contentOpacity}
                onChange={(contentOpacity) => update({ contentOpacity })}
              />
            }
          />
          <SettingsRow
            title="原生玻璃色调"
            description="将 macOS Liquid Glass 着色为当前主题背景色。"
            control={
              <AppearanceSlider
                label="原生玻璃色调"
                value={resolved.treatment.native.tint}
                min={0}
                max={30}
                defaultValue={themeTreatment.native.tint}
                isDefault={preferences.nativeGlassTint === "theme"}
                onChange={(nativeGlassTint) => update({ nativeGlassTint })}
                onReset={() => update({ nativeGlassTint: "theme" })}
              />
            }
          />
          <AppearanceSelectRow
            title="原生玻璃变体"
            description="在 Apple 的常规和清晰 Liquid Glass 处理之间选择。主题跟随当前调色板的建议。"
            value={preferences.nativeGlassVariant}
            options={[
              {
                value: "theme",
                label: `主题（${titleCase(themeNativeGlass.variant)}）`,
              },
              ...NATIVE_GLASS_VARIANTS.map((value) => ({ value, label: titleCase(value) })),
            ]}
            onChange={(nativeGlassVariant) =>
              update({
                nativeGlassVariant:
                  nativeGlassVariant as AppearancePreferences["nativeGlassVariant"],
              })
            }
          />
          <AppearanceSelectRow
            title="窗口材质"
            description="自动跟随当前主题的原生背景。更改此项可能需要重启。"
            value={preferences.windowMaterial}
            options={WINDOW_MATERIALS.map((value) => ({
              value,
              label:
                value === "automatic"
                  ? `主题（${titleCase(themeTreatment.native.backdrop.replaceAll("-", " "))}）`
                  : value === "native"
                    ? "原生半透明"
                    : titleCase(value),
            }))}
            onChange={(windowMaterial) => {
              update({ windowMaterial: windowMaterial as AppearancePreferences["windowMaterial"] });
            }}
          />
          <AppearanceSelectRow
            title="侧边栏材质"
            description="选择导航和设置侧栏是保持不透明还是显示窗口材质。"
            value={preferences.sidebarMaterial}
            options={SIDEBAR_MATERIALS.map((value) => ({
              value,
              label:
                value === "automatic"
                  ? `主题（${titleCase(themeTreatment.sidebar.material)}）`
                  : titleCase(value),
            }))}
            onChange={(sidebarMaterial) =>
              update({
                sidebarMaterial: sidebarMaterial as AppearancePreferences["sidebarMaterial"],
              })
            }
          />
          <SettingsRow
            title="全屏背景"
            description={`真全屏时垫在半透明面板下的壁纸快照，当前来源：${fullscreenBackdropSourceLabel(source)}。普通窗口与原生材质不受影响。`}
            control={
              <div className="flex w-full flex-wrap items-center gap-2 @lg/settings:w-auto">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void window.palot
                      .chooseWallpaperBackdrop()
                      .then((next) => {
                        if (next) {
                          setSource(next.source);
                          toast.add({ type: "success", title: "全屏背景已更新" });
                        }
                      })
                      .catch((error) => {
                        showErrorToast("全屏背景设置失败", error);
                      });
                  }}
                >
                  选择图片…
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={source !== "custom"}
                  onClick={() => {
                    void window.palot
                      .clearWallpaperBackdrop()
                      .then((next) => {
                        setSource(next.source);
                        toast.add({ type: "success", title: "已恢复跟随系统壁纸" });
                      })
                      .catch((error) => {
                        showErrorToast("全屏背景恢复失败", error);
                      });
                  }}
                >
                  清除自定义
                </Button>
              </div>
            }
          />
          <SettingsRow
            title="有效材质"
            description="Palot 在平台能力和无障碍回退后实际使用的材质。"
            control={<Badge variant="outline">{effectiveMaterial}</Badge>}
          />
          {restartRequired ? (
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <p className="text-compact text-muted-foreground">
                重启 Palot 以应用原生窗口材质更改。
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void palot.restartApp("应用外观材质")}
              >
                重启
              </Button>
            </div>
          ) : null}
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection
        title="排版"
        description="字体和大小应用于界面、Markdown、文件预览、diff 和终端。包含的字体可离线使用；不可用的系统字体保持禁用。"
        icon={Braces}
      >
        <SettingsGroup>
          <AppearanceSelectRow
            title="界面字体"
            description="代码块、文件预览和终端之外的所有内容。"
            value={preferences.uiFont}
            options={Object.entries(UI_FONT_OPTIONS).map(([value, option]) => ({
              value,
              label:
                fontAvailability[value] === false ? `${option.name}（不可用）` : option.name,
              disabled: fontAvailability[value] === false,
              detail: option.source === "bundled" ? "已包含" : undefined,
            }))}
            onChange={(uiFont) => update({ uiFont: uiFont as AppearancePreferences["uiFont"] })}
            trailing={
              <SizeSelect
                label="界面字体大小"
                value={preferences.uiFontSize}
                values={[13, 14, 15, 16, 17, 18, 19]}
                onChange={(uiFontSize) => update({ uiFontSize })}
              />
            }
          />
          <TypographyPreview />
          {window.palot?.platform === "linux" ? (
            <SettingsRow
              title="跟随桌面等宽字体"
              description="使用 Omarchy 的等宽字体配合系统主题。界面排版保持独立。"
              control={
                <Switch
                  checked={preferences.followOmarchyFont}
                  onCheckedChange={(followOmarchyFont) => update({ followOmarchyFont })}
                  aria-label="跟随桌面等宽字体"
                />
              }
            />
          ) : null}
          <AppearanceSelectRow
            title="等宽字体"
            description="代码块、diff、文件预览和终端输出。"
            value={preferences.codeFont}
            options={Object.entries(CODE_FONT_OPTIONS).map(([value, option]) => ({
              value,
              label:
                fontAvailability[value] === false ? `${option.name}（不可用）` : option.name,
              disabled: fontAvailability[value] === false,
              detail: option.source === "bundled" ? "已包含" : undefined,
            }))}
            onChange={(codeFont) =>
              update({ codeFont: codeFont as AppearancePreferences["codeFont"] })
            }
            trailing={
              <SizeSelect
                label="代码字体大小"
                value={preferences.codeFontSize}
                values={[10, 11, 12, 13, 14, 15, 16, 17, 18]}
                onChange={(codeFontSize) => update({ codeFontSize })}
              />
            }
          />
          <SettingsRow
            title="终端字体大小"
            description="终端大小保持独立，让 shell 输出可以保持紧凑或宽松。"
            control={
              <SizeSelect
                label="终端字体大小"
                value={preferences.terminalFontSize}
                values={[10, 11, 12, 13, 14, 15, 16, 18, 20, 22]}
                onChange={(terminalFontSize) => update({ terminalFontSize })}
              />
            }
          />
        </SettingsGroup>
      </SettingsSection>
    </>
  );
}

function AppearanceModeCard({
  mode,
  selected,
  onSelect,
}: {
  mode: AppearanceMode;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = mode === "system" ? Monitor : mode === "light" ? Sun : Moon;
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        "group rounded-2xl border bg-card/60 p-2.5 text-left transition-colors hover:border-foreground/20",
        selected && "border-info/55 ring-2 ring-info/15",
      )}
      onClick={onSelect}
    >
      <div
        className={cn(
          "relative mb-2.5 h-24 overflow-hidden rounded-xl border",
          mode === "light" && "bg-[#f6f7f9]",
          mode === "dark" && "bg-[#151619]",
          mode === "system" && "bg-[linear-gradient(110deg,#f6f7f9_0_50%,#151619_50%)]",
        )}
      >
        <div className="absolute inset-2 grid grid-cols-[28%_1fr] overflow-hidden rounded-lg border border-black/10 bg-white/75 shadow-sm dark:border-white/10 dark:bg-black/15">
          <div className="border-r border-black/10 bg-black/6 dark:border-white/10 dark:bg-white/6" />
          <div className="space-y-2 p-2">
            <div className="h-2 w-2/3 rounded-full bg-black/15 dark:bg-white/18" />
            <div className="h-2 w-full rounded-full bg-black/8 dark:bg-white/10" />
            <div className="mt-4 h-6 rounded-md border border-black/10 bg-white/70 dark:border-white/10 dark:bg-black/25" />
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 px-1">
        <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="text-xs font-medium">{titleCase(mode)}</span>
        {selected ? <Check className="ml-auto size-3.5 text-info" aria-hidden="true" /> : null}
      </div>
    </button>
  );
}

function ThemeSwatch({ variant }: { variant: AppearanceThemeVariant }) {
  return (
    <span
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-compact font-medium ring-1 ring-inset ring-white/10"
      style={{ background: variant.palette.codeBackground, color: variant.palette.ring }}
      aria-hidden="true"
    >
      Aa
    </span>
  );
}

function AppearanceSelectRow({
  title,
  description,
  value,
  options,
  onChange,
  trailing,
}: {
  title: string;
  description: string;
  value: string;
  options: Array<{
    value: string;
    label: string;
    preview?: ReactNode;
    disabled?: boolean;
    detail?: string;
  }>;
  onChange: (value: string) => void;
  trailing?: ReactNode;
}) {
  const selected = options.find((option) => option.value === value);
  return (
    <SettingsRow
      title={title}
      description={description}
      control={
        <div className="flex w-full flex-wrap items-center gap-2 @lg/settings:w-auto">
          {selected?.preview}
          <Select value={value} onValueChange={(next) => onChange(String(next))}>
            <SelectTrigger className="w-full @lg/settings:w-52" aria-label={title}>
              <SelectValue>
                <span className="truncate">{selected?.label ?? titleCase(value)}</span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="end">
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                  <span className="flex w-full items-center gap-2">
                    {option.preview}
                    <span>{option.label}</span>
                    {option.detail ? (
                      <span className="ml-auto text-xs text-muted-foreground">{option.detail}</span>
                    ) : null}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {trailing}
        </div>
      }
    />
  );
}

function SizeSelect({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: number;
  values: number[];
  onChange: (value: number) => void;
}) {
  return (
    <Select value={String(value)} onValueChange={(next) => onChange(Number(next))}>
      <SelectTrigger className="w-20" aria-label={label}>
        <SelectValue>{value}px</SelectValue>
      </SelectTrigger>
      <SelectContent align="end">
        {values.map((size) => (
          <SelectItem key={size} value={String(size)}>
            {size}px
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function AppearanceSlider({
  label,
  value,
  min,
  max,
  defaultValue,
  isDefault,
  onChange,
  onReset,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  isDefault?: boolean;
  onChange(value: number): void;
  onReset?(): void;
}) {
  const [interaction, setInteraction] = useState<{ source: number; value: number } | null>(null);
  const displayedValue = interaction?.source === value ? interaction.value : value;

  const numberValue = (next: number | readonly number[]) => (Array.isArray(next) ? next[0]! : next);

  return (
    <div className="flex min-w-56 items-center gap-3">
      <span className="w-10 text-right font-mono text-xs tabular-nums">{displayedValue}%</span>
      <Slider
        aria-label={label}
        value={displayedValue}
        min={min}
        max={max}
        step={1}
        className="min-w-32 flex-1"
        onValueChange={(next) =>
          setInteraction((current) => ({
            source: current?.source ?? value,
            value: numberValue(next),
          }))
        }
        onValueCommitted={(next) => {
          const committed = numberValue(next);
          onChange(committed);
          setInteraction(null);
        }}
      />
      <Button
        type="button"
        size="xs"
        variant="ghost"
        disabled={isDefault ?? displayedValue === defaultValue}
        onClick={() => {
          setInteraction(null);
          if (onReset) onReset();
          else onChange(defaultValue);
        }}
      >
        Reset
      </Button>
    </div>
  );
}

function CodeThemePreview({
  theme,
  terminal,
}: {
  theme: string;
  terminal: AppearanceTerminalPalette;
}) {
  const ansi = [
    terminal.red,
    terminal.yellow,
    terminal.green,
    terminal.cyan,
    terminal.blue,
    terminal.magenta,
    terminal.foreground,
  ];
  return (
    <div className="p-4">
      <div className="overflow-hidden rounded-xl border bg-[var(--code-background)] font-mono text-code text-[var(--code-foreground)]">
        <div className="flex h-8 items-center justify-between border-b border-border/60 px-3 text-micro text-muted-foreground">
          <span>appearance/theme.ts</span>
          <span>{theme}</span>
        </div>
        <div className="border-b border-border/60 p-3 [&_.markdown-highlight_pre]:mb-0 [&_.markdown-highlight_pre]:border-0 [&_.markdown-highlight_pre]:p-0">
          <MarkdownCodeBlock
            language="typescript"
            code={'const snapshot = compileTheme({ mode: "system" })\npublish(snapshot)'}
          />
        </div>
        <div className="grid grid-cols-1 @2xl/settings:grid-cols-2">
          <pre className="m-0 border-r border-border/60 bg-destructive/10 p-3 leading-relaxed">
            <span className="text-destructive">-</span> theme: fixedTheme
          </pre>
          <pre className="m-0 bg-success/10 p-3 leading-relaxed">
            <span className="text-success">+</span> theme: snapshot.syntax
          </pre>
        </div>
        <div
          className="flex items-center gap-2 border-t border-border/60 px-3 py-2.5"
          style={{ background: terminal.background, color: terminal.foreground }}
        >
          <span className="mr-auto text-micro">ANSI palette</span>
          {ansi.map((color, index) => (
            <span
              key={`${color}:${index}`}
              className="size-3 rounded-sm border border-white/15"
              style={{ background: color }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function TypographyPreview() {
  return (
    <div className="px-4 py-3">
      <p className="text-sm leading-relaxed">
        Palot keeps prose calm and readable while dense activity stays compact.
      </p>
      <code className="mt-2 block rounded-lg bg-muted/60 px-3 py-2 font-mono text-code">
        const appearance = compileTheme(preferences)
      </code>
    </div>
  );
}

function codeThemeOptions(preferences: AppearancePreferences, scheme: "light" | "dark") {
  return CODE_THEME_IDS.map((value) => ({
    value,
    label: value === "follow" ? "跟随应用主题" : CODE_THEME_OPTIONS[value].name,
    preview: (
      <ThemeSwatch
        variant={
          value === "follow"
            ? appearanceTheme(preferences, scheme)
            : APPEARANCE_THEMES[CODE_THEME_OPTIONS[value].source][scheme]!
        }
      />
    ),
  }));
}

function fullscreenBackdropSourceLabel(source: string | null): string {
  if (source === "custom") return "自定义图片";
  if (source === "system") return "系统壁纸";
  if (source === "builtin") return "默认（渐变重建）";
  return "尚未解析";
}

function titleCase(value: string): string {
  const words = value.replaceAll("-", " ").replaceAll(/([a-z])([A-Z])/g, "$1 $2");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const TOOL_TABS = [
  ["plugins", "插件"],
  ["mcp", "MCP"],
  ["skills", "技能"],
  ["commands", "命令"],
  ["references", "参考资料"],
  ["websearchProviders", "网络搜索"],
] as const;

function matchesInventory(query: string, ...values: Array<string | null | undefined>) {
  return values.filter(Boolean).join(" ").toLowerCase().includes(query.trim().toLowerCase());
}

export function ToolSettings({
  project,
  location,
  snapshot,
  pendingCapabilities = [],
  capabilityStates,
  refresh,
}: {
  project: PalotProject;
  location: LocationRef;
  snapshot: PalotSettingsSnapshot | null;
  pendingCapabilities?: SettingsCapability[];
  capabilityStates?: Partial<Record<SettingsCapability, InventoryLoadState>>;
  refresh(): Promise<void>;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [tab, setTab] = useState<string>("plugins");
  const [queries, setQueries] = useState<Record<string, string>>({});
  const query = queries[tab] ?? "";
  const label = TOOL_TABS.find(([value]) => value === tab)![1];
  const mcpQuery = queries.mcp ?? "";
  const servers = (snapshot?.mcpServers ?? []).filter((server) =>
    matchesInventory(mcpQuery, server.name, server.status, server.error),
  );
  const resources = (snapshot?.mcpResources ?? []).filter((resource) =>
    matchesInventory(mcpQuery, resource.name, resource.description, resource.uri, resource.server),
  );
  const templates = (snapshot?.mcpResourceTemplates ?? []).filter((resource) =>
    matchesInventory(
      mcpQuery,
      resource.name,
      resource.description,
      resource.uriTemplate,
      resource.server,
    ),
  );
  const skills = (snapshot?.skills ?? []).filter((skill) =>
    matchesInventory(queries.skills ?? "", skill.name, skill.description, skill.location),
  );
  const commands = (snapshot?.commands ?? []).filter((command) =>
    matchesInventory(queries.commands ?? "", command.name, command.description, command.agent),
  );
  const references = (snapshot?.references ?? []).filter((reference) =>
    matchesInventory(
      queries.references ?? "",
      reference.name,
      reference.description,
      reference.source,
      reference.sourceType,
    ),
  );
  const websearchProviders = (snapshot?.websearchProviders ?? []).filter((provider) =>
    matchesInventory(queries.websearchProviders ?? "", provider.name, provider.id),
  );
  const state = (capability: SettingsCapability) =>
    capabilityStates?.[capability] ?? inventoryState(snapshot, capability, pendingCapabilities);
  return (
    <>
      <Tabs value={tab} onValueChange={(value) => setTab(String(value))} className="min-w-0 gap-6">
        <div className="overflow-x-auto pb-1">
          <TabsList aria-label="工具清单" activateOnFocus>
            {TOOL_TABS.map(([value, name]) => (
              <TabsTrigger key={value} value={value}>
                {name}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            aria-label={`搜索${label.toLowerCase()}`}
            placeholder={`按名称、描述或来源搜索${label.toLowerCase()}`}
            value={query}
            className="pl-9"
            onChange={(event) =>
              setQueries((current) => ({ ...current, [tab]: event.target.value }))
            }
          />
        </div>
        <TabsContent value="plugins" keepMounted className="data-hidden:hidden">
          <PluginSettings
            key={`${project.id}:${location.directory}:${location.workspaceID ?? ""}`}
            project={project}
            location={location}
            plugins={snapshot?.plugins ?? []}
            query={queries.plugins ?? ""}
            state={state("plugins")}
            refresh={refresh}
          />
        </TabsContent>
        <TabsContent value="mcp" keepMounted className="space-y-8 data-hidden:hidden">
          <SettingsSection
            title="MCP 服务器"
            description="将工具和数据源连接到此项目。"
            icon={PlugZap}
            action={
              <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen(true)}>
                <Plus data-icon="inline-start" aria-hidden="true" />
                Add server
              </Button>
            }
          >
            <SettingsGroup>
              <InventoryState
                title="MCP 服务器"
                state={state("mcp")}
                count={servers.length}
                total={snapshot?.mcpServers.length ?? 0}
                empty="此项目尚未配置 MCP 服务器。"
              />
              {servers.map((server) => (
                <McpServerRow
                  key={server.name}
                  project={project}
                  location={location}
                  server={server}
                  refresh={refresh}
                />
              ))}
            </SettingsGroup>
          </SettingsSection>
          <InventorySection
            title="MCP resources"
            icon={Boxes}
            count={resources.length + templates.length}
            total={
              (snapshot?.mcpResources.length ?? 0) + (snapshot?.mcpResourceTemplates.length ?? 0)
            }
            state={state("mcpResources")}
          >
            {resources.map((resource) => (
              <InventoryRow
                key={`${resource.server}:${resource.uri}`}
                title={resource.name}
                description={resource.description ?? resource.uri}
                detail={`${resource.server} · ${resource.uri}`}
              />
            ))}
            {templates.map((resource) => (
              <InventoryRow
                key={`${resource.server}:${resource.uriTemplate}`}
                title={resource.name}
                description={resource.description ?? resource.uriTemplate}
                detail={`${resource.server} template · ${resource.uriTemplate}`}
              />
            ))}
          </InventorySection>
        </TabsContent>
        <TabsContent value="skills" keepMounted className="data-hidden:hidden">
          <InventorySection
            title="技能"
            icon={BrainCircuit}
            count={skills.length}
            total={snapshot?.skills.length ?? 0}
            state={state("skills")}
          >
            {skills.map((skill) => (
              <InventoryRow
                key={skill.id}
                title={skill.name}
                description={skill.description ?? skill.location}
                detail={[
                  skill.location,
                  skill.slash ? "斜杠命令" : null,
                  skill.autoinvoke ? "自动调用" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
            ))}
          </InventorySection>
        </TabsContent>
        <TabsContent value="commands" keepMounted className="data-hidden:hidden">
          <InventorySection
            title="命令"
            icon={Command}
            count={commands.length}
            total={snapshot?.commands.length ?? 0}
            state={state("commands")}
          >
            {commands.map((command) => (
              <InventoryRow
                key={command.name}
                title={`/${command.name}`}
                description={command.description ?? "可复用的 OpenCode 命令"}
                detail={[
                  command.agent ? `代理 ${command.agent}` : null,
                  command.subtask ? "子任务" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
            ))}
          </InventorySection>
        </TabsContent>
        <TabsContent value="references" keepMounted className="data-hidden:hidden">
          <InventorySection
            title="参考资料"
            icon={Link2}
            count={references.length}
            total={snapshot?.references.length ?? 0}
            state={state("references")}
          >
            {references.map((reference) => (
              <InventoryRow
                key={reference.name}
                title={reference.name}
                description={reference.description ?? reference.source}
                detail={`${reference.sourceType} · ${reference.source}`}
              />
            ))}
          </InventorySection>
        </TabsContent>
        <TabsContent value="websearchProviders" keepMounted className="data-hidden:hidden">
          <InventorySection
            title="网络搜索提供者"
            icon={Search}
            count={websearchProviders.length}
            total={snapshot?.websearchProviders.length ?? 0}
            state={state("websearchProviders")}
          >
            {websearchProviders.map((provider) => (
              <InventoryRow
                key={provider.id}
                title={provider.name}
                description={provider.id}
                detail="read-only"
              />
            ))}
          </InventorySection>
        </TabsContent>
      </Tabs>
      <AddMcpDialog
        open={addOpen}
        project={project}
        location={location}
        onOpenChange={setAddOpen}
        onComplete={refresh}
      />
    </>
  );
}

function pluginTarget(plugin: PalotPlugin): string | undefined {
  const source = plugin.source;
  return source.type === "package"
    ? source.target
    : source.type === "local"
      ? source.path
      : undefined;
}

export function PluginSettings({
  project,
  location,
  plugins,
  query = "",
  state = { status: "ready" },
  refresh,
}: {
  project: PalotProject;
  location: LocationRef;
  plugins: PalotPlugin[];
  query?: string;
  state?: InventoryLoadState;
  refresh(): Promise<void>;
}) {
  const owner = useSettingsOwner();
  const [busy, setBusy] = useState<string | null>(null);
  const [showBuiltins, setShowBuiltins] = useState(false);
  const builtinCount = plugins.filter((plugin) => plugin.source.type === "builtin").length;
  const scopedPlugins = plugins
    .filter((plugin) => showBuiltins || plugin.source.type !== "builtin")
    .sort((a, b) => Number(a.source.type === "builtin") - Number(b.source.type === "builtin"));
  const visiblePlugins = scopedPlugins.filter((plugin) =>
    matchesInventory(
      query,
      plugin.id,
      pluginTarget(plugin),
      plugin.source.type,
      plugin.source.type === "package" ? plugin.source.version : undefined,
      plugin.state.status,
      plugin.state.status === "failed" ? plugin.state.error : undefined,
    ),
  );
  const packagePlugins = plugins.filter((plugin) => plugin.source.type === "package");
  const operationPending =
    busy !== null ||
    plugins.some((plugin) => plugin.source.type === "package" && plugin.source.updating);
  const input = {
    connectionID: owner?.connectionID,
    projectID: project.id,
    directory: location.directory,
    ...(location.workspaceID ? { workspaceID: location.workspaceID } : {}),
  };
  const checkPlugins = useCheckPlugins(input, owner);
  async function check() {
    if (operationPending) return;
    setBusy("check");
    try {
      await checkPlugins();
    } catch (cause) {
      showError("无法检查插件更新", cause);
    } finally {
      setBusy(null);
    }
  }

  async function update(plugin: PalotPlugin) {
    const source = plugin.source;
    if (source.type !== "package" || !source.outdated || operationPending) return;
    setBusy(source.target);
    let failure: unknown;
    try {
      await palot.updatePlugins({ ...input, targets: [source.target] });
    } catch (cause) {
      failure = cause;
    }
    try {
      await refresh();
    } catch (cause) {
      failure = failure
        ? new Error(
            `${failure instanceof Error ? failure.message : String(failure)} Refresh failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          )
        : cause;
    }
    if (failure) showError(`Could not update ${plugin.id ?? source.target}`, failure);
    else toast.add({ type: "success", title: `${plugin.id ?? source.target} updated` });
    setBusy(null);
  }

  return (
    <SettingsSection
      title="插件"
      description="检查已加载的插件、查看包版本并通过 OpenCode 应用更新。"
      icon={Code2}
      action={
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={
              operationPending ||
              packagePlugins.length === 0 ||
              state.status === "loading" ||
              state.status === "unavailable"
            }
            onClick={() => void check()}
          >
            <RefreshCw
              className={busy === "check" ? "animate-spin" : undefined}
              aria-hidden="true"
            />
            检查更新
          </Button>
        </div>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-meta text-muted-foreground">
          {query.trim()
            ? `${scopedPlugins.length} 个中的 ${visiblePlugins.length} 个`
            : `${scopedPlugins.length} ${scopedPlugins.length === 1 ? "个插件" : "个插件"}`}
          {!showBuiltins && builtinCount > 0 ? ` · ${builtinCount} 个内置已隐藏` : ""}
        </p>
        <label className="flex cursor-pointer items-center gap-2 text-compact">
          显示内置插件
          <Switch checked={showBuiltins} onCheckedChange={setShowBuiltins} />
        </label>
      </div>
      <SettingsGroup>
        <InventoryState
          title="插件"
          state={state}
          count={visiblePlugins.length}
          total={scopedPlugins.length}
          empty={
            !showBuiltins && builtinCount > 0
              ? "没有已添加的插件。显示内置插件以浏览 OpenCode 默认值。"
              : "没有返回任何插件。"
          }
        />
        {visiblePlugins.map((plugin, index) => {
          const source = plugin.source;
          const target = pluginTarget(plugin);
          const name = plugin.id ?? target ?? `Plugin ${index + 1}`;
          const updating = source.type === "package" && (busy === source.target || source.updating);
          const outdated = source.type === "package" && source.outdated;
          const failure = plugin.state.status === "failed" ? plugin.state : null;
          return (
            <div
              key={`${source.type}:${target ?? plugin.id ?? index}`}
              className="grid min-w-0 gap-3 p-4 @lg/settings:grid-cols-[minmax(0,1fr)_auto] @lg/settings:items-start"
              role="group"
              aria-label={`${name} 插件`}
            >
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h3 className="min-w-0 text-sm font-medium wrap-anywhere">{name}</h3>
                  <Badge variant={failure ? "destructive" : "outline"}>
                    {failure ? "失败" : "活跃"}
                  </Badge>
                  {outdated && !updating ? (
                    <Badge variant="secondary">有更新</Badge>
                  ) : null}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-2 text-compact text-muted-foreground">
                  <span>{sentenceCase(source.type)}</span>
                  {source.type === "package" && source.version ? (
                    <span>{source.version}</span>
                  ) : null}
                </div>
                {target ? (
                  <p className="mt-1 text-compact leading-relaxed wrap-anywhere text-muted-foreground">
                    {target}
                  </p>
                ) : null}
                {failure ? (
                  <div className="mt-3 text-compact leading-relaxed wrap-anywhere text-destructive">
                    <p>OpenCode 无法激活此插件。</p>
                    <details className="mt-2">
                      <summary className="cursor-pointer rounded-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
                        {name} 的错误详情
                      </summary>
                      <pre className="mt-2 font-mono text-code-compact whitespace-pre-wrap wrap-anywhere">
                        {failure.error}
                        {failure.ref ? `\n${failure.ref}` : ""}
                      </pre>
                    </details>
                  </div>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-x-3 text-meta text-muted-foreground">
                  {plugin.features.server ? <span>服务器</span> : null}
                  {plugin.features.tui ? <span>TUI</span> : null}
                  {plugin.features.rpc ? <span>RPC</span> : null}
                </div>
              </div>
              {source.type === "package" && (outdated || updating) ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!outdated || operationPending}
                  onClick={() => void update(plugin)}
                >
                  {updating ? (
                    <LoaderCircle className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Download aria-hidden="true" />
                  )}
                  {updating ? "正在更新" : "更新"}
                </Button>
              ) : null}
            </div>
          );
        })}
      </SettingsGroup>
    </SettingsSection>
  );
}

function McpServerRow({
  project,
  location,
  server,
  refresh,
}: {
  project: PalotProject;
  location: LocationRef;
  server: PalotMcpServer;
  refresh(): Promise<void>;
}) {
  const owner = useSettingsOwner();
  const [busy, setBusy] = useState(false);
  const input = {
    connectionID: owner?.connectionID,
    server: server.name,
    projectID: project.id,
    directory: location.directory,
    ...(location.workspaceID ? { workspaceID: location.workspaceID } : {}),
  };
  async function run(action: "connect" | "disconnect" | "remove") {
    setBusy(true);
    try {
      if (action === "connect") await palot.connectMcpServer(input);
      if (action === "disconnect") await palot.disconnectMcpServer(input);
      if (action === "remove") await palot.removeMcpServer(input);
      await refresh();
    } catch (cause) {
      showError(`Could not ${action} ${server.name}`, cause);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid min-w-0 gap-3 p-4 @lg/settings:grid-cols-[minmax(0,1fr)_auto] @lg/settings:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <StatusDot status={server.status} />
          <span className="text-sm font-medium wrap-anywhere">{server.name}</span>
          <Badge variant="outline">{server.status.replace("_", " ")}</Badge>
        </div>
        {server.error ? (
          <p className="mt-1 text-compact leading-relaxed wrap-anywhere text-destructive">
            {server.error}
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-1 @lg/settings:justify-end">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={busy}
          onClick={() => void run(server.status === "connected" ? "disconnect" : "connect")}
        >
          {server.status === "connected" ? "Disconnect" : "Connect"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Remove ${server.name}`}
          disabled={busy}
          onClick={() => void run("remove")}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

function AddMcpDialog({
  open,
  project,
  location,
  onOpenChange,
  onComplete,
}: {
  open: boolean;
  project: PalotProject;
  location: LocationRef;
  onOpenChange(open: boolean): void;
  onComplete(): Promise<void>;
}) {
  const owner = useSettingsOwner();
  const [type, setType] = useState<"remote" | "local">("remote");
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [extra, setExtra] = useState("");
  const [cwd, setCwd] = useState("");
  const [oauth, setOauth] = useState(false);
  const [oauthClientID, setOauthClientID] = useState("");
  const [oauthClientSecret, setOauthClientSecret] = useState("");
  const [oauthScope, setOauthScope] = useState("");
  const [oauthCallbackPort, setOauthCallbackPort] = useState("");
  const [oauthRedirectUri, setOauthRedirectUri] = useState("");
  const [startupTimeout, setStartupTimeout] = useState("");
  const [catalogTimeout, setCatalogTimeout] = useState("");
  const [executionTimeout, setExecutionTimeout] = useState("");
  const [disabled, setDisabled] = useState(false);
  const [codemode, setCodemode] = useState(true);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      let config: PalotMcpConfig;
      const timeout = {
        ...(startupTimeout ? { startup: Number(startupTimeout) } : {}),
        ...(catalogTimeout ? { catalog: Number(catalogTimeout) } : {}),
        ...(executionTimeout ? { execution: Number(executionTimeout) } : {}),
      };
      if (type === "remote") {
        const headers = parseKeyValues(extra);
        const oauthConfig = {
          ...(oauthClientID.trim() ? { client_id: oauthClientID.trim() } : {}),
          ...(oauthClientSecret ? { client_secret: oauthClientSecret } : {}),
          ...(oauthScope.trim() ? { scope: oauthScope.trim() } : {}),
          ...(oauthCallbackPort ? { callback_port: Number(oauthCallbackPort) } : {}),
          ...(oauthRedirectUri.trim() ? { redirect_uri: oauthRedirectUri.trim() } : {}),
        };
        config = {
          type: "remote",
          url: target.trim(),
          ...(Object.keys(headers).length ? { headers } : {}),
          ...(oauth ? { oauth: oauthConfig } : {}),
          ...(Object.keys(timeout).length ? { timeout } : {}),
          disabled,
          codemode,
        };
      } else {
        const command = parseCommand(target);
        const environment = parseKeyValues(extra);
        config = {
          type: "local",
          command,
          ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
          ...(Object.keys(environment).length ? { environment } : {}),
          ...(Object.keys(timeout).length ? { timeout } : {}),
          disabled,
          codemode,
        };
      }
      await palot.addMcpServer({
        connectionID: owner?.connectionID,
        server: name.trim(),
        projectID: project.id,
        directory: location.directory,
        ...(location.workspaceID ? { workspaceID: location.workspaceID } : {}),
        config,
      });
      await onComplete();
      setName("");
      setTarget("");
      setExtra("");
      setCwd("");
      setOauth(false);
      setOauthClientID("");
      setOauthClientSecret("");
      setOauthScope("");
      setOauthCallbackPort("");
      setOauthRedirectUri("");
      setStartupTimeout("");
      setCatalogTimeout("");
      setExecutionTimeout("");
      setDisabled(false);
      onOpenChange(false);
      toast.add({ type: "success", title: `${name.trim()} added` });
    } catch (cause) {
      showError("无法添加 MCP 服务器", cause);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add MCP server</DialogTitle>
          <DialogDescription>
            The server is registered for the current OpenCode location and connected immediately.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <label className="grid gap-1.5 text-xs font-medium">
            Server name
            <Input
              value={name}
              placeholder="context7"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium">
            Transport
            <Select value={type} onValueChange={(value) => setType(value as typeof type)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="remote">Remote HTTP</SelectItem>
                <SelectItem value="local">Local command</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1.5 text-xs font-medium">
            {type === "remote" ? "Server URL" : "Command"}
            <Input
              value={target}
              placeholder={type === "remote" ? "https://mcp.example.com/mcp" : "bunx @example/mcp"}
              onChange={(event) => setTarget(event.target.value)}
            />
          </label>
          {type === "local" ? (
            <label className="grid gap-1.5 text-xs font-medium">
              Working directory <span className="font-normal text-muted-foreground">Optional</span>
              <Input
                value={cwd}
                placeholder="/path/to/project"
                onChange={(event) => setCwd(event.target.value)}
              />
            </label>
          ) : null}
          <label className="grid gap-1.5 text-xs font-medium">
            {type === "remote" ? "Headers" : "Environment variables"}
            <Textarea
              value={extra}
              placeholder={
                type === "remote" ? "Authorization=Bearer {env:MCP_TOKEN}" : "LOG_LEVEL=info"
              }
              className="min-h-24 font-mono"
              onChange={(event) => setExtra(event.target.value)}
            />
            <span className="text-micro font-normal text-muted-foreground">
              One NAME=value pair per line.
            </span>
          </label>
          {type === "remote" ? (
            <div className="grid gap-3 rounded-lg border p-3">
              <label className="flex items-center justify-between text-xs">
                <span>
                  <span className="block font-medium">OAuth client</span>
                  <span className="block text-micro text-muted-foreground">
                    Submit client details to OpenCode. The client secret is write-only.
                  </span>
                </span>
                <Switch checked={oauth} onCheckedChange={(checked) => setOauth(Boolean(checked))} />
              </label>
              {oauth ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    aria-label="OAuth client ID"
                    value={oauthClientID}
                    placeholder="客户端 ID"
                    onChange={(event) => setOauthClientID(event.target.value)}
                  />
                  <Input
                    aria-label="OAuth client secret"
                    type="password"
                    value={oauthClientSecret}
                    placeholder="客户端密钥"
                    onChange={(event) => setOauthClientSecret(event.target.value)}
                  />
                  <Input
                    aria-label="OAuth scope"
                    value={oauthScope}
                    placeholder="作用域"
                    onChange={(event) => setOauthScope(event.target.value)}
                  />
                  <Input
                    aria-label="OAuth callback port"
                    type="number"
                    min={1}
                    max={65_535}
                    value={oauthCallbackPort}
                    placeholder="回调端口"
                    onChange={(event) => setOauthCallbackPort(event.target.value)}
                  />
                  <Input
                    aria-label="OAuth redirect URI"
                    value={oauthRedirectUri}
                    placeholder="重定向 URI"
                    className="sm:col-span-2"
                    onChange={(event) => setOauthRedirectUri(event.target.value)}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-3">
            <Input
              aria-label="启动超时"
              type="number"
              min={0}
              value={startupTimeout}
              placeholder="启动超时"
              onChange={(event) => setStartupTimeout(event.target.value)}
            />
            <Input
              aria-label="目录超时"
              type="number"
              min={0}
              value={catalogTimeout}
              placeholder="目录超时"
              onChange={(event) => setCatalogTimeout(event.target.value)}
            />
            <Input
              aria-label="执行超时"
              type="number"
              min={0}
              value={executionTimeout}
              placeholder="执行超时"
              onChange={(event) => setExecutionTimeout(event.target.value)}
            />
          </div>
          <p className="text-micro text-muted-foreground">
            Optional timeout values use the OpenCode SDK units.
          </p>
          <label className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs">
            <span>
              <span className="block font-medium">Start disabled</span>
              <span className="block text-micro text-muted-foreground">
                Register the server without connecting it.
              </span>
            </span>
            <Switch
              checked={disabled}
              onCheckedChange={(checked) => setDisabled(Boolean(checked))}
            />
          </label>
          <label className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs">
            <span>
              <span className="block font-medium">Code Mode</span>
              <span className="block text-micro text-muted-foreground">
                Group MCP tools behind the dispatcher.
              </span>
            </span>
            <Switch
              checked={codemode}
              onCheckedChange={(checked) => setCodemode(Boolean(checked))}
            />
          </label>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy || !name.trim() || !target.trim()}
            onClick={() => void submit()}
          >
            {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
            Add server
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AgentSettings({ snapshot }: { snapshot: PalotSettingsSnapshot | null }) {
  const agents = snapshot?.agents ?? [];
  return (
    <SettingsSection
      title="可用代理"
      description="代理定义来自内置、全局配置、项目配置和代理文件。"
      icon={BrainCircuit}
    >
      <SettingsGroup>
        <InventoryState
          title="智能体"
          state={inventoryState(snapshot, "agents")}
          count={agents.length}
          total={agents.length}
          empty="此项目没有返回任何代理。"
        />
        {agents.map((agent) => (
          <div key={agent.id} className="min-w-0 p-4">
            <div className="flex items-start gap-2">
              <span className="flex size-8 items-center justify-center rounded-lg bg-muted">
                <BrainCircuit
                  className="size-4"
                  style={{ color: agent.color ?? undefined }}
                  aria-hidden="true"
                />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-medium wrap-anywhere">{agent.name}</h3>
                  <Badge variant="outline">{agent.mode}</Badge>
                  {agent.hidden ? <Badge variant="outline">hidden</Badge> : null}
                </div>
                <div className="mt-1 font-mono text-code-compact wrap-anywhere text-muted-foreground">
                  {agent.id}
                </div>
              </div>
            </div>
            <p className="mt-3 text-compact leading-relaxed wrap-anywhere text-muted-foreground">
              {agent.description ?? "没有提供描述。"}
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-meta wrap-anywhere text-muted-foreground">
              <span>{agent.permissions.length} permission rules</span>
              {agent.steps ? <span>· {agent.steps} steps</span> : null}
              {agent.model ? (
                <span>
                  · {agent.model.providerID}/{agent.model.id}
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </SettingsGroup>
    </SettingsSection>
  );
}

function PermissionSettings({
  snapshot,
  pendingCapabilities,
  capabilityStates,
  refresh,
}: {
  snapshot: PalotSettingsSnapshot | null;
  pendingCapabilities: SettingsCapability[];
  capabilityStates: Partial<Record<SettingsCapability, InventoryLoadState>>;
  refresh(): Promise<void>;
}) {
  const owner = useSettingsOwner();
  const permissions = snapshot?.savedPermissions ?? [];
  const location = snapshot?.location;
  return (
    <>
      <SettingsSection
        title="已保存的批准"
        description="这些项目范围的允许规则是在您选择「始终允许」时创建的。已配置的拒绝规则仍然优先。"
        icon={ShieldCheck}
      >
        <SettingsGroup>
          <InventoryState
            title="已保存的批准"
            state={
              capabilityStates.savedPermissions ??
              inventoryState(snapshot, "savedPermissions", pendingCapabilities)
            }
            count={permissions.length}
            total={permissions.length}
            empty="此项目没有已保存的批准。"
          />
          {permissions.map((permission) => (
            <div
              key={permission.id}
              className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 p-4"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-2">
                  <Badge variant="secondary">{permission.action}</Badge>
                  <code
                    className="min-w-0 text-code-compact wrap-anywhere"
                    title={permission.resource}
                  >
                    {permission.resource}
                  </code>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove saved approval for ${permission.resource}`}
                onClick={() =>
                  void palot
                    .removeSavedPermission({
                      connectionID: owner?.connectionID,
                      id: permission.id,
                      projectID: permission.projectID,
                      directory: location?.directory ?? "",
                      ...(location?.workspaceID ? { workspaceID: location.workspaceID } : {}),
                    })
                    .then(refresh)
                    .catch((cause) => showError("无法移除已保存的批准", cause))
                }
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          ))}
        </SettingsGroup>
      </SettingsSection>
      <SettingsSection
        title="已配置的策略"
        description="OpenCode 在此客户端版本中将有效配置来源以只读文档形式暴露。"
        icon={FileCog}
      >
        <SettingsGroup>
          <InventoryState
            title="已配置的策略"
            state={
              capabilityStates.config ?? inventoryState(snapshot, "config", pendingCapabilities)
            }
            count={1}
            total={1}
          />
          {snapshot?.configSources.flatMap((source, sourceIndex) =>
            source.permissions.map((rule, ruleIndex) => (
              <SettingsRow
                key={`${sourceIndex}:${ruleIndex}:${rule.action}:${rule.resource}`}
                title={rule.action}
                description={rule.resource}
                status={source.path ?? source.type}
                control={<Badge variant="outline">{rule.effect}</Badge>}
              />
            )),
          )}
          {(capabilityStates.config ?? inventoryState(snapshot, "config", pendingCapabilities))
            .status === "ready" &&
          snapshot?.configSources.every((source) => source.permissions.length === 0) ? (
            <SettingsRow
              title="权限规则"
              description="没有返回明确的权限规则。编辑来源 JSON 或代理文件以更改已配置的策略。"
              control={<Badge variant="outline">Read-only API</Badge>}
            />
          ) : null}
        </SettingsGroup>
      </SettingsSection>
    </>
  );
}

function ConfigSettings({
  snapshot,
  refresh,
}: {
  snapshot: PalotSettingsSnapshot | null;
  refresh(): Promise<void>;
}) {
  const owner = useSettingsOwner();
  const queryClient = useQueryClient();
  const [reloading, setReloading] = useState(false);
  const [reloadError, setReloadError] = useState<string | null>(null);
  const reload = async () => {
    if (!owner?.connected || reloading) return;
    setReloading(true);
    setReloadError(null);
    try {
      await palot.reloadConfiguration(owner.connectionID);
      await queryClient.invalidateQueries({ queryKey: openCodeKeys.all(owner.connectionID) });
      await refresh();
    } catch (cause) {
      setReloadError(cause instanceof Error ? cause.message : "无法重新加载配置。");
    } finally {
      setReloading(false);
    }
  };
  const inventory = configInventory(snapshot);
  return (
    <>
      <SettingsSection
        title="配置来源"
        description="OpenCode 按优先级从低到高返回发现条目。编辑源文件后，重新加载服务器配置以生效。"
        icon={FileCog}
      >
        <SettingsGroup>
          <SettingsRow
            title="重新加载配置"
            description="为此服务器上的所有位置重新加载配置和插件。待处理的批准和问题将被取消。"
            control={
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!owner?.connected || reloading}
                onClick={() => void reload()}
              >
                {reloading ? "正在重新加载…" : "重新加载配置"}
              </Button>
            }
          />
          {reloadError ? (
            <p role="alert" className="px-4 pb-3 text-compact text-destructive">
              {reloadError}
            </p>
          ) : null}
          <InventoryState
            title="配置来源"
            state={inventoryState(snapshot, "config")}
            count={snapshot?.configSources.length ?? 0}
            total={snapshot?.configSources.length ?? 0}
            empty="没有返回任何配置条目。"
          />
          {snapshot?.configSources.map((source, index) => (
            <div
              key={`${source.type}:${source.path}:${index}`}
              className="flex min-w-0 flex-wrap items-start gap-3 p-4 text-compact"
            >
              <FileCog className="size-3.5 text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 font-medium wrap-anywhere">
                {source.path ?? source.type}
              </span>
              <Badge variant="outline">{source.type}</Badge>
            </div>
          ))}
        </SettingsGroup>
      </SettingsSection>
      <SettingsSection
        title="有效清单"
        description="从发现的配置文档中提取的清理值和计数。只读。"
        icon={Boxes}
      >
        <SettingsGroup>
          <InventoryState
            title="有效清单"
            state={inventoryState(snapshot, "config")}
            count={inventory.length}
            total={inventory.length}
            empty="没有配置任何清单值。"
          />
          {inventory.map(([title, value]) => (
            <SettingsRow
              key={title}
              title={title}
              control={<Badge variant="outline">{value}</Badge>}
            />
          ))}
        </SettingsGroup>
      </SettingsSection>
      <InventorySection
        title="格式化器"
        state={inventoryState(snapshot, "config")}
        icon={Code2}
        count={
          snapshot?.configSources.reduce((count, source) => count + source.formatters.length, 0) ??
          0
        }
      >
        {snapshot?.configSources.flatMap((source, sourceIndex) =>
          source.formatters.map((formatter) => (
            <InventoryRow
              key={`${sourceIndex}:${formatter.id}`}
              title={formatter.id}
              description={
                formatter.executable
                  ? `${formatter.executable}${formatter.argumentCount ? ` + ${formatter.argumentCount} arguments` : ""}`
                  : "未配置命令"
              }
              detail={[
                formatter.disabled ? "disabled" : "enabled",
                formatter.extensions.length ? formatter.extensions.join(", ") : null,
                formatter.environmentVariables.length
                  ? `${formatter.environmentVariables.length} environment variables`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            />
          )),
        )}
      </InventorySection>
      <InventorySection
        title="语言服务器"
        state={inventoryState(snapshot, "config")}
        icon={Braces}
        count={
          snapshot?.configSources.reduce(
            (count, source) => count + source.languageServers.length,
            0,
          ) ?? 0
        }
      >
        {snapshot?.configSources.flatMap((source, sourceIndex) =>
          source.languageServers.map((server) => (
            <InventoryRow
              key={`${sourceIndex}:${server.id}`}
              title={server.id}
              description={
                server.executable
                  ? `${server.executable}${server.argumentCount ? ` + ${server.argumentCount} arguments` : ""}`
                  : "未配置命令"
              }
              detail={[
                server.disabled ? "disabled" : "enabled",
                server.extensions.length ? server.extensions.join(", ") : null,
                server.environmentVariables.length
                  ? `${server.environmentVariables.length} environment variables`
                  : null,
                server.initializationKeys.length
                  ? `${server.initializationKeys.length} initialization keys`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            />
          )),
        )}
      </InventorySection>
      <SettingsSection title="功能状态" icon={Code2}>
        <SettingsGroup>
          <InventoryState
            title="功能状态"
            state={inventoryState(snapshot, "config")}
            count={1}
            total={1}
          />
          {inventoryState(snapshot, "config").status === "ready"
            ? [
                [
                  "快照",
                  configValue(snapshot, "snapshots"),
                  "文件系统撤销和回退支持",
                ],
                [
                  "压缩",
                  configNestedValue(snapshot, "compaction", "auto"),
                  "自动上下文管理",
                ],
                [
                  "会话预热",
                  configValue(snapshot, "warming"),
                  "保持最近的模型会话预热",
                ],
                [
                  "格式化器",
                  configValue(snapshot, "formatter"),
                  "V2 已接受，尚未执行",
                ],
                [
                  "语言服务器",
                  configValue(snapshot, "lsp"),
                  "V2 已接受，尚未启动",
                ],
              ].map(([title, value, description]) => (
                <SettingsRow
                  key={String(title)}
                  title={String(title)}
                  description={String(description)}
                  control={
                    <Badge variant={value === true ? "secondary" : "outline"}>
                      {formatConfigState(value)}
                    </Badge>
                  }
                />
              ))
            : null}
        </SettingsGroup>
      </SettingsSection>
    </>
  );
}

function AboutSettings({ snapshot }: { snapshot: PalotSettingsSnapshot | null }) {
  const runtime = useAtomValue(runtimeAtom);
  const [updateStatus, setUpdateStatus] = useState("");
  return (
    <>
      <SettingsSection title="Palot" icon={PalotMark as ComponentType<{ className?: string }>}>
        <SettingsGroup>
          <SettingsRow
            title="桌面客户端"
            description="A native workspace for OpenCode V2 sessions, worktrees, approvals, and diffs."
            control={<BuildBadge />}
          />
          <SettingsRow
            title="版本"
            control={<code className="text-code-compact">{palotBuild.version}</code>}
          />
          <SettingsRow
            title="频道"
            control={<code className="text-code-compact">{palotBuild.channel}</code>}
          />
          <SettingsRow
            title="提交"
            description={
              palotBuild.dirty ? "含未提交更改的本地构建" : "干净的源代码修订"
            }
            control={
              <code className="max-w-80 text-code-compact" title={palotBuild.commitSha}>
                {palotBuild.commitSha.slice(0, 12)}
              </code>
            }
          />
          <SettingsRow
            title="构建号"
            control={<code className="text-code-compact">{palotBuild.buildNumber}</code>}
          />
          <SettingsRow
            title="OpenCode 合约"
            control={
              <code className="text-code-compact">{palotBuild.openCodeContractVersion}</code>
            }
          />
        </SettingsGroup>
      </SettingsSection>
      <SettingsSection
        title="帮助和法律"
        description="项目信息在 Palot 官方 GitHub 仓库打开。"
        icon={ExternalLink}
      >
        <SettingsGroup>
          {ABOUT_LINKS.map((link) => (
            <SettingsRow
              key={link.href}
              title={link.title}
              description={link.description}
              control={
                <Button
                  render={<a href={link.href} target="_blank" rel="noreferrer" />}
                  variant="outline"
                >
                  Open
                  <ExternalLink data-icon="inline-end" aria-hidden="true" />
                </Button>
              }
            />
          ))}
        </SettingsGroup>
      </SettingsSection>
      <SettingsSection title="更新" icon={RefreshCw}>
        <SettingsGroup>
          <SettingsRow
            title="从源更新"
            description="此代码库尚无受支持的二进制更新通道。请按照源码安装和更新说明操作；Palot 永远不会自动下载或安装更新。"
            control={
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  window.open(PALOT_INSTALLATION_URL, "_blank", "noopener,noreferrer");
                  setUpdateStatus(
                    "已在浏览器中打开源安装和更新说明。",
                  );
                }}
              >
                View instructions
                <ExternalLink data-icon="inline-end" aria-hidden="true" />
              </Button>
            }
          />
        </SettingsGroup>
        <p className="sr-only" role="status" aria-live="polite">
          {updateStatus}
        </p>
      </SettingsSection>
      <SettingsSection title="OpenCode 服务" icon={Server}>
        <SettingsGroup>
          <SettingsRow
            title="状态"
            control={
              <Badge variant={runtime?.connected ? "secondary" : "destructive"}>
                {runtime?.phase ?? "unknown"}
              </Badge>
            }
          />
          <SettingsRow
            title="版本"
            control={<code className="text-code-compact">{runtime?.version ?? "不可用"}</code>}
          />
          <SettingsRow
            title="进程"
            description={runtime?.managed ? "由 Palot 启动" : "发现的共享服务"}
            control={<code className="text-code-compact">PID {runtime?.pid ?? "-"}</code>}
          />
          <SettingsRow
            title="二进制"
            control={
              <code
                className="max-w-80 text-code-compact wrap-anywhere"
                title={runtime?.binaryPath ?? ""}
              >
                {runtime?.binaryPath ?? "未发现"}
              </code>
            }
          />
          <SettingsRow
            title="重启 Palot"
            description="重启开发中或已安装的客户端。共享的 OpenCode 服务保持可用。"
            control={
              <Button
                type="button"
                variant="outline"
                onClick={() => void palot.restartApp("从设置请求重启")}
              >
                重启
              </Button>
            }
          />
        </SettingsGroup>
      </SettingsSection>
      {snapshot?.errors.length ? (
        <SettingsSection title="部分 API 失败" icon={CircleAlert}>
          <SettingsGroup>
            {snapshot.errors.map((value, index) => (
              <SettingsRow
                key={`${value.capability}:${index}`}
                title={value.label}
                description={value.message}
              />
            ))}
          </SettingsGroup>
        </SettingsSection>
      ) : null}
    </>
  );
}

const PALOT_REPOSITORY_URL = "https://github.com/ItsWendell/palot";
const PALOT_INSTALLATION_URL = `${PALOT_REPOSITORY_URL}/blob/main/docs/installation.md#updating-and-uninstalling`;
const ABOUT_LINKS = [
  {
    title: "文档",
    description: "Setup, development, testing, and project documentation.",
    href: `${PALOT_REPOSITORY_URL}/tree/main/docs`,
  },
  {
    title: "问题和支持",
    description: "报告错误、请求功能或寻求帮助。",
    href: `${PALOT_REPOSITORY_URL}/issues`,
  },
  {
    title: "安全",
    description: "阅读安全策略并私下报告漏洞。",
    href: `${PALOT_REPOSITORY_URL}/security/policy`,
  },
  {
    title: "隐私",
    description: "了解 Palot 存储和发送的内容。",
    href: `${PALOT_REPOSITORY_URL}/blob/main/PRIVACY.md`,
  },
  {
    title: "许可证",
    description: "Review Palot and third-party license notices.",
    href: `${PALOT_REPOSITORY_URL}/blob/main/apps/desktop/resources/licenses/THIRD_PARTY_NOTICES.md`,
  },
  {
    title: "发布说明",
    description: "查看所有已发布的 Palot 版本及其说明。",
    href: `${PALOT_REPOSITORY_URL}/releases`,
  },
] as const;

type InventoryLoadState =
  | { status: "ready" | "loading" | "unavailable" }
  | { status: "error"; message: string };

function inventoryState(
  snapshot: PalotSettingsSnapshot | null,
  capability: SettingsCapability,
  pending: SettingsCapability[] = [],
): InventoryLoadState {
  // A nonempty plugin inventory proves the list succeeded. Its errors can also
  // contain activation diagnostics, which belong to the failed plugin rows.
  if (capability === "plugins" && snapshot?.plugins.length) return { status: "ready" };
  const error = snapshot?.errors.find((error) => error.capability === capability);
  if (error) return { status: "error", message: error.message };
  if (pending.includes(capability)) return { status: "loading" };
  return { status: snapshot ? "ready" : "unavailable" };
}

function InventoryState({
  title,
  state,
  count,
  total,
  empty,
}: {
  title: string;
  state: InventoryLoadState;
  count: number;
  total: number;
  empty?: string;
}) {
  if (state.status === "error")
    return (
      <div role="alert" className="space-y-1 p-4 text-compact leading-relaxed wrap-anywhere">
        <p className="font-medium text-destructive">
          {total > 0
            ? `无法刷新${title.toLowerCase()}。显示上次加载的清单。`
            : `无法加载${title.toLowerCase()}。`}
        </p>
        <details className="text-muted-foreground">
          <summary className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-ring">
            {title.toLowerCase()}的错误详情
          </summary>
          <pre className="mt-2 font-mono text-code-compact whitespace-pre-wrap wrap-anywhere">
            {state.message}
          </pre>
        </details>
      </div>
    );
  if (state.status === "loading")
    return (
      <p role="status" className="flex items-center gap-2 p-4 text-compact text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        正在加载{title.toLowerCase()}…
      </p>
    );
  if (state.status === "unavailable")
    return (
      <SettingsEmpty>
        {title}不可用。OpenCode 连接后请刷新设置。
      </SettingsEmpty>
    );
  if (count > 0) return null;
  return (
    <SettingsEmpty>
      {total > 0
        ? `没有${title.toLowerCase()}匹配此搜索。`
        : (empty ?? `没有返回任何${title.toLowerCase()}。`)}
    </SettingsEmpty>
  );
}

function InventorySection({
  title,
  icon,
  count,
  total = count,
  state = { status: "ready" },
  children,
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  count: number;
  total?: number;
  state?: InventoryLoadState;
  children: ReactNode;
}) {
  return (
    <SettingsSection
      title={title}
      icon={icon}
      action={
        state.status === "ready" ? (
          <span className="text-meta text-muted-foreground">
            {count === total ? `${total} total` : `${count} of ${total}`}
          </span>
        ) : undefined
      }
    >
      <SettingsGroup>
        <InventoryState title={title} state={state} count={count} total={total} />
        {children}
      </SettingsGroup>
    </SettingsSection>
  );
}

function InventoryRow({
  title,
  description,
  detail,
}: {
  title: string;
  description: string;
  detail?: string;
}) {
  return (
    <div className="min-w-0 wrap-anywhere">
      <SettingsRow title={title} description={description} status={detail} />
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <div className="space-y-10" aria-label="正在加载设置">
      {[0, 1].map((section) => (
        <section key={section} className="space-y-3">
          <div className="mx-4 h-5 w-32 animate-pulse rounded bg-muted" />
          {[0, 1, 2].map((row) => (
            <div key={row} className="mx-3 h-16 animate-pulse rounded-xl bg-muted/45" />
          ))}
        </section>
      ))}
    </div>
  );
}

function StatusDot({ status }: { status: PalotMcpServer["status"] }) {
  return (
    <span
      className={cn(
        "size-2 rounded-full bg-muted-foreground/40",
        status === "connected" && "bg-success",
        status === "pending" && "animate-pulse bg-info",
        status === "failed" && "bg-destructive",
        status === "needs_auth" && "bg-warning",
      )}
      aria-label={status.replace("_", " ")}
    />
  );
}

function sentenceCase(value: string): string {
  return value ? `${value[0]?.toUpperCase()}${value.slice(1)}` : value;
}

function parseKeyValues(value: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) throw new Error(`Expected NAME=value, received “${trimmed}”.`);
    result[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
  }
  return result;
}

function parseCommand(value: string): string[] {
  const parts = value.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  const command = parts.map((part) => part.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2"));
  if (command.length === 0) throw new Error("请输入命令。");
  return command;
}

function configValue(snapshot: PalotSettingsSnapshot | null, key: string): unknown {
  for (let index = (snapshot?.configSources.length ?? 0) - 1; index >= 0; index -= 1) {
    const summary = snapshot?.configSources[index]?.summary;
    if (summary && key in summary) return summary[key as keyof typeof summary];
  }
  return undefined;
}

function configNestedValue(
  snapshot: PalotSettingsSnapshot | null,
  key: string,
  nested: string,
): unknown {
  if (key === "compaction" && nested === "auto") return configValue(snapshot, "compactionAuto");
  return undefined;
}

function configInventory(snapshot: PalotSettingsSnapshot | null): Array<[string, string]> {
  const fields = [
    ["默认模型", "model"],
    ["默认代理", "defaultAgent"],
    ["更新策略", "update"],
    ["共享", "share"],
    ["Shell 已配置", "shell"],
    ["企业版已配置", "enterprise"],
    ["权限规则", "permissionCount"],
    ["代理定义", "agentCount"],
    ["格式化器", "formatterCount"],
    ["语言服务器", "lspCount"],
    ["监视器已配置", "watcher"],
    ["媒体已配置", "media"],
    ["工具输出已配置", "toolOutput"],
    ["MCP 服务器", "mcpServerCount"],
    ["技能", "skillCount"],
    ["命令", "commandCount"],
    ["指令", "instructionCount"],
    ["参考资料", "referenceCount"],
    ["网络搜索提供者", "websearchProvider"],
    ["插件", "pluginCount"],
    ["提供者", "providerCount"],
    ["实验性策略", "experimentalPolicyCount"],
  ] as const;
  return fields.flatMap(([label, key]) => {
    const value = configValue(snapshot, key);
    if (value === undefined) return [];
    if (typeof value === "boolean") return [[label, value ? "是" : "否"]];
    return [[label, String(value)]];
  });
}

function formatConfigState(value: unknown) {
  if (value === undefined) return "默认";
  if (value === false) return "已禁用";
  if (value === true) return "已启用";
  return "已配置";
}

function showError(title: string, cause: unknown) {
  toast.add({
    type: "error",
    title,
    description: cause instanceof Error ? cause.message : "OpenCode rejected the request.",
  });
}
