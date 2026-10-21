import {
  BellRing,
  Check,
  CircleAlert,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  Folder,
  FolderGit2,
  Plus,
  Undo2,
  Upload,
} from "lucide-react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ActivityWatermark, PalotProject, PalotSession } from "../../shared";
import type { PullRequestLink } from "../../shared/source-control-contract";
import { groupedScheduledSessionIDsAtom } from "../atoms/automations";
import { dispatchSessionTriageAtom } from "../atoms/inbox";
import { runtimeAtom, type SessionExecutionState } from "../atoms/workspace";
import { overviewProjectSectionsAtom } from "../atoms/connections";
import { useRouterState } from "@tanstack/react-router";
import {
  attentionSeenIDsAtom,
  attentionTargetAtom,
  markAttentionSeenAtom,
  sidebarSectionsAtom,
} from "../atoms/attention";
import { useAttentionItems, useUnseenAttentionCount } from "../hooks/use-attention-items";
import { useSessionInbox } from "../hooks/use-session-inbox";
import { useSessionActivity } from "../hooks/use-session-activity";
import { usePullRequestLinksBySession } from "../hooks/use-source-control";
import {
  formatRelativeTime,
  groupSessions,
  projectForSession,
  projectLocation,
  projectName,
  selectRecentSessions,
  sessionActivityAt,
} from "../lib/view-models";
import {
  sidebarSessionState,
  sidebarSessionStatus,
  type SidebarSessionState,
  type SidebarSessionStatus,
} from "../lib/sidebar-session-status";
import { cn } from "../lib/cn";
import { ScrollArea } from "./ui/scroll-area";
import { showErrorToast } from "../lib/toast-error";
import { formatSnoozeWakeTime } from "../lib/session-snooze";
import type { InboxSection } from "../lib/session-inbox";
import { palot } from "../services/palot";
import { useSessionTitleEditor } from "../hooks/use-session-title-editor";
import { catalogSessionIsUnread } from "../hooks/use-session-info";
import { usePalotNavigation } from "../hooks/use-navigation";
import {
  useCacheSession,
  useProjectCatalog,
  useSessionCatalog,
} from "../hooks/use-session-catalog";
import { Button } from "./ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { AddProjectDialog } from "./add-project-dialog";
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";
import { SessionContextMenu } from "./session-context-menu";
import { useSessionWindowDrag } from "../hooks/use-session-window-drag";
import { Input } from "./ui/input";
import { PulseDot } from "./ui/pulse-dot";
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "./ui/sidebar";
import {
  sidebarItemVariants,
  sidebarSectionIconVariants,
  sidebarSectionTriggerVariants,
} from "./ui/sidebar-styles";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { toast } from "./ui/toast";
import { INBOX_CARD_ACTION_BUTTON_CLASS } from "./inbox-card-surface";
import { SnoozeMenuButton } from "./inbox-sidebar";
import {
  SidebarFluidList,
  sectionChevronRevealClass,
  sidebarFluidItemClass,
  sidebarFluidRowProps,
} from "./sidebar-fluid-list";
import { PullRequestBadge } from "./pull-requests/pull-request-badge";

const EMPTY_EXECUTION_STATES = new Map<string, SessionExecutionState>();

function currentTimestamp(): number {
  return Date.now();
}

interface ProjectSidebarContentProps {
  onNewSession(directory?: string): void;
  /**
   * Whether this instance raises desktop notifications for new requests. A peeked
   * copy of the column turns it off so the pinned instance stays the only notifier.
   */
  notifyAttention?: boolean;
}

export function ProjectSidebarContent({
  onNewSession,
  notifyAttention = true,
}: ProjectSidebarContentProps) {
  const { openSession, openWorktrees, preloadSession } = usePalotNavigation();
  const projects = useProjectCatalog();
  const sessions = useSessionCatalog();
  const groupedScheduledSessionIDs = useAtomValue(groupedScheduledSessionIDsAtom);
  const runtime = useAtomValue(runtimeAtom);
  const executionStates = useSessionActivity().data?.execution ?? EMPTY_EXECUTION_STATES;
  // One links query backs every task row's PR badge.
  const pullRequests = usePullRequestLinksBySession().data;
  const selectedID = useRouterState({
    select: (state) => {
      const value = state.matches
        .map((match) => match.params as { sessionID?: string })
        .find((params) => params.sessionID)?.sessionID;
      return value ?? null;
    },
  });
  const cacheSession = useCacheSession();
  const inbox = useSessionInbox();
  const attentionItems = useAttentionItems();
  const attentionSessionIDs = useMemo(
    () => new Set(attentionItems.map((item) => item.sessionID)),
    [attentionItems],
  );
  const attentionSeenIDs = useAtomValue(attentionSeenIDsAtom);
  const unseenAttentionCount = useUnseenAttentionCount(attentionItems);
  const [sections, setSections] = useAtom(sidebarSectionsAtom);
  const [projectSections, setProjectSections] = useAtom(overviewProjectSectionsAtom);
  const markAttentionSeen = useSetAtom(markAttentionSeenAtom);
  const setAttentionTarget = useSetAtom(attentionTargetAtom);
  const dispatchTriage = useSetAtom(dispatchSessionTriageAtom);
  const [showAllAttention, setShowAllAttention] = useState(false);
  const [addProjectOpen, setAddProjectOpen] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<{
    originID: string | null;
    targetID: string;
  } | null>(null);
  const visibleSessions = useMemo(
    () => sessions.filter((session) => !groupedScheduledSessionIDs.has(session.id)),
    [groupedScheduledSessionIDs, sessions],
  );
  const groups = useMemo(
    () => groupSessions(projects, visibleSessions),
    [projects, visibleSessions],
  );
  const recentSessions = useMemo(() => {
    const activeSessionIDs = new Set(
      [...executionStates]
        .filter(([, execution]) => execution.status === "running")
        .map(([sessionID]) => sessionID),
    );
    return selectRecentSessions(visibleSessions, activeSessionIDs);
  }, [executionStates, visibleSessions]);
  const inboxItems = useMemo(
    () =>
      new Map(
        [...inbox.pinned, ...inbox.inbox, ...inbox.snoozed, ...inbox.settled].map((item) => [
          item.session.id,
          item,
        ]),
      ),
    [inbox.inbox, inbox.pinned, inbox.settled, inbox.snoozed],
  );
  const previousUnseenCount = useRef(unseenAttentionCount);
  const knownAttentionKeys = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (unseenAttentionCount > previousUnseenCount.current) {
      setSections((current) => ({ ...current, attention: true }));
    }
    previousUnseenCount.current = unseenAttentionCount;
  }, [setSections, unseenAttentionCount]);

  useEffect(() => {
    const currentKeys = new Set(attentionItems.flatMap((item) => item.requestKeys));
    const known = knownAttentionKeys.current;
    if (notifyAttention && known && !document.hasFocus()) {
      for (const item of attentionItems) {
        const request = item.requests.find((candidate) => !known.has(candidate.key));
        if (request) {
          void palot.showAttentionNotification({
            sessionID: request.sessionID,
            requestID: request.id,
            type: request.type,
          });
        }
      }
    }
    knownAttentionKeys.current = currentKeys;
  }, [attentionItems, notifyAttention]);

  const activeSessionID =
    pendingSelection?.originID === selectedID ? pendingSelection.targetID : selectedID;

  const selectSession = useCallback(
    (sessionID: string) => {
      const selection = { originID: selectedID, targetID: sessionID };
      setPendingSelection(selection);
      requestAnimationFrame(() => {
        const clearPendingSelection = () => {
          setPendingSelection((current) =>
            current?.originID === selection.originID && current.targetID === selection.targetID
              ? null
              : current,
          );
        };
        void openSession(sessionID).then(clearPendingSelection, clearPendingSelection);
      });
    },
    [openSession, selectedID],
  );

  function sectionOpen(key: string, fallback = true) {
    return sections[key] ?? fallback;
  }

  function setSectionOpen(key: string, open: boolean) {
    setSections((current) => ({ ...current, [key]: open }));
  }

  function selectAttention(
    sessionID: string,
    requestID: string,
    type: "permission" | "form" | "question" | "input",
  ) {
    markAttentionSeen(`${sessionID}:${type}:${requestID}`);
    setAttentionTarget({ sessionID, requestID, type });
    void openSession(sessionID, {
      focus: "request",
      requestID,
      requestType: type,
    });
  }

  function addFolder() {
    setAddProjectOpen(true);
  }

  async function importTask(location?: PalotSession["location"]) {
    try {
      const imported = await palot.importSession(location, runtime?.connectionID);
      if (!imported) return;
      cacheSession(imported);
      await openSession(imported.id, { profileID: runtime?.profileID });
    } catch (error) {
      showErrorToast("无法导入任务", error);
    }
  }

  const settleSession = useCallback(
    async (sessionID: string, through: ActivityWatermark) => {
      try {
        await dispatchTriage({
          type: "settle",
          sessionID,
          at: currentTimestamp(),
          through,
        });
        toast.add({
          type: "success",
          title: "任务已归档",
          actionProps: {
            children: "撤销",
            onClick: () =>
              void dispatchTriage({ type: "inbox", sessionID, at: currentTimestamp() }),
          },
        });
      } catch (error) {
        showErrorToast("无法归档任务", error);
      }
    },
    [dispatchTriage],
  );

  const snoozeSession = useCallback(
    async (sessionID: string, through: ActivityWatermark, until: number) => {
      try {
        await dispatchTriage({
          type: "snooze",
          sessionID,
          at: currentTimestamp(),
          until,
          through,
        });
        toast.add({
          type: "success",
          title: "任务已暂停",
          description: `将在 ${formatSnoozeWakeTime(until)} 恢复。`,
          actionProps: {
            children: "撤销",
            onClick: () => void dispatchTriage({ type: "wake", sessionID, at: currentTimestamp() }),
          },
        });
      } catch (error) {
        showErrorToast("无法暂停任务", error);
      }
    },
    [dispatchTriage],
  );

  const wakeSession = useCallback(
    async (sessionID: string, through: ActivityWatermark, snoozedUntil: number | null) => {
      try {
        await dispatchTriage({ type: "wake", sessionID, at: currentTimestamp() });
        toast.add({
          type: "success",
          title: "任务已唤醒",
          ...(snoozedUntil !== null && snoozedUntil > currentTimestamp()
            ? {
                actionProps: {
                  children: "撤销",
                  onClick: () =>
                    void dispatchTriage({
                      type: "snooze",
                      sessionID,
                      at: currentTimestamp(),
                      until: snoozedUntil,
                      through,
                    }),
                },
              }
            : {}),
        });
      } catch (error) {
        showErrorToast("无法唤醒任务", error);
      }
    },
    [dispatchTriage],
  );

  const unsettleSession = useCallback(
    async (sessionID: string, through: ActivityWatermark) => {
      try {
        await dispatchTriage({ type: "inbox", sessionID, at: currentTimestamp() });
        toast.add({
          type: "success",
          title: "任务已移至收件箱",
          actionProps: {
            children: "撤销",
            onClick: () =>
              void dispatchTriage({ type: "settle", sessionID, at: currentTimestamp(), through }),
          },
        });
      } catch (error) {
        showErrorToast("无法取消归档任务", error);
      }
    },
    [dispatchTriage],
  );

  return (
    <>
      <SidebarContent className="overflow-hidden">
        {attentionItems.length > 0 ? (
          <Collapsible
            open={sectionOpen("attention")}
            onOpenChange={(value) => setSectionOpen("attention", value)}
          >
            <SidebarGroup className="shrink-0 pt-2 pb-1">
              <CollapsibleTrigger
                render={
                  <SidebarGroupLabel
                    render={<button type="button" />}
                    className={sidebarSectionTriggerVariants()}
                  />
                }
              >
                <span>需要关注</span>
                {unseenAttentionCount > 0 ? (
                  <span className="ml-auto rounded-full bg-destructive px-1.5 text-micro leading-4 text-destructive-foreground">
                    {unseenAttentionCount}
                  </span>
                ) : null}
                {sectionOpen("attention") ? (
                  <ChevronDown
                    className={cn(
                      unseenAttentionCount === 0 && "ml-auto",
                      sidebarSectionIconVariants(),
                    )}
                    aria-hidden="true"
                  />
                ) : (
                  <ChevronRight
                    className={cn(
                      unseenAttentionCount === 0 && "ml-auto",
                      sidebarSectionIconVariants({ direction: "right" }),
                    )}
                    aria-hidden="true"
                  />
                )}
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SidebarGroupContent className="max-h-[min(40vh,20rem)] overflow-y-auto overscroll-contain">
                  <nav aria-label="需要关注的任务">
                    {/* Task rows sit 1px apart (project lists add a 2px inset). A click in that
                        space opens the lit row; anything farther stays inert. */}
                    <SidebarFluidList gapClick={{ maxDistance: 2 }}>
                      <SidebarMenu>
                        {attentionItems.slice(0, showAllAttention ? undefined : 5).map((item) => {
                          const target =
                            item.requests.find(
                              (request) =>
                                !attentionSeenIDs.includes(request.key) &&
                                !attentionSeenIDs.includes(request.legacyKey),
                            ) ?? item.requests[0]!;
                          return (
                            <SidebarMenuItem key={item.key} {...sidebarFluidRowProps}>
                              <SidebarMenuButton
                                data-palot-attention-row
                                onClick={() =>
                                  selectAttention(target.sessionID, target.id, target.type)
                                }
                              >
                                <CircleAlert aria-hidden="true" />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate">{item.sessionTitle}</span>
                                  <span className="block truncate text-meta text-muted-foreground">
                                    {item.count === 1
                                      ? `${item.sessionID !== item.key ? "子智能体 " : ""}${item.type} · ${item.projectName}`
                                      : `${item.count} 个请求 · ${item.types.join(" + ")}`}
                                  </span>
                                </span>
                              </SidebarMenuButton>
                              {item.requests.some(
                                (request) =>
                                  !attentionSeenIDs.includes(request.key) &&
                                  !attentionSeenIDs.includes(request.legacyKey),
                              ) ? (
                                <SidebarMenuBadge className="size-2 min-w-0 rounded-full bg-destructive p-0" />
                              ) : null}
                            </SidebarMenuItem>
                          );
                        })}
                        {attentionItems.length > 5 ? (
                          <SidebarMenuItem {...sidebarFluidRowProps}>
                            <SidebarMenuButton
                              onClick={() => setShowAllAttention((current) => !current)}
                            >
                              <span>
                                {showAllAttention
                                  ? "收起"
                                  : `显示全部 (${attentionItems.length})`}
                              </span>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        ) : null}
                      </SidebarMenu>
                    </SidebarFluidList>
                  </nav>
                </SidebarGroupContent>
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>
        ) : null}
        <Collapsible
          open={sectionOpen("recents", false)}
          onOpenChange={(value) => setSectionOpen("recents", value)}
        >
          <SidebarGroup className="shrink-0 pt-2 pb-1">
            <CollapsibleTrigger
              render={
                <SidebarGroupLabel
                  render={<button type="button" />}
                  className={sidebarSectionTriggerVariants()}
                />
              }
            >
              <span>最近任务</span>
              {sectionOpen("recents") ? (
                <ChevronDown
                  className={cn("ml-auto", sidebarSectionIconVariants())}
                  aria-hidden="true"
                />
              ) : (
                <ChevronRight
                  className={cn("ml-auto", sidebarSectionIconVariants({ direction: "right" }))}
                  aria-hidden="true"
                />
              )}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <SidebarGroupContent>
                <nav aria-label="最近任务">
                  <SidebarFluidList gapClick={{ maxDistance: 2 }}>
                    <SidebarMenu>
                      {recentSessions.map((session) => {
                        const item = inboxItems.get(session.id);
                        return (
                          <SessionRow
                            key={session.id}
                            session={session}
                            project={projectForSession(projects, session)}
                            selected={session.id === activeSessionID}
                            status={sidebarSessionStatus(executionStates.get(session.id))}
                            attention={attentionSessionIDs.has(session.id)}
                            recent
                            pullRequests={pullRequests?.get(session.id)}
                            triageThrough={item?.activityThrough}
                            triageSection={item?.section}
                            snoozedUntil={item?.snoozedUntil ?? null}
                            canSettle={Boolean(item?.canSettle && item.section !== "settled")}
                            onSelect={selectSession}
                            onPreload={preloadSession}
                            onSnooze={snoozeSession}
                            onSettle={settleSession}
                            onWake={wakeSession}
                            onUnsettle={unsettleSession}
                          />
                        );
                      })}
                      {recentSessions.length === 0 ? (
                        <li className="px-2 py-1 text-xs text-muted-foreground">没有最近的任务</li>
                      ) : null}
                    </SidebarMenu>
                  </SidebarFluidList>
                </nav>
              </SidebarGroupContent>
            </CollapsibleContent>
          </SidebarGroup>
        </Collapsible>
        <Collapsible
          open={sectionOpen("projects")}
          onOpenChange={(value) => setSectionOpen("projects", value)}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <SidebarGroup className="min-h-0 flex-1">
            <div className="group/projects-header relative">
              <CollapsibleTrigger
                render={
                  <SidebarGroupLabel
                    render={<button type="button" />}
                    className={sidebarSectionTriggerVariants()}
                  />
                }
              >
                <span>项目</span>
                {sectionOpen("projects") ? (
                  <ChevronDown
                    className={cn("ml-auto", sidebarSectionIconVariants())}
                    aria-hidden="true"
                  />
                ) : (
                  <ChevronRight
                    className={cn("ml-auto", sidebarSectionIconVariants({ direction: "right" }))}
                    aria-hidden="true"
                  />
                )}
              </CollapsibleTrigger>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <SidebarGroupAction
                      type="button"
                      aria-label="添加项目文件夹"
                      className="pointer-events-none top-1 right-7 opacity-0 transition-opacity group-hover/projects-header:pointer-events-auto group-hover/projects-header:opacity-100 group-has-[:focus-visible]/projects-header:pointer-events-auto group-has-[:focus-visible]/projects-header:opacity-100 hover:bg-sidebar-accent/60! hover:text-sidebar-foreground/75! focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:ring-inset [&>svg]:size-3.5!"
                      onClick={() => void addFolder()}
                    />
                  }
                >
                  <Plus aria-hidden="true" />
                </TooltipTrigger>
                <TooltipContent>添加项目文件夹</TooltipContent>
              </Tooltip>
            </div>
            <CollapsibleContent className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <SidebarGroupContent className="min-h-0 flex-1">
                <ScrollArea className="h-full min-h-0">
                  <nav aria-label="项目和任务">
                    <SidebarMenu className="gap-2">
                      {groups.map(({ project, sessions: projectSessions }) => {
                        const projectKey = JSON.stringify([runtime?.profileID, project.id]);
                        const projectOpen =
                          projectSections[projectKey] ?? projectSessions.length > 0;
                        const displayName = projectName(project);
                        return (
                          <SidebarMenuItem
                            key={project.id}
                            data-palot-project-row
                            className="border-t border-sidebar-border/40 pt-2.5 first:border-0 first:pt-0"
                          >
                            <Collapsible
                              className="relative"
                              open={projectOpen}
                              onOpenChange={(value) =>
                                setProjectSections((current) => ({
                                  ...current,
                                  [projectKey]: value,
                                }))
                              }
                            >
                              <ContextMenu>
                                <ContextMenuTrigger
                                  render={
                                    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center">
                                      <CollapsibleTrigger
                                        data-palot-project-trigger
                                        render={
                                          <button
                                            type="button"
                                            className={cn(
                                              sidebarSectionTriggerVariants(),
                                              "col-span-3 col-start-1 row-start-1 grid grid-cols-subgrid text-base font-semibold text-sidebar-foreground",
                                            )}
                                          />
                                        }
                                      >
                                        <span className="flex min-w-0 items-center gap-2 text-left">
                                          <Folder
                                            aria-hidden="true"
                                            className="size-4 shrink-0 text-sidebar-foreground/60"
                                          />
                                          <span className="min-w-0 truncate">{displayName}</span>
                                        </span>
                                        <span className="w-7" aria-hidden="true" />
                                        <span className="ml-auto flex items-center">
                                          {projectOpen ? (
                                            <ChevronDown
                                              className={sidebarSectionIconVariants()}
                                              aria-hidden="true"
                                            />
                                          ) : (
                                            <ChevronRight
                                              className={sidebarSectionIconVariants({
                                                direction: "right",
                                              })}
                                              aria-hidden="true"
                                            />
                                          )}
                                        </span>
                                      </CollapsibleTrigger>
                                      <div className="relative z-10 col-start-2 row-start-1 flex items-center justify-center">
                                        <Tooltip>
                                          <TooltipTrigger
                                            render={
                                              <SidebarMenuAction
                                                type="button"
                                                data-palot-project-action
                                                aria-label={`在 ${displayName} 中新建任务`}
                                                showOnHover
                                                className="relative! top-auto! right-auto! text-sidebar-foreground/45! hover:bg-sidebar-accent/60! hover:text-sidebar-foreground/75! focus-visible:ring-inset [&>svg]:size-3!"
                                                onClick={(event) => {
                                                  event.stopPropagation();
                                                  onNewSession(projectLocation(project));
                                                }}
                                              />
                                            }
                                          >
                                            <Plus aria-hidden="true" />
                                          </TooltipTrigger>
                                          <TooltipContent side="right">
                                            在 {displayName} 中新建任务
                                          </TooltipContent>
                                        </Tooltip>
                                      </div>
                                    </div>
                                  }
                                />
                                <ContextMenuContent>
                                  <ContextMenuItem onClick={() => void openWorktrees(project.id)}>
                                    <FolderGit2 aria-hidden="true" />
                                    管理工作树
                                  </ContextMenuItem>
                                </ContextMenuContent>
                              </ContextMenu>
                              <CollapsibleContent>
                                <SidebarFluidList gapClick={{ maxDistance: 2 }}>
                                  <SidebarMenuSub className="mx-0 w-full translate-x-0 gap-px border-l-0 px-0 py-0.5">
                                    {projectSessions.map((session) => {
                                      const item = inboxItems.get(session.id);
                                      return (
                                        <SessionRow
                                          key={session.id}
                                          session={session}
                                          project={project}
                                          selected={session.id === activeSessionID}
                                          status={sidebarSessionStatus(
                                            executionStates.get(session.id),
                                          )}
                                          attention={attentionSessionIDs.has(session.id)}
                                          pullRequests={pullRequests?.get(session.id)}
                                          triageThrough={item?.activityThrough}
                                          triageSection={item?.section}
                                          snoozedUntil={item?.snoozedUntil ?? null}
                                          canSettle={Boolean(
                                            item?.canSettle && item.section !== "settled",
                                          )}
                                          onSelect={selectSession}
                                          onPreload={preloadSession}
                                          onSnooze={snoozeSession}
                                          onSettle={settleSession}
                                          onWake={wakeSession}
                                          onUnsettle={unsettleSession}
                                        />
                                      );
                                    })}
                                    {projectSessions.length === 0 ? (
                                      <li className="flex items-center justify-between gap-2 px-2 py-1 text-xs text-muted-foreground">
                                        <span>此项目没有任务</span>
                                        <button
                                          type="button"
                                          className="text-foreground/70 hover:text-foreground"
                                          onClick={() =>
                                            void importTask({
                                              directory: projectLocation(project),
                                            })
                                          }
                                        >
                                          导入
                                        </button>
                                      </li>
                                    ) : null}
                                  </SidebarMenuSub>
                                </SidebarFluidList>
                              </CollapsibleContent>
                            </Collapsible>
                          </SidebarMenuItem>
                        );
                      })}
                    </SidebarMenu>
                    {projects.length === 0 ? (
                      <Empty className="min-h-24 border px-3 py-4">
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <FolderPlus aria-hidden="true" />
                          </EmptyMedia>
                          <EmptyTitle>添加项目以开始</EmptyTitle>
                        </EmptyHeader>
                        <EmptyContent>
                          <div className="flex flex-wrap justify-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => void addFolder()}
                            >
                              <FolderPlus data-icon="inline-start" aria-hidden="true" />
                              添加项目
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => void importTask()}
                            >
                              <Upload data-icon="inline-start" aria-hidden="true" />
                              导入任务
                            </Button>
                          </div>
                        </EmptyContent>
                      </Empty>
                    ) : null}
                  </nav>
                </ScrollArea>
              </SidebarGroupContent>
            </CollapsibleContent>
          </SidebarGroup>
        </Collapsible>
      </SidebarContent>
      {addProjectOpen && (
        <AddProjectDialog
          initialProfileID={runtime?.profileID}
          onClose={() => setAddProjectOpen(false)}
        />
      )}
    </>
  );
}

const SessionRow = memo(function SessionRow({
  session,
  project,
  selected,
  status,
  attention,
  recent = false,
  pullRequests,
  triageThrough,
  triageSection,
  snoozedUntil = null,
  canSettle,
  onSelect,
  onPreload,
  onSnooze,
  onSettle,
  onWake,
  onUnsettle,
}: {
  session: PalotSession;
  project?: PalotProject;
  selected: boolean;
  status: SidebarSessionStatus;
  attention: boolean;
  recent?: boolean;
  pullRequests?: PullRequestLink[];
  triageThrough?: ActivityWatermark;
  /** The task's triage shelf; rows without triage state show no quick actions. */
  triageSection?: InboxSection;
  snoozedUntil?: number | null;
  canSettle: boolean;
  onSelect(id: string): void;
  onPreload(id: string): void;
  onSnooze(sessionID: string, through: ActivityWatermark, until: number): void;
  onSettle(sessionID: string, through: ActivityWatermark): void;
  onWake?(sessionID: string, through: ActivityWatermark, snoozedUntil: number | null): void;
  onUnsettle?(sessionID: string, through: ActivityWatermark): void;
}) {
  const title = useSessionTitleEditor(session);
  const windowDrag = useSessionWindowDrag(session.id);
  const state = sidebarSessionState(
    status ?? sidebarSessionStatus(undefined, session.outcome),
    attention,
    !selected && catalogSessionIsUnread(session),
  );
  const recentAt = state === "running" ? session.updatedAt : sessionActivityAt(session);
  const snooze = useCallback(
    (until: number) => {
      if (triageThrough !== undefined) onSnooze(session.id, triageThrough, until);
    },
    [onSnooze, session.id, triageThrough],
  );
  const settle = useCallback(() => {
    if (triageThrough !== undefined) onSettle(session.id, triageThrough);
  }, [onSettle, session.id, triageThrough]);
  // One triage step per shelf, plus Snooze for tasks still in the inbox.
  let actions: ReactNode = null;
  if (!title.editing && triageThrough !== undefined && triageSection) {
    if (triageSection === "settled") {
      actions = onUnsettle ? (
        <RowAction
          label="取消归档任务"
          tooltip="取消归档"
          onClick={() => onUnsettle(session.id, triageThrough)}
        >
          <Undo2 aria-hidden="true" />
        </RowAction>
      ) : null;
    } else if (triageSection === "snoozed") {
      actions = onWake ? (
        <RowAction
          label="唤醒任务"
          tooltip="立即唤醒"
          onClick={() => onWake(session.id, triageThrough, snoozedUntil)}
        >
          <BellRing aria-hidden="true" />
        </RowAction>
      ) : null;
    } else {
      actions = (
        <>
          {canSettle ? (
            <RowAction label="归档任务" tooltip="归档" onClick={settle}>
              <Check aria-hidden="true" />
            </RowAction>
          ) : null}
          <SnoozeMenuButton onSnooze={snooze} className={INBOX_CARD_ACTION_BUTTON_CLASS} />
        </>
      );
    }
  }
  const twoActions = triageSection !== "settled" && triageSection !== "snoozed" && canSettle;

  const row = (
    <SidebarMenuSubItem
      {...sidebarFluidRowProps}
      className="w-full"
      data-palot-triage-section={triageSection}
      {...(recent ? { "data-palot-recent-row": true } : { "data-palot-task-row": true })}
    >
      {windowDrag.hint}
      {title.editing ? (
        <Input
          autoFocus
          aria-label="任务标题"
          value={title.draft}
          maxLength={1_000}
          className={cn(
            "rounded-[calc(var(--radius-sm)+2px)] border-sidebar-ring bg-sidebar-accent",
            sidebarItemVariants(),
            recent ? "pl-1.5" : "pl-8",
          )}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => title.setDraft(event.target.value)}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onBlur={() => void title.commit()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              title.cancel();
            }
          }}
        />
      ) : (
        <>
          <SidebarMenuSubButton
            render={<button {...windowDrag.handleProps} type="button" />}
            isActive={selected}
            className={cn(
              "w-full translate-x-0 cursor-grab text-left active:cursor-grabbing",
              sidebarItemVariants(),
              recent ? "pl-1.5" : "pl-8",
              // Actions reserve their width only while shown; the row never moves.
              actions &&
                (twoActions
                  ? "group-hover/menu-sub-item:pr-14 group-has-[:focus-visible]/menu-sub-item:pr-14 group-has-[[data-popup-open]]/menu-sub-item:pr-14 pointer-coarse:pr-14"
                  : "group-hover/menu-sub-item:pr-8 group-has-[:focus-visible]/menu-sub-item:pr-8 group-has-[[data-popup-open]]/menu-sub-item:pr-8 pointer-coarse:pr-8"),
            )}
            onClick={() => onSelect(session.id)}
            onMouseEnter={() => onPreload(session.id)}
            onFocus={() => onPreload(session.id)}
            onDoubleClick={(event) => {
              event.preventDefault();
              title.start();
            }}
          >
            <span className="min-w-0 flex-1 truncate">{session.title ?? "未命名任务"}</span>
            {/* Metadata yields to the actions with opacity only, so nothing visibly moves. */}
            <span
              className={cn(
                "flex shrink-0 items-center gap-2 empty:hidden",
                actions &&
                  "transition-opacity group-hover/menu-sub-item:opacity-0 group-has-[:focus-visible]/menu-sub-item:opacity-0 group-has-[[data-popup-open]]/menu-sub-item:opacity-0 pointer-coarse:opacity-0",
              )}
            >
              <PullRequestBadge links={pullRequests} />
              <SessionStatusIndicator status={state} reserveSpace={recent} />
              {recent ? (
                <time
                  className="w-6 shrink-0 text-right text-meta text-muted-foreground tabular-nums"
                  dateTime={new Date(recentAt).toISOString()}
                >
                  {formatRelativeTime(recentAt)}
                </time>
              ) : null}
            </span>
          </SidebarMenuSubButton>
          {actions ? (
            // Quiet until the row is hovered or holds keyboard focus; never removed from the
            // tab order or the accessibility tree.
            <div className="absolute inset-y-0 right-1 z-10 flex items-center opacity-0 transition-opacity group-hover/menu-sub-item:opacity-100 group-has-[:focus-visible]/menu-sub-item:opacity-100 group-has-[[data-popup-open]]/menu-sub-item:opacity-100 pointer-coarse:opacity-100">
              {actions}
            </div>
          ) : null}
        </>
      )}
    </SidebarMenuSubItem>
  );

  return (
    <SessionContextMenu
      trigger={row}
      session={session}
      project={project}
      moveDisabled={state === "running"}
      onSnooze={snooze}
      onRename={title.start}
    >
      {canSettle && triageThrough !== undefined ? (
        <ContextMenuItem onClick={settle}>归档</ContextMenuItem>
      ) : null}
    </SessionContextMenu>
  );
});

function RowAction({
  label,
  tooltip,
  onClick,
  children,
}: {
  label: string;
  tooltip: string;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={INBOX_CARD_ACTION_BUTTON_CLASS}
            aria-label={label}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function SessionStatusIndicator({
  status,
  reserveSpace = false,
}: {
  status: SidebarSessionState;
  reserveSpace?: boolean;
}) {
  if (!status || status === "interrupted")
    return reserveSpace ? <span className="size-3.5 shrink-0" aria-hidden="true" /> : null;
  const label =
    status === "attention"
      ? "任务需要关注"
      : status === "running"
        ? "任务运行中"
        : status === "failed"
          ? "任务失败"
          : "未读任务活动";
  return (
    <span
      className={
        status === "failed"
          ? "flex size-3.5 shrink-0 text-destructive"
          : status === "attention"
            ? "flex size-3.5 shrink-0 text-warning"
            : "flex size-3.5 shrink-0 text-muted-foreground"
      }
      title={label}
      aria-label={label}
    >
      {status === "unread" ? (
        <span className="m-auto size-[5px] rounded-full bg-info" aria-hidden="true" />
      ) : status === "running" ? (
        <PulseDot className="size-3.5 [&>span]:size-[5px]" aria-hidden="true" />
      ) : (
        <CircleAlert className="size-3.5" aria-hidden="true" />
      )}
    </span>
  );
}
