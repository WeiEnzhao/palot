import { FolderGit2, LoaderCircle, Server } from "lucide-react";
import { useAtom, useAtomValue } from "jotai";
import { useRouterState } from "@tanstack/react-router";
import { memo, useState } from "react";
import type { OpenCodeProfileSnapshot, OpenCodeRuntimeStatus } from "../../shared";
import type { SidebarMode } from "../../shared/session-triage-contract";
import { automationUnreadCountAtom } from "../atoms/automations";
import { sidebarModeAtom } from "../atoms/ui";
import { runtimeAtom } from "../atoms/workspace";
import { usePalotNavigation } from "../hooks/use-navigation";
import { useConnectionOverview } from "../hooks/use-connection-overview";
import { MultiConnectionSidebar } from "./multi-connection-sidebar";
import { cn } from "../lib/cn";
import { palotBuild } from "../lib/build";
import { palot } from "../services/palot";
import { BuildBadge, PalotMark } from "./branding";
import { IconButton } from "./ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  Sidebar as SidebarPrimitive,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "./ui/sidebar";
import { sidebarItemVariants } from "./ui/sidebar-styles";
import { AppIcon } from "./ui/app-icon";

interface WorkspaceSidebarProps {
  open: boolean;
  onNewSession(directory?: string): void;
  onSearchTasks(trigger: HTMLElement): void;
  /** Shows this view instead of the remembered one (a peek shows the hovered view). */
  mode?: SidebarMode;
  /**
   * `peek` renders the column as a floating overlay below the window header: no
   * drag strip, no shell-transition surface, and no duplicate side effects.
   */
  presentation?: "column" | "peek";
}

export const WorkspaceSidebar = memo(function WorkspaceSidebar({
  open,
  onNewSession,
  onSearchTasks,
  mode: modeOverride,
  presentation = "column",
}: WorkspaceSidebarProps) {
  const storedMode = useAtomValue(sidebarModeAtom);
  const mode = modeOverride ?? storedMode;
  const [, setMode] = useAtom(sidebarModeAtom);
  const peek = presentation === "peek";
  const { openScheduled, openSettings, openUsage, openWorktrees } = usePalotNavigation();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const scheduledUnreadCount = useAtomValue(automationUnreadCountAtom);
  const runtime = useAtomValue(runtimeAtom);
  const { connections, includedProfileIDs, visibleProfileIDs } = useConnectionOverview();
  // 只有一条渲染路径：连接数 =1 时 MultiConnectionSidebar 自己不显示服务器徽标。
  const attentionCount = connections
    .filter(
      (connection) =>
        includedProfileIDs.includes(connection.profile.id) &&
        (visibleProfileIDs === null || visibleProfileIDs.includes(connection.profile.id)),
    )
    .reduce(
      (count, connection) =>
        count +
        [...connection.inbox.pinned, ...connection.inbox.inbox].filter(
          (item) => item.attention || item.failed,
        ).length,
      0,
    );
  const enabledConnections = connections.filter((connection) =>
    includedProfileIDs.includes(connection.profile.id),
  );
  const connectedCount = enabledConnections.filter(
    (connection) => connection.runtime?.connected,
  ).length;
  const connectionSummary =
    connections.length === 0
      ? runtimeLabel(runtime)
      : enabledConnections.length === 0
        ? "服务器已禁用"
        : `${connectedCount} / ${enabledConnections.length} ${enabledConnections.length === 1 ? "台服务器" : "台服务器"}已连接`;

  return (
    <SidebarPrimitive
      collapsible="none"
      className="palot-sidebar w-full border-r-0!"
      // Shell transitions animate the pinned column; a peek animates itself.
      data-shell-surface={peek ? undefined : "navigation"}
      data-sidebar-presentation={presentation}
      aria-label={mode === "inbox" ? "收件箱导航" : "任务导航"}
      aria-hidden={!open}
      inert={!open}
      data-sidebar-mode={mode}
    >
      <SidebarHeader className="gap-0 p-0">
        {peek ? null : (
          <div className="window-drag h-(--shell-header-height) shrink-0" aria-hidden="true" />
        )}
        <div className="flex h-10 shrink-0 items-center gap-2 px-2.5">
          <div className="flex min-w-0 items-center gap-2 pl-1 text-base font-semibold tracking-tight">
            <PalotMark />
            <BuildBadge />
          </div>
          <div
            className="ml-auto flex shrink-0 items-center rounded-md bg-sidebar-foreground/5 p-0.5"
            role="group"
            aria-label="侧边栏视图"
          >
            <InboxModeButton attentionCount={attentionCount} />
            <IconButton
              label="显示项目"
              size="icon-sm"
              aria-pressed={mode === "project"}
              className={cn(
                "size-6 text-sidebar-foreground/55 hover:bg-(--palot-sidebar-hover) hover:text-sidebar-foreground/90",
                mode === "project" && "bg-(--palot-sidebar-selected) text-sidebar-foreground",
              )}
              onClick={() => setMode("project")}
            >
              <AppIcon name="folder" aria-hidden="true" />
            </IconButton>
          </div>
        </div>
        <SidebarGroup className="gap-1 pt-1 pb-2">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton className={sidebarItemVariants()} onClick={() => onNewSession()}>
                <AppIcon name="add" aria-hidden="true" />
                <span>新建任务</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                className={sidebarItemVariants()}
                onClick={(event) => onSearchTasks(event.currentTarget)}
              >
                <AppIcon name="search" aria-hidden="true" />
                <span>搜索任务</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={pathname === "/scheduled"}
                className={sidebarItemVariants()}
                onClick={() => void openScheduled()}
              >
                <AppIcon name="scheduled" aria-hidden="true" />
                <span>已计划</span>
                {scheduledUnreadCount > 0 ? (
                  <span
                    className="ml-auto size-1.5 rounded-full bg-info"
                    aria-label={`${scheduledUnreadCount} 个未读的计划运行`}
                  />
                ) : null}
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarHeader>

      <MultiConnectionSidebar mode={mode} />

      <SidebarFooter className="p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton
                    className={cn(sidebarItemVariants(), "h-auto min-h-10 py-1.5")}
                    isActive={
                      pathname === "/usage" ||
                      pathname === "/worktrees" ||
                      pathname.startsWith("/settings/")
                    }
                    aria-label="打开 Palot 菜单"
                  />
                }
              >
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate font-medium">Palot</span>
                  <span className="block truncate text-micro/tight font-normal text-sidebar-foreground/55">
                    {connectionSummary}
                  </span>
                </span>
                <AppIcon
                  name="chevronUp"
                  className="text-sidebar-foreground/45"
                  aria-hidden="true"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" sideOffset={7} className="w-64 p-1.5">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="px-2 py-2">
                    <span className="block text-sm font-medium text-foreground">
                      {palotBuild.label ? `Palot ${palotBuild.label}` : "Palot"}
                    </span>
                    <span className="mt-0.5 block text-meta font-normal text-muted-foreground">
                      {runtime?.version
                        ? `OpenCode ${runtime.version} · ${runtime.connected ? "已连接" : "已断开"}`
                        : "OpenCode 服务不可用"}
                    </span>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => void openUsage()}>
                    <AppIcon name="usage" aria-hidden="true" />
                    <span>用量</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void openWorktrees()}>
                    <FolderGit2 aria-hidden="true" />
                    <span>工作树</span>
                  </DropdownMenuItem>
                  <ServerProfileMenu onManage={() => void openSettings("connections")} />
                  <DropdownMenuItem onClick={() => void openSettings()}>
                    <AppIcon name="settings" aria-hidden="true" />
                    <span>设置</span>
                    <DropdownMenuShortcut>
                      {window.palot?.platform === "darwin" ? "⌘," : "Ctrl+,"}
                    </DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void openSettings("about")}>
                    <AppIcon name="info" aria-hidden="true" />
                    <span>关于</span>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </SidebarPrimitive>
  );
});

function ServerProfileMenu({ onManage }: { onManage(): void }) {
  const { includedProfileIDs, setIncludedProfileIDs } = useConnectionOverview();
  const [snapshot, setSnapshot] = useState<OpenCodeProfileSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const loadProfiles = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      setSnapshot(await palot.listOpenCodeProfiles());
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <DropdownMenuSub
      onOpenChange={(open) => {
        if (open && !loading) void loadProfiles();
      }}
    >
      <DropdownMenuSubTrigger>
        <Server aria-hidden="true" />
        <span>服务器</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-64 p-1.5">
        {snapshot ? (
          snapshot.profiles.map((profile) => {
            const enabled = includedProfileIDs.includes(profile.id);
            return (
              <DropdownMenuCheckboxItem
                key={profile.id}
                checked={enabled}
                closeOnClick={false}
                onCheckedChange={(checked) =>
                  setIncludedProfileIDs((current) =>
                    checked
                      ? [...new Set([...current, profile.id])]
                      : current.filter((id) => id !== profile.id),
                  )
                }
              >
                <span className="min-w-0 flex-1 truncate">{profile.name}</span>
                <span className="text-meta text-muted-foreground">
                  {enabled ? "已启用" : "已禁用"}
                </span>
              </DropdownMenuCheckboxItem>
            );
          })
        ) : loadError ? (
          <DropdownMenuItem onClick={() => void loadProfiles()}>
            <Server aria-hidden="true" />
            重试加载连接
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled>
            <LoaderCircle className="animate-spin" aria-hidden="true" />
            正在加载连接…
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onManage}>管理连接…</DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function runtimeLabel(runtime: OpenCodeRuntimeStatus | null): string {
  if (!runtime) return "OpenCode 不可用";
  if (runtime.connected) return "OpenCode 已连接";
  if (runtime.phase === "connecting" || runtime.phase === "starting")
    return "正在连接 OpenCode";
  return "OpenCode 已断开";
}

function InboxModeButton({ attentionCount }: { attentionCount: number }) {
  const [mode, setMode] = useAtom(sidebarModeAtom);
  return (
    <IconButton
      label={attentionCount > 0 ? `显示收件箱，${attentionCount} 个需要关注` : "显示收件箱"}
      size="icon-sm"
      aria-pressed={mode === "inbox"}
      className={cn(
        "relative size-6 text-sidebar-foreground/55 hover:bg-(--palot-sidebar-hover) hover:text-sidebar-foreground/90",
        mode === "inbox" && "bg-(--palot-sidebar-selected) text-sidebar-foreground",
      )}
      onClick={() => setMode("inbox")}
    >
      <AppIcon name="inbox" aria-hidden="true" />
      {attentionCount > 0 ? (
        <span
          className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-info ring-1 ring-sidebar"
          aria-hidden="true"
        />
      ) : null}
    </IconButton>
  );
}
