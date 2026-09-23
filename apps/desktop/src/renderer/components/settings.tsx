import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLeft,
  ArrowUpToLine,
  Bell,
  Bot,
  Boxes,
  Braces,
  BrainCircuit,
  Cable,
  Check,
  CircleAlert,
  Code2,
  Command,
  Download,
  Ellipsis,
  FileCog,
  FolderGit2,
  GripVertical,
  ExternalLink,
  Link2,
  LoaderCircle,
  Monitor,
  Moon,
  Palette,
  Pencil,
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
import type { LocationRef, ModelRef } from "@opencode/client";
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
  PalotIntegration,
  PalotIntegrationConnection,
  PalotMcpConfig,
  PalotMcpServer,
  PalotModel,
  PalotPlugin,
  PalotProject,
  PalotSettingsSnapshot,
  SettingsCapability,
} from "../../shared";
import {
  autoBackgroundOnSteerAtom,
  defaultDeliveryAtom,
  defaultModelsAtom,
  modelPickerPreferencesAtom,
  remoteMarkdownFaviconsAtom,
  showTimelineCacheBustsAtom,
  defaultSidebarModeAtom,
  defaultWorktreeBaseAtom,
  defaultWorkspaceModeAtom,
  sessionProjectionPreferenceAtom,
} from "../atoms/ui";
import {
  appearancePreferencesAtom,
  appearanceRestartRequiredAtom,
  resolvedAppearanceAtom,
} from "../atoms/appearance";
import { MarkdownCodeBlock } from "./markdown-code-block";
import { runtimeAtom } from "../atoms/workspace";
import { cn } from "../lib/cn";
import { openCodeKeys } from "../lib/opencode-query";
import { isAppearanceFontAvailable } from "../lib/font-loading";
import {
  applyModelPreference,
  modelPreferenceKey,
  modelProjectPreferenceKey,
  reconcileModelPreference,
  reconcileModelOrder,
  type ModelPickerPreference,
} from "../lib/model-preferences";
import { SETTINGS_NAV_ITEMS, type SettingsCategory } from "../lib/settings-navigation";
import { isPopularProvider, orderProviderIntegrations } from "../lib/provider-presentation";
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
import { ProviderConnectionDialog } from "./provider-connection-dialog";
import { ProviderIcon } from "./ui/provider-icon";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
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
import { SettingsEmpty, SettingsGroup, SettingsRow, SettingsSection } from "./settings-layout";

const CATEGORY_COPY: Record<SettingsCategory, { title: string; description: string }> = {
  general: {
    title: "通用",
    description: "选择新任务的启动方式和 Palot 显示的活动量。",
  },
  project: {
    title: "项目",
    description: "管理项目详情、worktree 启动和主检出目录。",
  },
  connections: {
    title: "连接",
    description: "选择 Palot 的连接位置和访问 OpenCode 的方式。",
  },
  appearance: {
    title: "外观",
    description: "选择工作区的主题、材质和排版。",
  },
  notifications: {
    title: "通知",
    description: "选择 Palot 何时使用 macOS 原生提醒。",
  },
  models: {
    title: "模型",
    description: "选择项目默认值并查看 OpenCode 提供的模型。",
  },
  providers: {
    title: "提供商",
    description: "连接模型提供商并管理其认证方式。",
  },
  tools: {
    title: "工具",
    description: "管理插件和 MCP 服务器，浏览此项目发现的工具。",
  },
  agents: {
    title: "智能体",
    description: "查看此项目中可用的主智能体和子智能体。",
  },
  permissions: {
    title: "权限",
    description: "查看已保存的审批和生效的配置策略。",
  },
  config: {
    title: "配置",
    description: "查看 OpenCode 解析的配置源和功能。",
  },
  diagnostics: {
    title: "诊断",
    description: "查看渲染器、Electron、GPU 和 OpenCode 运行时的实时信号。",
  },
  about: {
    title: "关于",
    description: "查看 Palot 构建详情和已连接的 OpenCode 服务。",
  },
};

const SETTINGS_APP_ICONS: Record<SettingsCategory, AppIconName> = {
  project: "config",
  general: "settings",
  appearance: "appearance",
  notifications: "notifications",
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
  models: ["catalog"],
  providers: ["integrations"],
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
      : "Could not load OpenCode settings."
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
            {(["Palot", "OpenCode", "System"] as const).map((group) => {
              const items = visibleNav.filter((item) => item.group === group);
              if (items.length === 0) return null;
              const groupLabel = group === "Palot" ? "Palot" : group === "OpenCode" ? "OpenCode" : "系统";
              return (
                <div key={group} className="contents md:flex md:flex-col md:gap-px">
                  <div className={cn("hidden md:flex", sidebarSectionLabelVariants())}>{groupLabel}</div>
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
                没有匹配”{query}”的设置。
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
                aria-label="Refresh settings"
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
                  ? " · 更改仅适用于此服务器。你的未完成任务保留在其服务器上。"
                  : " · 设置为只读。请在「连接」中启用并连接此服务器以进行更改。"}
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
                  部分设置需要注意
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
                部分设置仍在加载。可用设置如下所示。
              </p>
            ) : null}
            {error ? (
              <div className="flex items-start gap-3 rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-xs text-destructive">
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1">{error}</span>
                <Button type="button" variant="ghost" size="xs" onClick={() => void refresh()}>
                  重试
                </Button>
              </div>
            ) : null}
            {!project &&
            ![
              "general",
              "appearance",
              "notifications",
              "connections",
              "diagnostics",
              "about",
            ].includes(category) ? (
              <SettingsSection title="未选择项目" icon={FolderGit2}>
                <p className="px-4 text-sm text-muted-foreground">
                  {server.projectsPending
                    ? "正在加载此服务器的项目…"
                    : "请先在此服务器上添加项目，再配置项目级 OpenCode 设置。"}
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
  if (category === "appearance") return <AppearanceSettings />;
  if (category === "notifications") return <NotificationSettings />;
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
  delegation: "委派",
  other: "其他工具",
};

const PROJECTION_PRESET_DESCRIPTIONS: Record<SessionProjectionPreset, string> = {
  "code-focus": "突出最终回复，活动以摘要形式呈现。",
  compact:
    "保持当前阶段展开并显示推理摘要，已完成的工作保持紧凑。",
  expanded: "显示所有活动行，同时保留原始工具输入和输出可供查看。",
};

const PROJECTION_PRESET_LABELS: Record<SessionProjectionPreset, string> = {
  "code-focus": "聚焦",
  compact: "平衡",
  expanded: "详细",
};

const ACTIVITY_PRESENTATION_LABELS: Record<ActivityProjectionPreference["presentation"], string> = {
  individual: "独立",
  grouped: "分组",
  hidden: "完成后隐藏",
};

const DETAIL_DEFAULT_LABELS: Record<ActivityProjectionPreference["details"], string> = {
  collapsed: "收起",
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

const SIDEBAR_MODE_LABELS = {
  remember: "记住",
  project: "项目",
  inbox: "收件箱",
} as const;

const WORKSPACE_MODE_LABELS = {
  worktree: "Worktree",
  current: "当前检出",
} as const;

const WORKTREE_BASE_LABELS = {
  "repository-default": "仓库默认",
  current: "当前分支",
} as const;

const DELIVERY_LABELS = {
  steer: "引导",
  queue: "排队",
} as const;

function GeneralSettings() {
  const [workspaceMode, setWorkspaceMode] = useAtom(defaultWorkspaceModeAtom);
  const [worktreeBase, setWorktreeBase] = useAtom(defaultWorktreeBaseAtom);
  const [projection, setProjection] = useAtom(sessionProjectionPreferenceAtom);
  const [customizeProjection, setCustomizeProjection] = useState(false);
  const [delivery, setDelivery] = useAtom(defaultDeliveryAtom);
  const [autoBackgroundOnSteer, setAutoBackgroundOnSteer] = useAtom(autoBackgroundOnSteerAtom);
  const [showTimelineCacheBusts, setShowTimelineCacheBusts] = useAtom(showTimelineCacheBustsAtom);
  const [remoteMarkdownFavicons, setRemoteMarkdownFavicons] = useAtom(remoteMarkdownFaviconsAtom);
  const [defaultSidebarMode, setDefaultSidebarMode] = useAtom(defaultSidebarModeAtom);
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
          title: error instanceof Error ? error.message : "无法加载定时设置",
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
        title: error instanceof Error ? error.message : "无法更新定时设置",
      });
    }
  };
  return (
    <div className="space-y-8">
      <SettingsSection
        title="任务默认值"
        description="新任务和运行中消息的初始选择。"
      >
        <SettingsGroup>
          <SettingsRow
            title="默认工作区"
            description="默认创建隔离工作树，还是在项目检出中开始。"
            control={
              <Select
                value={workspaceMode}
                onValueChange={(value) => setWorkspaceMode(value as typeof workspaceMode)}
              >
                <SelectTrigger className="w-full @lg/settings:w-44" aria-label="默认工作区">
                  <SelectValue>{WORKSPACE_MODE_LABELS[workspaceMode]}</SelectValue>
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="worktree">New worktree</SelectItem>
                  <SelectItem value="current">Current checkout</SelectItem>
                </SelectContent>
              </Select>
            }
          />
          <SettingsRow
            title="新 worktree 起始点"
            description="从仓库默认分支还是当前分支开始新任务的工作树。"
            control={
              <Select
                value={worktreeBase}
                onValueChange={(value) => setWorktreeBase(value as typeof worktreeBase)}
              >
                <SelectTrigger
                  className="w-full @lg/settings:w-48"
                  aria-label="New worktree starting point"
                >
                  <SelectValue>{WORKTREE_BASE_LABELS[worktreeBase]}</SelectValue>
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="repository-default">Repository default</SelectItem>
                  <SelectItem value="current">Current branch</SelectItem>
                </SelectContent>
              </Select>
            }
          />
          <SettingsRow
            title="运行中的消息"
            description="引导会更新活动轮次。排队会等待当前轮次完成后再开始。"
            control={
              <Select
                value={delivery}
                onValueChange={(value) => setDelivery(value as typeof delivery)}
              >
                <SelectTrigger
                  className="w-full @lg/settings:w-44"
                  aria-label="Messages while running"
                >
                  <SelectValue>{DELIVERY_LABELS[delivery]}</SelectValue>
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="steer">Steer current turn</SelectItem>
                  <SelectItem value="queue">Queue next turn</SelectItem>
                </SelectContent>
              </Select>
            }
          />
          <SettingsRow
            title="自动将阻塞工作发送到后台"
            description="如果引导被阻塞超过五秒，让支持的前台工作在后台继续。"
            control={
              <Switch
                checked={autoBackgroundOnSteer}
                aria-label="引导时自动将阻塞工作发送到后台"
                onCheckedChange={(checked) => setAutoBackgroundOnSteer(Boolean(checked))}
              />
            }
          />
        </SettingsGroup>
      </SettingsSection>
      <SettingsSection
        title="桌面行为"
        description="启动、本地计划和网站图标。"
      >
        <SettingsGroup>
          <SettingsRow
            title="默认侧边栏"
            description="选择 Palot 启动时打开哪个侧边栏，或返回上次使用的。"
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
            title="运行期间防止睡眠"
            description="仅在计划任务准备、排队、运行或完成时保持计算机唤醒。"
            control={
              <Switch
                aria-label="计划运行期间防止睡眠"
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
            description="从 DuckDuckGo 加载消息中链接的公共网站图标。这会分享每个完整的主机名（含子域名），但不分享页面路径。"
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
            title="可能的缓存失效"
            description="当匹配模型步骤之间缓存复用意外下降时，在时间线中显示警告。上下文始终包含这些诊断信息。"
            control={
              <Switch
                checked={showTimelineCacheBusts}
                aria-label="在时间线中显示可能的缓存失效"
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
                    <SelectItem value="compact">平衡</SelectItem>
                    <SelectItem value="expanded">详细</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            }
          />
          <SettingsRow
            title="推理摘要"
            description="在活动组内显示智能体的推理摘要。"
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
            description="智能体工作时保持当前活动组展开。"
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
                    ? "平衡"
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
                      <SelectItem value="individual">Individual</SelectItem>
                      <SelectItem value="grouped">Grouped</SelectItem>
                      <SelectItem value="hidden">Hidden when completed</SelectItem>
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
                      <SelectItem value="collapsed">Collapsed</SelectItem>
                      <SelectItem value="expanded">Expanded</SelectItem>
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
                      <SelectItem value="inside">Inside</SelectItem>
                      <SelectItem value="pinned">Keep visible</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
            <div className="flex items-center justify-between gap-3 border-t bg-muted/10 px-3 py-3">
              <span className="text-xs font-medium">组标题</span>
              <Select
                value={resolvedProjection.groupTitle}
                onValueChange={(value) =>
                  setProjection((current) => ({
                    ...current,
                    groupTitle: value as GroupTitleMode,
                  }))
                }
              >
                <SelectTrigger className="w-44" aria-label="组标题">
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
                    {resolvedProjection.groupSameFileReads ? "每个文件一张卡片" : "独立卡片"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="separate">独立卡片</SelectItem>
                  <SelectItem value="grouped">每个文件一张卡片</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-3 border-t bg-muted/10 px-3 py-3">
              <span className="text-xs font-medium">已完成的轮次</span>
              <Select
                value={resolvedProjection.foldCompletedTurns ? "folded" : "expanded"}
                onValueChange={(value) =>
                  setProjection((current) => ({
                    ...current,
                    foldCompletedTurns: value === "folded",
                  }))
                }
              >
                <SelectTrigger className="w-36" aria-label="已完成的轮次">
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
  unfocused: "仅在非焦点时",
  always: "始终",
};

function NotificationSettings() {
  const [settings, setSettings] = useState<DesktopNotificationSettings | null>(null);
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
  }, []);

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
          title="轮次完成通知"
          description="设置 Palot 何时提醒你任务已完成。"
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
                aria-label="轮次完成通知"
              >
                <SelectValue>
                  {TURN_NOTIFICATION_LABELS[settings?.turnCompletion ?? "always"]}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="never">从不</SelectItem>
                <SelectItem value="unfocused">仅在非焦点时</SelectItem>
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
          description="需要你的输入才能继续时显示提醒。"
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
      description: "选择 Palot 是否可以在工作需要关注时提醒你。",
      action: "允许提醒",
      icon: <Bell />,
      badgeVariant: "outline",
    };
  }
  if (status.authorization === "denied") {
    return {
      label: "已阻止",
      description: "macOS 正在阻止 Palot 提醒。你的应用内选择仍会保存。",
      action: "打开 macOS 设置",
      icon: <ExternalLink />,
      badgeVariant: "destructive",
    };
  }
  if (status.delivery === "off") {
    return {
      label: "已暂停",
      description: "Palot 已获允许，但横幅和通知中心投递均已关闭。",
      action: "打开 macOS 设置",
      icon: <ExternalLink />,
      badgeVariant: "destructive",
    };
  }
  if (status.delivery === "notification-center" || status.authorization === "provisional") {
    return {
      label: "安静",
      description: "更新会进入通知中心，不会打断你当前的任务。",
      action: "发送测试",
      icon: <Bell />,
      badgeVariant: "outline",
    };
  }
  if (status.authorization === "authorized" || status.authorization === "ephemeral") {
    return {
      label: "就绪",
      description:
        "横幅和通知中心可用。你可以随时验证投递路径。",
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
    ? "不透明（因已启用「降低透明度」）"
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
        description="跟随系统或选择配色方案，更改立即生效。"
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
                    : "跟随系统明暗模式，使用已保存的配色方案。"
                : `${resolved.scheme} 模式的配色方案。浅色和深色方案独立保存。`
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
            description={`调整当前${resolved.scheme}主题中表面、控件、边框和辅助文字之间的分隔度。`}
            control={
              <AppearanceSlider
                label={`${titleCase(resolved.scheme)}主题对比度`}
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
            description="文件预览、差异对比、Markdown 代码和终端 ANSI 颜色。"
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
          description="选择 Palot 何时使用浅色和深色配色方案。"
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
        description="滚动条在滚动或与窗格交互时出现。"
        icon={Palette}
      >
        <SettingsGroup>
          <SettingsRow
            title="始终显示滚动条"
            description="保持滚动滑块可见，而非空闲时隐藏。"
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
        title="玻璃与材质"
        description="独立控制渲染器透明度和窗口背后的系统材质。"
        icon={Sparkles}
      >
        <SettingsGroup>
          {window.palot?.platform === "linux" ? (
            <SettingsRow
              title="窗口背景不透明度"
              description="使窗口背景半透明，同时保持文字清晰。启用或禁用透明度需要重启 Palot。你的合成器控制桌面模糊，并可进一步淡化整个窗口。"
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
            description="值越高，合成器、检查器、菜单和对话框越不透明。原生液态玻璃侧边栏保持透明。"
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
            title="主内容不透明度"
            description="让系统材质透过聊天表面和右侧或底部的工作台窗格显示。"
            control={
              <AppearanceSlider
                label="主内容不透明度"
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
            description="为 macOS 液态玻璃添加当前主题背景的色调。"
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
            description="在 Apple 的标准和透明液态玻璃处理之间选择。主题跟随当前配色方案的推荐。"
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
            description="自动跟随当前主题的系统背景。更改此项可能需要重启。"
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
            description="选择导航和设置侧边栏保持不透明还是显示窗口材质。"
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
            title="实际材质"
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
                onClick={() => void palot.restartApp("Apply appearance material")}
              >
                重启
              </Button>
            </div>
          ) : null}
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection
        title="排版"
        description="字体和大小适用于界面、Markdown、文件预览、差异对比和终端。内置字体可离线使用；不可用的系统字体保持禁用。"
        icon={Braces}
      >
        <SettingsGroup>
          <AppearanceSelectRow
            title="界面字体"
            description="代码块、文件预览和终端以外的所有内容。"
            value={preferences.uiFont}
            options={Object.entries(UI_FONT_OPTIONS).map(([value, option]) => ({
              value,
              label:
                fontAvailability[value] === false ? `${option.name}（不可用）` : option.name,
              disabled: fontAvailability[value] === false,
              detail: option.source === "bundled" ? "内置" : undefined,
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
              title="跟随系统等宽字体"
              description="使用 Omarchy 的等宽字体配合系统主题。界面排版保持独立。"
              control={
                <Switch
                  checked={preferences.followOmarchyFont}
                  onCheckedChange={(followOmarchyFont) => update({ followOmarchyFont })}
                  aria-label="跟随系统等宽字体"
                />
              }
            />
          ) : null}
          <AppearanceSelectRow
            title="等宽字体"
            description="代码块、差异对比、文件预览和终端输出。"
            value={preferences.codeFont}
            options={Object.entries(CODE_FONT_OPTIONS).map(([value, option]) => ({
              value,
              label:
                fontAvailability[value] === false ? `${option.name}（不可用）` : option.name,
              disabled: fontAvailability[value] === false,
              detail: option.source === "bundled" ? "内置" : undefined,
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
            description="终端大小保持独立，因此 shell 输出可以保持紧凑或宽松。"
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
        <span className="text-xs font-medium">
          {mode === "system" ? "系统" : mode === "light" ? "浅色" : "深色"}
        </span>
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
        重置
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
    label: value === "follow" ? "Follow app theme" : CODE_THEME_OPTIONS[value].name,
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

function titleCase(value: string): string {
  const words = value.replaceAll("-", " ").replaceAll(/([a-z])([A-Z])/g, "$1 $2");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function ModelSettings({
  project,
  snapshot,
}: {
  project: PalotProject;
  snapshot: PalotSettingsSnapshot | null;
}) {
  const [defaults, setDefaults] = useAtom(defaultModelsAtom);
  const owner = useSettingsOwner();
  const preferenceScope = modelProjectPreferenceKey(owner?.profileID ?? "disconnected", project.id);
  const [preferences, setPreferences] = useAtom(modelPickerPreferencesAtom);
  const [query, setQuery] = useState("");
  const [activeModelKey, setActiveModelKey] = useState<string | null>(null);
  const selected = defaults[preferenceScope] ?? null;
  const models = snapshot?.catalog.models ?? [];
  const preference = reconcileModelPreference(models, preferences[preferenceScope]);
  const orderedModels = applyModelPreference(models, preference, true);
  const hidden = new Set(preference?.hidden ?? []);
  const visibleModels = orderedModels.filter((model) => !hidden.has(modelPreferenceKey(model)));
  const normalizedQuery = query.trim().toLowerCase();
  const filteredModels = normalizedQuery
    ? orderedModels.filter((model) =>
        `${model.name} ${model.id} ${model.providerID}`.toLowerCase().includes(normalizedQuery),
      )
    : orderedModels;
  const selectedModel = selected
    ? (models.find(
        (model) => model.id === selected.id && model.providerID === selected.providerID,
      ) ?? null)
    : null;
  const providers = new Map(
    snapshot?.catalog.providers.map((provider) => [provider.id, provider.name]) ?? [],
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const activeModel = activeModelKey
    ? (orderedModels.find((model) => modelPreferenceKey(model) === activeModelKey) ?? null)
    : null;

  function updatePreference(next: ModelPickerPreference) {
    setPreferences((current) => ({ ...current, [preferenceScope]: next }));
  }

  function setModelEnabled(model: PalotModel, enabled: boolean) {
    const key = modelPreferenceKey(model);
    const nextHidden = new Set(preference?.hidden ?? []);
    if (enabled) nextHidden.delete(key);
    else {
      nextHidden.add(key);
      const fallback = orderedModels.find(
        (candidate) => !nextHidden.has(modelPreferenceKey(candidate)),
      );
      const hidesSelected = selected?.id === model.id && selected.providerID === model.providerID;
      const hidesOpenCodeDefault =
        !selected &&
        snapshot?.catalog.defaultModel?.id === model.id &&
        snapshot.catalog.defaultModel.providerID === model.providerID;
      if (hidesSelected || hidesOpenCodeDefault) {
        setDefaults((current) => {
          if (fallback) return { ...current, [preferenceScope]: modelRef(fallback) };
          const next = { ...current };
          delete next[preferenceScope];
          return next;
        });
      }
    }
    updatePreference({
      hidden: [...nextHidden],
      order: reconcileModelOrder(models, preference),
    });
  }

  function setAllModelsEnabled(enabled: boolean) {
    if (!enabled && selected) {
      setDefaults((current) => {
        const next = { ...current };
        delete next[preferenceScope];
        return next;
      });
    }
    const nextHidden = new Set(preference.hidden);
    for (const model of models) {
      const key = modelPreferenceKey(model);
      if (enabled) nextHidden.delete(key);
      else nextHidden.add(key);
    }
    updatePreference({
      hidden: [...nextHidden],
      order: reconcileModelOrder(models, preference),
    });
  }

  function moveModelToTop(model: PalotModel) {
    const order = reconcileModelOrder(models, preference);
    const from = order.indexOf(modelPreferenceKey(model));
    if (from <= 0) return;
    updatePreference({ hidden: preference?.hidden ?? [], order: arrayMove(order, from, 0) });
  }

  function finishSorting(event: DragEndEvent) {
    setActiveModelKey(null);
    if (!event.over || event.active.id === event.over.id) return;
    const order = reconcileModelOrder(models, preference);
    const from = order.indexOf(String(event.active.id));
    const to = order.indexOf(String(event.over.id));
    if (from < 0 || to < 0) return;
    updatePreference({ hidden: preference?.hidden ?? [], order: arrayMove(order, from, to) });
  }

  return (
    <>
      <SettingsSection
        title="任务默认"
        description="Palot 在创建任务后应用此模型和力度。清除则使用 OpenCode 解析的位置默认值。"
        icon={Sparkles}
      >
        <SettingsGroup>
          <SettingsRow
            title="默认模型"
            description={
              snapshot?.catalog.defaultModel
                ? `OpenCode 当前解析为 ${snapshot.catalog.defaultModel.name}。`
                : "OpenCode 将从项目和全局配置中解析模型。"
            }
            control={
              <Select
                value={selected ? `${selected.providerID}/${selected.id}` : "opencode-default"}
                onValueChange={(value) => {
                  const key = String(value);
                  if (key === "opencode-default") {
                    const next = { ...defaults };
                    delete next[preferenceScope];
                    setDefaults(next);
                    return;
                  }
                  const model = models.find((item) => `${item.providerID}/${item.id}` === key);
                  if (model) setDefaults({ ...defaults, [preferenceScope]: modelRef(model) });
                }}
              >
                <SelectTrigger className="w-full @lg/settings:w-64" aria-label="默认模型">
                  <SelectValue>
                    {selected
                      ? `${providers.get(selected.providerID) ?? selected.providerID} · ${selectedModel?.name ?? selected.id}`
                      : "OpenCode 默认"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="end" className="max-h-80">
                  <SelectItem value="opencode-default">OpenCode 默认</SelectItem>
                  {visibleModels.map((model) => (
                    <SelectItem
                      key={`${model.providerID}/${model.id}`}
                      value={`${model.providerID}/${model.id}`}
                    >
                      {providers.get(model.providerID) ?? model.providerID} · {model.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
          {selectedModel && selectedModel.variants.length > 0 ? (
            <SettingsRow
              title="默认力度"
              description="选择 Palot 在创建任务时与此模型一起使用的推理力度。"
              control={
                <Select
                  value={selected?.variant ?? "model-default"}
                  onValueChange={(value) => {
                    const variant = String(value);
                    setDefaults({
                      ...defaults,
                      [preferenceScope]: modelRef(
                        selectedModel,
                        variant === "model-default" ? undefined : variant,
                      ),
                    });
                  }}
                >
                  <SelectTrigger className="w-full @lg/settings:w-64" aria-label="默认力度">
                    <SelectValue>
                      {selected?.variant ? sentenceCase(selected.variant) : "模型默认"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent align="end">
                    <SelectItem value="model-default">模型默认</SelectItem>
                    {selectedModel.variants.map((variant) => (
                      <SelectItem key={variant} value={variant}>
                        {sentenceCase(variant)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              }
            />
          ) : null}
        </SettingsGroup>
      </SettingsSection>
      <SettingsSection
        title="可用模型"
        description={`Palot 选择器中显示 ${visibleModels.length}/${models.length} 个模型。拖拽可设置选择器顺序。`}
        icon={Bot}
        action={<Badge variant="outline">{visibleModels.length} 个已启用</Badge>}
      >
        <div className="space-y-3">
          <div className="flex flex-col gap-2 @lg/settings:flex-row @lg/settings:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={query}
                placeholder="搜索模型"
                aria-label="搜索模型"
                className="h-8 pl-8"
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="flex shrink-0 items-center self-end rounded-lg border bg-card p-0.5 @lg/settings:self-auto">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={models.length === 0 || visibleModels.length === models.length}
                onClick={() => setAllModelsEnabled(true)}
              >
                全选
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={models.length === 0 || visibleModels.length === 0}
                onClick={() => setAllModelsEnabled(false)}
              >
                取消全选
              </Button>
            </div>
          </div>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            accessibility={{
              screenReaderInstructions: {
                draggable:
                  "按空格键拾起模型。使用方向键移动，空格键放下，或按 Esc 取消。",
              },
              announcements: {
                onDragStart({ active }) {
                  const model = orderedModels.find(
                    (candidate) => modelPreferenceKey(candidate) === active.id,
                  );
                  return `已拾起 ${model?.name ?? "模型"}。`;
                },
                onDragOver({ active, over }) {
                  if (!over) return;
                  const model = orderedModels.find(
                    (candidate) => modelPreferenceKey(candidate) === active.id,
                  );
                  const position = filteredModels.findIndex(
                    (candidate) => modelPreferenceKey(candidate) === over.id,
                  );
                  return `${model?.name ?? "模型"} 在位置 ${position + 1}/${filteredModels.length} 上方。`;
                },
                onDragEnd({ active, over }) {
                  if (!over) return "模型未移动。";
                  const model = orderedModels.find(
                    (candidate) => modelPreferenceKey(candidate) === active.id,
                  );
                  const position = filteredModels.findIndex(
                    (candidate) => modelPreferenceKey(candidate) === over.id,
                  );
                  return `${model?.name ?? "模型"} 已放置在位置 ${position + 1}/${filteredModels.length}。`;
                },
                onDragCancel({ active }) {
                  const model = orderedModels.find(
                    (candidate) => modelPreferenceKey(candidate) === active.id,
                  );
                  return `排序已取消。${model?.name ?? "模型"} 已返回原位。`;
                },
              },
            }}
            onDragStart={(event: DragStartEvent) => setActiveModelKey(String(event.active.id))}
            onDragCancel={() => setActiveModelKey(null)}
            onDragEnd={finishSorting}
          >
            <SortableContext
              items={filteredModels.map(modelPreferenceKey)}
              strategy={verticalListSortingStrategy}
            >
              <SettingsGroup>
                {filteredModels.map((model) => (
                  <SortableModelRow
                    key={modelPreferenceKey(model)}
                    model={model}
                    providerName={providers.get(model.providerID) ?? model.providerID}
                    enabled={!hidden.has(modelPreferenceKey(model))}
                    sortingDisabled={Boolean(normalizedQuery)}
                    moveToTopDisabled={
                      !orderedModels[0] ||
                      modelPreferenceKey(model) === modelPreferenceKey(orderedModels[0])
                    }
                    onEnabledChange={(enabled) => setModelEnabled(model, enabled)}
                    onMoveToTop={() => moveModelToTop(model)}
                  />
                ))}
                <InventoryState
                  title="模型"
                  state={inventoryState(snapshot, "catalog")}
                  count={filteredModels.length}
                  total={models.length}
                  empty="OpenCode 未为此项目返回任何模型。"
                />
              </SettingsGroup>
            </SortableContext>
            <DragOverlay>
              {activeModel ? (
                <div className="rounded-xl border bg-card shadow-xl">
                  <ModelInventoryRow
                    model={activeModel}
                    providerName={providers.get(activeModel.providerID) ?? activeModel.providerID}
                    enabled={!hidden.has(modelPreferenceKey(activeModel))}
                    overlay
                  />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
          {normalizedQuery ? (
            <p className="text-meta text-muted-foreground">清除搜索后可重新排序模型。</p>
          ) : null}
        </div>
      </SettingsSection>
    </>
  );
}

function SortableModelRow({
  model,
  providerName,
  enabled,
  sortingDisabled,
  moveToTopDisabled,
  onEnabledChange,
  onMoveToTop,
}: {
  model: PalotModel;
  providerName: string;
  enabled: boolean;
  sortingDisabled: boolean;
  moveToTopDisabled: boolean;
  onEnabledChange(enabled: boolean): void;
  onMoveToTop(): void;
}) {
  const id = modelPreferenceKey(model);
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: sortingDisabled });
  return (
    <div
      ref={setNodeRef}
      className="border-b border-border/70 last:border-b-0"
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-dragging={isDragging || undefined}
    >
      <ModelInventoryRow
        model={model}
        providerName={providerName}
        enabled={enabled}
        moveToTopDisabled={moveToTopDisabled}
        handle={
          <Button
            ref={setActivatorNodeRef}
            type="button"
            variant="ghost"
            size="icon-sm"
            className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
            aria-label={`重新排序 ${model.name}`}
            disabled={sortingDisabled}
            {...attributes}
            {...listeners}
          >
            <GripVertical aria-hidden="true" />
          </Button>
        }
        onEnabledChange={onEnabledChange}
        onMoveToTop={onMoveToTop}
      />
    </div>
  );
}

function ModelInventoryRow({
  model,
  providerName,
  enabled,
  overlay = false,
  handle,
  moveToTopDisabled = false,
  onEnabledChange,
  onMoveToTop,
}: {
  model: PalotModel;
  providerName: string;
  enabled: boolean;
  overlay?: boolean;
  handle?: ReactNode;
  moveToTopDisabled?: boolean;
  onEnabledChange?(enabled: boolean): void;
  onMoveToTop?(): void;
}) {
  return (
    <div className={cn("flex min-w-0 items-start gap-3 px-3 py-3", !enabled && "opacity-60")}>
      {handle ?? (
        <span className="flex size-6 items-center justify-center text-muted-foreground">
          <GripVertical aria-hidden="true" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-sm font-medium wrap-anywhere">{model.name}</span>
          {model.status !== "active" ? <Badge variant="outline">{model.status}</Badge> : null}
        </div>
        <div className="mt-1 text-compact wrap-anywhere text-muted-foreground">
          {providerName} · <span className="font-mono">{model.id}</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-meta text-muted-foreground">
          <span>{formatTokens(model.contextLimit)} 上下文</span>
          {model.inputLimit ? <span>{formatTokens(model.inputLimit)} 输入限制</span> : null}
          <span>{formatTokens(model.outputLimit)} 输出</span>
          {model.variants.length ? <span>{model.variants.length} 个推理级别</span> : null}
          {model.capabilities.tools ? <span>工具</span> : null}
          {model.capabilities.input.map((capability) => (
            <span key={`input:${capability}`}>{capability} 输入</span>
          ))}
          {model.capabilities.output.map((capability) => (
            <span key={`output:${capability}`}>{capability} 输出</span>
          ))}
        </div>
      </div>
      {overlay ? null : (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label={`将 ${model.name} 移至顶部`}
            title="移至顶部"
            disabled={moveToTopDisabled}
            onClick={onMoveToTop}
          >
            <ArrowUpToLine aria-hidden="true" />
          </Button>
          <Switch
            checked={enabled}
            aria-label={`${enabled ? "禁用" : "启用"} ${model.name}`}
            onCheckedChange={(checked) => onEnabledChange?.(Boolean(checked))}
          />
        </div>
      )}
    </div>
  );
}

const COLLAPSED_PROVIDER_COUNT = 8;

type CredentialActionTarget = {
  integration: PalotIntegration;
  connection: PalotIntegrationConnection;
};

function ProviderSettings({
  project,
  location,
  snapshot,
  refresh,
}: {
  project: PalotProject;
  location: LocationRef;
  snapshot: PalotSettingsSnapshot | null;
  refresh(): Promise<void>;
}) {
  const owner = useSettingsOwner();
  const [dialog, setDialog] = useState<PalotIntegration | null>(null);
  const [wellknownOpen, setWellknownOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [providerQuery, setProviderQuery] = useState("");
  const [activatingCredentialID, setActivatingCredentialID] = useState<string | null>(null);
  const [removingCredentialID, setRemovingCredentialID] = useState<string | null>(null);
  const [removing, setRemoving] = useState<CredentialActionTarget | null>(null);
  const [rename, setRename] = useState<{
    integrationName: string;
    credentialID: string;
    label: string;
  } | null>(null);
  const integrations = snapshot?.integrations ?? [];
  const orderedIntegrations = orderProviderIntegrations(integrations);
  const normalizedQuery = providerQuery.trim().toLowerCase();
  const filteredIntegrations = normalizedQuery
    ? orderedIntegrations.filter((integration) =>
        `${integration.name} ${integration.id}`.toLowerCase().includes(normalizedQuery),
      )
    : orderedIntegrations;
  const connectedIntegrations = filteredIntegrations.filter(
    (integration) => integration.connections.length > 0,
  );
  const availableIntegrations = filteredIntegrations.filter(
    (integration) =>
      integration.connections.length === 0 &&
      integration.methods.some((method) => method.type !== "env"),
  );
  const visibleAvailableIntegrations =
    expanded || normalizedQuery
      ? availableIntegrations
      : availableIntegrations
          .filter((integration) => isPopularProvider(integration.id))
          .slice(0, COLLAPSED_PROVIDER_COUNT);
  const connectedCount = integrations.filter(
    (integration) => integration.connections.length,
  ).length;
  const storedCredentialCount = integrations.reduce(
    (count, integration) =>
      count +
      integration.connections.filter((connection) => connection.type === "credential").length,
    0,
  );

  async function activate(connection: PalotIntegrationConnection) {
    if (!connection.id || connection.active) return;
    setActivatingCredentialID(connection.id);
    try {
      await palot.activateCredential({
        connectionID: owner?.connectionID,
        credentialID: connection.id,
        projectID: project.id,
        directory: location.directory,
        ...(location.workspaceID ? { workspaceID: location.workspaceID } : {}),
      });
      await refresh();
      toast.add({ type: "success", title: `${connection.label} 已在使用` });
    } catch (cause) {
      showError("无法切换凭据", cause);
    } finally {
      setActivatingCredentialID(null);
    }
  }

  async function removeCredential(target: CredentialActionTarget) {
    if (!target.connection.id) return;
    const credentialID = target.connection.id;
    setRemoving(null);
    setRemovingCredentialID(credentialID);
    try {
      await palot.removeCredential({
        connectionID: owner?.connectionID,
        credentialID,
        projectID: project.id,
        directory: location.directory,
        ...(location.workspaceID ? { workspaceID: location.workspaceID } : {}),
      });
      await refresh();
      toast.add({ type: "success", title: `${target.connection.label} 已移除` });
    } catch (cause) {
      showError("无法移除凭据", cause);
    } finally {
      setRemovingCredentialID(null);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <SettingsSection
        title="提供者连接"
        description="凭据属于此 OpenCode 服务，由连接到它的每个项目共享。"
        icon={Cable}
        action={
          <Badge variant="outline">
            {connectedCount} 已连接 · {storedCredentialCount} 已存储
          </Badge>
        }
      >
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={providerQuery}
                placeholder="搜索提供者"
                aria-label="搜索提供者"
                className="h-8 pl-8"
                onChange={(event) => setProviderQuery(event.target.value)}
              />
            </div>
            {integrations.length > COLLAPSED_PROVIDER_COUNT ? (
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                aria-pressed={expanded}
                onClick={() => setExpanded((current) => !current)}
              >
                {expanded ? "仅热门" : "浏览全部"}
              </Button>
            ) : null}
          </div>

          {connectedIntegrations.length > 0 ? (
            <ProviderGroupLabel
              label="已连接"
              detail={`${connectedIntegrations.length} 个提供者`}
            />
          ) : null}
          {connectedIntegrations.length > 0 ? (
            <div className="space-y-3">
              {connectedIntegrations.map((integration) => (
                <ConnectedProviderCard
                  key={integration.id}
                  integration={integration}
                  activatingCredentialID={activatingCredentialID}
                  removingCredentialID={removingCredentialID}
                  onActivate={(connection) => void activate(connection)}
                  onConnect={() => setDialog(integration)}
                  onRename={(connection) =>
                    setRename({
                      integrationName: integration.name,
                      credentialID: connection.id!,
                      label: connection.label,
                    })
                  }
                  onRemove={(connection) => setRemoving({ integration, connection })}
                />
              ))}
            </div>
          ) : null}

          {visibleAvailableIntegrations.length > 0 ? (
            <ProviderGroupLabel
              label={expanded || normalizedQuery ? "可用提供者" : "热门提供者"}
              detail={`已显示 ${visibleAvailableIntegrations.length} 个`}
            />
          ) : null}
          {visibleAvailableIntegrations.length > 0 ? (
            <div className="grid gap-px overflow-hidden rounded-xl border border-border bg-border @3xl/settings:grid-cols-2">
              {visibleAvailableIntegrations.map((integration, index) => (
                <AvailableProviderRow
                  key={integration.id}
                  integration={integration}
                  className={cn(
                    visibleAvailableIntegrations.length % 2 === 1 &&
                      index === visibleAvailableIntegrations.length - 1 &&
                      "@3xl/settings:col-span-2",
                  )}
                  onConnect={() => setDialog(integration)}
                />
              ))}
            </div>
          ) : null}

          <InventoryState
            title="提供者"
            state={inventoryState(snapshot, "integrations")}
            count={connectedIntegrations.length + visibleAvailableIntegrations.length}
            total={integrations.length}
            empty="OpenCode 未返回任何可用的提供者集成。"
          />
        </div>
      </SettingsSection>

      <SettingsSection
        title="高级提供者源"
        description="从受信任的知名 URL 添加自定义集成目录。大多数提供者不需要此功能。"
        icon={Braces}
      >
        <SettingsGroup>
          <SettingsRow
            title="自定义集成目录"
            description="OpenCode 获取并持久化此源发布的集成。"
            control={
              <Button type="button" variant="outline" onClick={() => setWellknownOpen(true)}>
                <Plus data-icon="inline-start" aria-hidden="true" />
                添加源
              </Button>
            }
          />
        </SettingsGroup>
      </SettingsSection>

      <ProviderConnectionDialog
        key={`connect:${dialog?.id ?? "closed"}`}
        integration={dialog}
        projectID={project.id}
        location={location}
        onOpenChange={(open) => !open && setDialog(null)}
        onComplete={refresh}
      />
      <WellknownIntegrationDialog
        open={wellknownOpen}
        project={project}
        location={location}
        onOpenChange={setWellknownOpen}
        onComplete={refresh}
      />
      <CredentialLabelDialog
        key={`rename:${rename?.credentialID ?? "closed"}`}
        credential={rename}
        project={project}
        location={location}
        onOpenChange={(open) => !open && setRename(null)}
        onComplete={refresh}
      />
      <AlertDialog open={Boolean(removing)} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>移除”{removing?.connection.label}”？</AlertDialogTitle>
            <AlertDialogDescription>
              {removing ? credentialRemovalDescription(removing) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removingCredentialID !== null}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={removingCredentialID !== null}
              onClick={() => removing && void removeCredential(removing)}
            >
              移除凭据
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ProviderGroupLabel({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <h3 className="text-sm font-medium">{label}</h3>
      <span className="text-meta text-muted-foreground">{detail}</span>
    </div>
  );
}

function ConnectedProviderCard({
  integration,
  activatingCredentialID,
  removingCredentialID,
  onActivate,
  onConnect,
  onRename,
  onRemove,
}: {
  integration: PalotIntegration;
  activatingCredentialID: string | null;
  removingCredentialID: string | null;
  onActivate(connection: PalotIntegrationConnection): void;
  onConnect(): void;
  onRename(connection: PalotIntegrationConnection): void;
  onRemove(connection: PalotIntegrationConnection): void;
}) {
  const credentials = integration.connections.filter(
    (connection) => connection.type === "credential",
  );
  const environment = integration.connections.filter((connection) => connection.type === "env");
  const connectable = integration.methods.some((method) => method.type !== "env");
  const summary = [
    credentials.length
      ? `${credentials.length} 个已存储凭据`
      : null,
    environment.length
      ? `${environment.length} 个环境变量回退`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <article
      className="overflow-hidden rounded-xl border border-border bg-card"
      aria-label={`${integration.name} connections`}
    >
      <header className="flex flex-wrap items-center gap-3 p-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted/55 text-foreground">
          <ProviderIcon id={integration.id} className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold wrap-anywhere">{integration.name}</h3>
          <p className="mt-1 text-compact text-muted-foreground">{summary}</p>
        </div>
        {connectable ? (
          <Button type="button" variant="outline" size="sm" onClick={onConnect}>
            <Plus data-icon="inline-start" aria-hidden="true" />
            添加凭据
          </Button>
        ) : null}
      </header>
      <div className="divide-y divide-border/60 border-t border-border/60 bg-muted/10">
        {integration.connections.map((connection) => {
          const selectable = connection.type === "credential" && !connection.active;
          const busy =
            connection.id === activatingCredentialID || connection.id === removingCredentialID;
          return (
            <div
              key={connection.id ?? `${connection.type}:${connection.label}`}
              role="group"
              aria-label={`${connection.label} connection`}
              className="grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3"
            >
              <span
                className={cn(
                  "size-2.5 shrink-0",
                  connection.type === "env" ? "rotate-45 rounded-[2px]" : "rounded-full",
                  connection.active
                    ? "bg-primary ring-2 ring-primary/15"
                    : "border border-muted-foreground/45 bg-background",
                )}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-sm font-medium wrap-anywhere">{connection.label}</span>
                  {connection.active ? <Badge variant="secondary">使用中</Badge> : null}
                </div>
                <p className="mt-1 text-compact text-muted-foreground">
                  {connection.type === "credential"
                    ? "已存储凭据"
                    : connection.active
                      ? "环境变量"
                      : "环境变量回退 · 在已存储凭据被移除时使用"}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {selectable ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy || activatingCredentialID !== null}
                    onClick={() => onActivate(connection)}
                  >
                    {connection.id === activatingCredentialID ? (
                      <LoaderCircle className="animate-spin" aria-hidden="true" />
                    ) : null}
                    使用
                  </Button>
                ) : null}
                {connection.type === "credential" && connection.id ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Manage ${connection.label}`}
                          disabled={busy}
                        />
                      }
                    >
                      <Ellipsis aria-hidden="true" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem onClick={() => onRename(connection)}>
                        <Pencil aria-hidden="true" />
                        重命名
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onClick={() => onRemove(connection)}>
                        <Trash2 aria-hidden="true" />
                        移除凭据
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}

function AvailableProviderRow({
  integration,
  className,
  onConnect,
}: {
  integration: PalotIntegration;
  className?: string;
  onConnect(): void;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3 bg-card p-4", className)}>
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted/50 text-foreground">
        <ProviderIcon id={integration.id} className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium wrap-anywhere">{integration.name}</div>
        <div className="font-mono text-code-compact wrap-anywhere text-muted-foreground">
          {integration.id}
        </div>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={onConnect}>
        连接
      </Button>
    </div>
  );
}

function credentialRemovalDescription({ integration, connection }: CredentialActionTarget): string {
  if (!connection.active) {
    return `此操作将从 OpenCode 中移除已存储的凭据。${integration.name} 将继续使用其当前凭据。`;
  }
  const next = integration.connections.find(
    (candidate) => candidate.id !== connection.id && candidate.type === "credential",
  );
  if (next) {
    return `”${next.label}” 将在此 OpenCode 服务中为 ${integration.name} 激活。`;
  }
  const environment = integration.connections.find((candidate) => candidate.type === "env");
  if (environment) {
    return `${integration.name} 将在此 OpenCode 服务中回退到环境变量 ${environment.label}。`;
  }
  return `${integration.name} 在此 OpenCode 服务上将不再有连接。`;
}

function WellknownIntegrationDialog({
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
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await palot.addWellknownIntegration({
        connectionID: owner?.connectionID,
        url: url.trim(),
        projectID: project.id,
        directory: location.directory,
        ...(location.workspaceID ? { workspaceID: location.workspaceID } : {}),
      });
      await onComplete();
      setUrl("");
      onOpenChange(false);
      toast.add({ type: "success", title: "集成源已添加" });
    } catch (cause) {
      showError("无法添加集成源", cause);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>添加集成源</DialogTitle>
          <DialogDescription>
            OpenCode 获取源的知名文档并持久化发现的集成配置。
          </DialogDescription>
        </DialogHeader>
        <label className="grid gap-1.5 text-xs font-medium">
          源 URL
          <Input
            type="url"
            value={url}
            placeholder="https://example.com"
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" disabled={busy || !validHttpUrl(url)} onClick={() => void submit()}>
            {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
            添加源
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CredentialLabelDialog({
  credential,
  project,
  location,
  onOpenChange,
  onComplete,
}: {
  credential: { integrationName: string; credentialID: string; label: string } | null;
  project: PalotProject;
  location: LocationRef;
  onOpenChange(open: boolean): void;
  onComplete(): Promise<void>;
}) {
  const owner = useSettingsOwner();
  const [label, setLabel] = useState(() => credential?.label ?? "");
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!credential) return;
    setBusy(true);
    try {
      await palot.updateCredential({
        connectionID: owner?.connectionID,
        credentialID: credential.credentialID,
        label: label.trim(),
        projectID: project.id,
        directory: location.directory,
        ...(location.workspaceID ? { workspaceID: location.workspaceID } : {}),
      });
      await onComplete();
      onOpenChange(false);
      toast.add({ type: "success", title: `${credential.integrationName} 凭据已重命名` });
    } catch (cause) {
      showError("无法重命名凭据", cause);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={Boolean(credential)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>重命名凭据</DialogTitle>
          <DialogDescription>
            密钥保留在 OpenCode 中。仅更改其显示标签。
          </DialogDescription>
        </DialogHeader>
        <label className="grid gap-1.5 text-xs font-medium">
          标签
          <Input value={label} onChange={(event) => setLabel(event.target.value)} />
        </label>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" disabled={busy || !label.trim()} onClick={() => void submit()}>
            {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const TOOL_TABS = [
  ["plugins", "插件"],
  ["mcp", "MCP"],
  ["skills", "技能"],
  ["commands", "命令"],
  ["references", "参考"],
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
                添加服务器
              </Button>
            }
          >
            <SettingsGroup>
              <InventoryState
                title="MCP 服务器"
                state={state("mcp")}
                count={servers.length}
                total={snapshot?.mcpServers.length ?? 0}
                empty="此项目未配置 MCP 服务器。"
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
            title="MCP 资源"
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
                  skill.slash ? "slash command" : null,
                  skill.autoinvoke ? "auto-invoke" : null,
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
                  command.agent ? `智能体 ${command.agent}` : null,
                  command.subtask ? "subtask" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
            ))}
          </InventorySection>
        </TabsContent>
        <TabsContent value="references" keepMounted className="data-hidden:hidden">
          <InventorySection
            title="参考"
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
                detail="只读"
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
      showError("Could not check plugin updates", cause);
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
      description="查看已加载插件、检查包版本并通过 OpenCode 应用更新。"
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
            ? `${visiblePlugins.length} of ${scopedPlugins.length} plugins`
            : `${scopedPlugins.length} ${scopedPlugins.length === 1 ? "plugin" : "plugins"}`}
          {!showBuiltins && builtinCount > 0 ? ` · ${builtinCount} 个内置隐藏` : ""}
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
              ? "无已添加插件。显示内置插件可浏览 OpenCode 默认项。"
              : "未返回任何插件。"
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
              aria-label={`${name} plugin`}
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
                  {plugin.features.server ? <span>服务端</span> : null}
                  {plugin.features.tui ? <span>终端</span> : null}
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
                  {updating ? "更新中" : "更新"}
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
      showError(`无法${action} ${server.name}`, cause);
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
          {server.status === "connected" ? "断开" : "连接"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`移除 ${server.name}`}
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
      toast.add({ type: "success", title: `${name.trim()} 已添加` });
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
          <DialogTitle>添加 MCP 服务器</DialogTitle>
          <DialogDescription>
            服务器注册到当前 OpenCode 位置并立即连接。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <label className="grid gap-1.5 text-xs font-medium">
            服务器名称
            <Input
              value={name}
              placeholder="context7"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium">
            传输方式
            <Select value={type} onValueChange={(value) => setType(value as typeof type)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="remote">远程 HTTP</SelectItem>
                <SelectItem value="local">本地命令</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1.5 text-xs font-medium">
            {type === "remote" ? "服务器 URL" : "命令"}
            <Input
              value={target}
              placeholder={type === "remote" ? "https://mcp.example.com/mcp" : "bunx @example/mcp"}
              onChange={(event) => setTarget(event.target.value)}
            />
          </label>
          {type === "local" ? (
            <label className="grid gap-1.5 text-xs font-medium">
              工作目录 <span className="font-normal text-muted-foreground">可选</span>
              <Input
                value={cwd}
                placeholder="/path/to/project"
                onChange={(event) => setCwd(event.target.value)}
              />
            </label>
          ) : null}
          <label className="grid gap-1.5 text-xs font-medium">
            {type === "remote" ? "请求头" : "环境变量"}
            <Textarea
              value={extra}
              placeholder={
                type === "remote" ? "Authorization=Bearer {env:MCP_TOKEN}" : "LOG_LEVEL=info"
              }
              className="min-h-24 font-mono"
              onChange={(event) => setExtra(event.target.value)}
            />
            <span className="text-micro font-normal text-muted-foreground">
              每行一个 NAME=value 对。
            </span>
          </label>
          {type === "remote" ? (
            <div className="grid gap-3 rounded-lg border p-3">
              <label className="flex items-center justify-between text-xs">
                <span>
                  <span className="block font-medium">OAuth 客户端</span>
                  <span className="block text-micro text-muted-foreground">
                    向 OpenCode 提交客户端详情。客户端密钥仅写入。
                  </span>
                </span>
                <Switch checked={oauth} onCheckedChange={(checked) => setOauth(Boolean(checked))} />
              </label>
              {oauth ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    aria-label="OAuth 客户端 ID"
                    value={oauthClientID}
                    placeholder="客户端 ID"
                    onChange={(event) => setOauthClientID(event.target.value)}
                  />
                  <Input
                    aria-label="OAuth 客户端密钥"
                    type="password"
                    value={oauthClientSecret}
                    placeholder="客户端密钥"
                    onChange={(event) => setOauthClientSecret(event.target.value)}
                  />
                  <Input
                    aria-label="OAuth 范围"
                    value={oauthScope}
                    placeholder="范围"
                    onChange={(event) => setOauthScope(event.target.value)}
                  />
                  <Input
                    aria-label="OAuth 回调端口"
                    type="number"
                    min={1}
                    max={65_535}
                    value={oauthCallbackPort}
                    placeholder="回调端口"
                    onChange={(event) => setOauthCallbackPort(event.target.value)}
                  />
                  <Input
                    aria-label="OAuth 重定向 URI"
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
            可选超时值使用 OpenCode SDK 单位。
          </p>
          <label className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs">
            <span>
              <span className="block font-medium">启动时禁用</span>
              <span className="block text-micro text-muted-foreground">
                注册服务器但不连接。
              </span>
            </span>
            <Switch
              checked={disabled}
              onCheckedChange={(checked) => setDisabled(Boolean(checked))}
            />
          </label>
          <label className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs">
            <span>
              <span className="block font-medium">代码模式</span>
              <span className="block text-micro text-muted-foreground">
                将 MCP 工具分组到调度器后面。
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
            取消
          </Button>
          <Button
            type="button"
            disabled={busy || !name.trim() || !target.trim()}
            onClick={() => void submit()}
          >
            {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
            添加服务器
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
      title="可用智能体"
      description="智能体定义来自内置、全局配置、项目配置和智能体文件。"
      icon={BrainCircuit}
    >
      <SettingsGroup>
        <InventoryState
          title="智能体"
          state={inventoryState(snapshot, "agents")}
          count={agents.length}
          total={agents.length}
          empty="此项目未返回任何智能体。"
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
              {agent.description ?? "未提供描述。"}
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-meta wrap-anywhere text-muted-foreground">
              <span>{agent.permissions.length} 条权限规则</span>
              {agent.steps ? <span>· {agent.steps} 步</span> : null}
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
        title="已保存的审批"
        description="这些项目范围的允许规则是在你选择「始终允许」时创建的。已配置的拒绝规则仍然优先。"
        icon={ShieldCheck}
      >
        <SettingsGroup>
          <InventoryState
            title="已保存的审批"
            state={
              capabilityStates.savedPermissions ??
              inventoryState(snapshot, "savedPermissions", pendingCapabilities)
            }
            count={permissions.length}
            total={permissions.length}
            empty="此项目没有已保存的审批。"
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
                aria-label={`移除 ${permission.resource} 的已保存审批`}
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
                    .catch((cause) => showError("无法移除已保存的审批", cause))
                }
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          ))}
        </SettingsGroup>
      </SettingsSection>
      <SettingsSection
        title="已配置策略"
        description="OpenCode 在此客户端版本中将有效配置源公开为只读文档。"
        icon={FileCog}
      >
        <SettingsGroup>
          <InventoryState
            title="已配置策略"
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
              description="未返回明确的权限规则。编辑源 JSON 或智能体文件以更改已配置策略。"
              control={<Badge variant="outline">只读 API</Badge>}
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
        title="配置源"
        description="OpenCode 按从低到高的优先级返回发现条目。编辑源文件后，重新加载服务器配置以应用。"
        icon={FileCog}
      >
        <SettingsGroup>
          <SettingsRow
            title="重新加载配置"
            description="重新加载此服务器上所有位置的配置和插件。待处理的审批和问题将被取消。"
            control={
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!owner?.connected || reloading}
                onClick={() => void reload()}
              >
                {reloading ? "重新加载中…" : "重新加载配置"}
              </Button>
            }
          />
          {reloadError ? (
            <p role="alert" className="px-4 pb-3 text-compact text-destructive">
              {reloadError}
            </p>
          ) : null}
          <InventoryState
            title="配置源"
            state={inventoryState(snapshot, "config")}
            count={snapshot?.configSources.length ?? 0}
            total={snapshot?.configSources.length ?? 0}
            empty="未返回任何配置条目。"
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
        description="来自已发现配置文档的脱敏值和计数。只读。"
        icon={Boxes}
      >
        <SettingsGroup>
          <InventoryState
            title="有效清单"
            state={inventoryState(snapshot, "config")}
            count={inventory.length}
            total={inventory.length}
            empty="未配置任何清单值。"
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
                formatter.disabled ? "已禁用" : "已启用",
                formatter.extensions.length ? formatter.extensions.join(", ") : null,
                formatter.environmentVariables.length
                  ? `${formatter.environmentVariables.length} 个环境变量`
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
                server.disabled ? "已禁用" : "已启用",
                server.extensions.length ? server.extensions.join(", ") : null,
                server.environmentVariables.length
                  ? `${server.environmentVariables.length} 个环境变量`
                  : null,
                server.initializationKeys.length
                  ? `${server.initializationKeys.length} 个初始化键`
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
                  "保持最近的模型会话处于预热状态",
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
            description="OpenCode V2 会话、工作树、审批和差异对比的原生工作区。"
            control={<BuildBadge />}
          />
          <SettingsRow
            title="版本"
            control={<code className="text-code-compact">{palotBuild.version}</code>}
          />
          <SettingsRow
            title="通道"
            control={<code className="text-code-compact">{palotBuild.channel}</code>}
          />
          <SettingsRow
            title="提交"
            description={
              palotBuild.dirty ? "包含未提交更改的本地构建" : "干净的源修订"
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
            title="OpenCode 协议"
            control={
              <code className="text-code-compact">{palotBuild.openCodeContractVersion}</code>
            }
          />
        </SettingsGroup>
      </SettingsSection>
      <SettingsSection
        title="帮助与法律"
        description="项目信息在 Palot 官方 GitHub 仓库中打开。"
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
                  打开
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
            description="此代码库尚无支持的二进制更新通道。请按照源安装和更新说明操作；Palot 从不会自动下载或安装更新。"
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
                查看说明
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
            description="重启开发或已安装的客户端。共享 OpenCode 服务保持可用。"
            control={
              <Button
                type="button"
                variant="outline"
                onClick={() => void palot.restartApp("Restart requested from settings")}
              >
                重启
              </Button>
            }
          />
        </SettingsGroup>
      </SettingsSection>
      {snapshot?.errors.length ? (
        <SettingsSection title="部分 API 故障" icon={CircleAlert}>
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
    description: "安装、开发、测试和项目文档。",
    href: `${PALOT_REPOSITORY_URL}/tree/main/docs`,
  },
  {
    title: "问题与支持",
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
    description: "查看 Palot 和第三方许可证声明。",
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
        {title}不可用。OpenCode 连接后刷新设置。
      </SettingsEmpty>
    );
  if (count > 0) return null;
  return (
    <SettingsEmpty>
      {total > 0
        ? `没有${title.toLowerCase()}匹配此搜索。`
        : (empty ?? `未返回任何${title.toLowerCase()}。`)}
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
            {count === total ? `共 ${total} 个` : `${count}/${total}`}
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

function validHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function modelRef(
  model: PalotSettingsSnapshot["catalog"]["models"][number],
  variant?: string,
): ModelRef {
  return {
    id: model.id,
    providerID: model.providerID,
    ...(variant ? { variant } : {}),
  };
}

function sentenceCase(value: string): string {
  return value ? `${value[0]?.toUpperCase()}${value.slice(1)}` : value;
}

function formatTokens(value: number) {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
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
  if (command.length === 0) throw new Error("Enter a command.");
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
    ["默认智能体", "defaultAgent"],
    ["更新策略", "update"],
    ["共享", "share"],
    ["Shell 已配置", "shell"],
    ["企业已配置", "enterprise"],
    ["权限规则", "permissionCount"],
    ["智能体定义", "agentCount"],
    ["格式化器", "formatterCount"],
    ["语言服务器", "lspCount"],
    ["监视器已配置", "watcher"],
    ["媒体已配置", "media"],
    ["工具输出已配置", "toolOutput"],
    ["MCP 服务器", "mcpServerCount"],
    ["技能", "skillCount"],
    ["命令", "commandCount"],
    ["指令", "instructionCount"],
    ["参考", "referenceCount"],
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
    description: cause instanceof Error ? cause.message : "OpenCode 拒绝了请求。",
  });
}
