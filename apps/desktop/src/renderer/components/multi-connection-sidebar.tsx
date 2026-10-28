import { useEffect, useEffectEvent, useRef, useState, type ReactElement, type ReactNode } from "react";
import { useAtom, useAtomValue } from "jotai";
import { useRouterState } from "@tanstack/react-router";
import { BellRing, Check, Ellipsis, Folder, PinOff, Server, Undo2 } from "lucide-react";
import {
  SESSION_TRIAGE_BATCH_LIMIT,
  type SessionTriageCommand,
  type SidebarMode,
} from "../../shared";
import {
  inboxFiltersAtom,
  inboxShelvesAtom,
  inboxViewPreferencesAtom,
  sidebarModeAtom,
  sidebarProjectOrderAtom,
} from "../atoms/ui";
import { runtimeAtom } from "../atoms/workspace";
import { overviewProjectFilterAtom, overviewProjectSectionsAtom } from "../atoms/connections";
import { useTriageDispatcher } from "../hooks/use-auto-settle";
import { useConnectionOverview } from "../hooks/use-connection-overview";
import { usePalotNavigation } from "../hooks/use-navigation";
import { useSessionWindowDrag } from "../hooks/use-session-window-drag";
import {
  groupInboxByProject,
  groupInboxSections,
  orderInboxSection,
  orderInboxSessions,
  type InboxProjectGroup,
  type InboxSection,
  type InboxSessionView,
} from "../lib/session-inbox";
import { usePointerFreeze, useStableOrder } from "../hooks/use-stable-order";
import { projectName } from "../lib/view-models";
import { showErrorToast } from "../lib/toast-error";
import { ConnectionBadge, connectionDescription } from "./connection-badge";
import { SessionContextMenu } from "./session-context-menu";
import { ContextMenuItem } from "./ui/context-menu";
import {
  InboxToolbar,
  SectionTrigger,
  InboxCompactRowSurface,
  SnoozeMenuButton,
} from "./inbox-shared";
import { Collapsible, CollapsibleContent } from "./ui/collapsible";
import { sessionSnoozeChoices } from "../lib/session-snooze";
import { INBOX_CARD_ACTION_BUTTON_CLASS } from "./inbox-card-surface";
import { PullRequestBadge } from "./pull-requests/pull-request-badge";
import { InboxNewTaskButton, InboxProjectGroupHeader } from "./inbox-group-header";
import { announceSettledBatch, SettleIdleMenu } from "./settle-idle-menu";
import { useOwnedPullRequestLinks } from "./pull-requests/use-owned-pull-request-links";
import { cn } from "../lib/cn";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { SidebarContent } from "./ui/sidebar";
import { ScrollArea } from "./ui/scroll-area";
import {
  SidebarFluidList,
  sidebarFluidItemClass,
  sidebarFluidRowProps,
} from "./sidebar-fluid-list";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuGroup,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "./ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";

type Overview = ReturnType<typeof useConnectionOverview>;
type Connection = Overview["connections"][number];
type OwnedItem = InboxSessionView & { connection: Connection };
type Command = SessionTriageCommand extends infer C
  ? C extends SessionTriageCommand
    ? Omit<C, "profileID">
    : never
  : never;
const sections: InboxSection[] = ["pinned", "inbox", "snoozed", "settled"];
const SECTION_LABELS: Record<InboxSection, string> = {
  pinned: "置顶",
  inbox: "收件箱",
  snoozed: "已延后",
  settled: "已结算",
};
const pageSize = 40;
const rowKey = (item: OwnedItem) => JSON.stringify([item.connection.profile.id, item.session.id]);
const sectionRowKey = (item: OwnedItem) => `${item.section}:${rowKey(item)}`;

const projectGroupKey = (profileID: string, projectID: string) =>
  JSON.stringify([profileID, projectID]);
const reconcileProjectOrder = (persisted: string[], currentKeys: string[]): string[] => {
  const currentSet = new Set(currentKeys);
  const kept = persisted.filter((key) => currentSet.has(key));
  const keptSet = new Set(kept);
  const missing = currentKeys.filter((key) => !keptSet.has(key));
  return [...kept, ...missing];
};

/** The same interaction layer owns every row density, with an explicit server. */
function OwnedSessionInteractions({
  item,
  disabled,
  onRename,
  onSnooze,
  renderRow,
  children,
}: {
  item: OwnedItem;
  disabled: boolean;
  onRename(): void;
  onSnooze(until: number): void;
  renderRow(drag: ReturnType<typeof useSessionWindowDrag>): ReactElement;
  children: ReactNode;
}) {
  const owner = item.connection.phase === "ready" ? (item.connection.runtime ?? null) : null;
  const drag = useSessionWindowDrag(item.session.id, owner);
  return (
    <SessionContextMenu
      owner={owner}
      disabled={disabled}
      trigger={renderRow(drag)}
      session={item.session}
      project={item.project}
      moveDisabled={item.running || disabled}
      snoozeDisabled={disabled}
      onRename={disabled ? undefined : onRename}
      onSnooze={onSnooze}
    >
      {children}
    </SessionContextMenu>
  );
}

async function attempt(label: string, action: () => Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    showErrorToast(label, error);
  }
}

export function MultiConnectionSidebar({ mode: modeOverride }: { mode?: SidebarMode } = {}) {
  const overview = useConnectionOverview();
  const dispatchTriage = useTriageDispatcher();
  const navigation = usePalotNavigation();
  const runtime = useAtomValue(runtimeAtom);
  const storedMode = useAtomValue(sidebarModeAtom);
  const mode = modeOverride ?? storedMode;
  const [preferences, setPreferences] = useAtom(inboxViewPreferencesAtom);
  const [inboxFilters, setInboxFilters] = useAtom(inboxFiltersAtom);
  const [projectFilter, setProjectFilter] = useAtom(overviewProjectFilterAtom);
  const [projectSections, setProjectSections] = useAtom(overviewProjectSectionsAtom);
  const filters = { ...inboxFilters, projectID: projectFilter };
  const [shelves, setShelves] = useAtom(inboxShelvesAtom);
  const [limit, setLimit] = useState(pageSize);
  const [renameItem, setRenameItem] = useState<OwnedItem | null>(null);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [projectOrder, setProjectOrder] = useAtom(sidebarProjectOrderAtom);
  const dragProjectKey = useRef<string | null>(null);
  const renameConnection = overview.connections.find(
    (connection) => connection.profile.id === renameItem?.connection.profile.id,
  );
  const canRename =
    renameConnection?.runtime?.connected === true &&
    renameConnection.phase === "ready" &&
    renameConnection.triageReady;
  const selectedID = useRouterState({
    select: (state) =>
      state.matches
        .map((match) => (match.params as { sessionID?: string }).sessionID)
        .find(Boolean),
  });
  const included = overview.connections.filter((c) =>
    overview.includedProfileIDs.includes(c.profile.id),
  );
  const visible = included.filter(
    (c) => overview.visibleProfileIDs === null || overview.visibleProfileIDs.includes(c.profile.id),
  );
  const allProjectKeys = included.flatMap((connection) =>
    connection.projects.map((project) => projectGroupKey(connection.profile.id, project.id)),
  );
  const reconciledProjectOrder = reconcileProjectOrder(projectOrder, allProjectKeys);
  useEffect(() => {
    if (reconciledProjectOrder.length !== projectOrder.length) {
      setProjectOrder(reconciledProjectOrder);
    }
  }, [reconciledProjectOrder.join("\u0001")]);
  const onProjectDragStart = (key: string, event: React.DragEvent) => {
    dragProjectKey.current = key;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", key);
    const target = event.currentTarget as HTMLElement;
    requestAnimationFrame(() => target.classList.add("opacity-40"));
  };
  const onProjectDragEnd = (event: React.DragEvent) => {
    const target = event.currentTarget as HTMLElement;
    target.classList.remove("opacity-40");
    dragProjectKey.current = null;
    const container = target.closest<HTMLElement>('[data-sidebar="content"]') ?? target.parentElement;
    container
      ?.querySelectorAll<HTMLElement>("[data-drag-over]")
      .forEach((element) => element.removeAttribute("data-drag-over"));
  };
  const onProjectDragOver = (key: string, event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (dragProjectKey.current === key) return;
    const target = event.currentTarget as HTMLElement;
    const container = target.closest<HTMLElement>('[data-sidebar="content"]') ?? target.parentElement;
    container
      ?.querySelectorAll<HTMLElement>("[data-drag-over]")
      .forEach((element) => element.removeAttribute("data-drag-over"));
    target.setAttribute("data-drag-over", "true");
  };
  const onProjectDrop = (targetKey: string, event: React.DragEvent) => {
    event.preventDefault();
    const sourceKey = dragProjectKey.current;
    if (!sourceKey || sourceKey === targetKey) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const hasPosition = typeof event.clientY === "number" && rect.height > 0;
    const insertBefore = hasPosition ? event.clientY < rect.top + rect.height / 2 : true;
    setProjectOrder((previous) => {
      const reconciled = reconcileProjectOrder(previous, allProjectKeys);
      const next = reconciled.filter((key) => key !== sourceKey);
      const targetIndex = next.indexOf(targetKey);
      if (targetIndex === -1) return reconciled;
      next.splice(insertBefore ? targetIndex : targetIndex + 1, 0, sourceKey);
      return next;
    });
  };
  const sortProjectSections = <T extends { key: string }>(sections: T[]): T[] => {
    return [...sections].sort((a, b) => {
      const ai = reconciledProjectOrder.indexOf(a.key);
      const bi = reconciledProjectOrder.indexOf(b.key);
      return (
        (ai === -1 ? reconciledProjectOrder.length : ai) -
        (bi === -1 ? reconciledProjectOrder.length : bi)
      );
    });
  };
  const projects = included.flatMap((connection) =>
    connection.projects.map((project) => ({
      ...project,
      id: JSON.stringify([connection.profile.id, project.id]),
      name: `${projectName(project)} · ${connectionDescription(connection.profile)}`,
    })),
  );
  // Resolve only catalog-backed owner/project pairs. A stale or unmonitored
  // selection remains escapable through All projects / Clear filters.
  const projectOwner = included.find((connection) =>
    connection.projects.some(
      (project) => JSON.stringify([connection.profile.id, project.id]) === projectFilter,
    ),
  );
  const selectedProjectID = projectOwner?.projects.find(
    (project) => JSON.stringify([projectOwner.profile.id, project.id]) === projectFilter,
  )?.id;
  const selectedProjectProfileID = projectOwner?.profile.id;
  const selectedProjectConnectionID = projectOwner?.runtime?.connectionID;
  const projectOwnerReady =
    projectOwner?.runtime?.connected === true && projectOwner.phase === "ready";
  const hydrateProject = useEffectEvent((profileID: string, projectID: string) => {
    void attempt("无法加载项目任务", () => overview.loadProject(profileID, projectID));
  });
  useEffect(() => {
    if (
      projectOwnerReady &&
      selectedProjectProfileID &&
      selectedProjectID &&
      selectedProjectConnectionID
    ) {
      hydrateProject(selectedProjectProfileID, selectedProjectID);
    }
  }, [projectOwnerReady, selectedProjectProfileID, selectedProjectID, selectedProjectConnectionID]);
  const matches = (item: OwnedItem) => {
    if (
      filters.projectID &&
      filters.projectID !== JSON.stringify([item.connection.profile.id, item.session.projectID])
    )
      return false;
    return (
      filters.states.length === 0 ||
      filters.states.some((state) =>
        state === "unread"
          ? item.session.idleAt !== undefined &&
            (item.session.viewedAt === undefined || item.session.viewedAt < item.session.idleAt)
          : state === "attention"
            ? item.attention
            : state === "running"
              ? item.running
              : item.failed,
      )
    );
  };
  const items = visible
    .flatMap((connection) =>
      sections.flatMap((section) =>
        connection.inbox[section].map((item) => ({ ...item, connection })),
      ),
    )
    .filter(matches);
  const inProject = (connection: Connection, projectID: string) => (item: OwnedItem) =>
    item.connection.profile.id === connection.profile.id && item.session.projectID === projectID;
  const liveRows =
    mode === "inbox"
      ? sections.flatMap((section) =>
          orderInboxSection(
            section,
            items.filter((item) => item.section === section),
            preferences,
          ),
        )
      : visible.flatMap((connection) =>
          connection.projects.flatMap((project) =>
            orderInboxSessions(items.filter(inProject(connection, project.id)), preferences),
          ),
        );
  // Hold the rendered order while the pointer is over the list so rows never
  // move under the cursor; pending reorders apply when it leaves.
  const { frozen, freezeProps } = usePointerFreeze();
  const stableRows = useStableOrder(liveRows, mode === "inbox" ? sectionRowKey : rowKey, frozen);
  const sectionRows = groupInboxSections(stableRows);
  // Source control is local-only: one links query per visible local server.
  const pullRequestsByProfile = useOwnedPullRequestLinks(
    visible
      .filter((connection) => connection.profile.kind === "local")
      .map((connection) => connection.profile.id),
  );
  const run = async (item: OwnedItem, action: () => Promise<unknown>) => {
    const key = rowKey(item);
    setBusy((current) => new Set(current).add(key));
    await attempt(`无法更新 ${item.connection.profile.name} 上的任务`, action);
    setBusy((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  };
  const dispatch = (item: OwnedItem, command: Command) =>
    void run(item, () => overview.dispatch(item.connection.profile.id, command));
  const canMutate = (connection: Connection) =>
    connection.runtime?.connected === true &&
    connection.phase === "ready" &&
    connection.triageReady;
  const settleIdle = async (selected: OwnedItem[]) => {
    const byProfile = new Map<string, OwnedItem[]>();
    for (const item of selected) {
      if (!canMutate(item.connection) || busy.has(rowKey(item))) continue;
      const group = byProfile.get(item.connection.profile.id) ?? [];
      if (group.length < SESSION_TRIAGE_BATCH_LIMIT) group.push(item);
      byProfile.set(item.connection.profile.id, group);
    }
    const settled = await Promise.all(
      [...byProfile].map(async ([profileID, group]) => {
        try {
          await dispatchTriage(profileID, {
            type: "settle-many",
            at: Date.now(),
            trigger: "bulk",
            sessions: group.map((item) => ({
              sessionID: item.session.id,
              through: item.activityThrough,
            })),
          });
          return { profileID, sessionIDs: group.map((item) => item.session.id) };
        } catch (error) {
          showErrorToast(`无法结算 ${group[0]!.connection.profile.name} 上的任务`, error);
          return null;
        }
      }),
    );
    const batches = settled.filter((batch) => batch !== null);
    const count = batches.reduce((total, batch) => total + batch.sessionIDs.length, 0);
    if (count === 0) return;
    announceSettledBatch({
      count,
      undo: () =>
        Promise.all(
          batches.map((batch) =>
            dispatchTriage(batch.profileID, {
              type: "inbox-many",
              at: Date.now(),
              sessionIDs: batch.sessionIDs,
            }),
          ),
        ),
    });
  };
  const renderRow = (item: OwnedItem) => {
    const { connection, session } = item;
    const connected = connection.runtime?.connected === true && connection.phase === "ready";
    const disabled = !connected || !connection.triageReady || busy.has(rowKey(item));
    const command = (type: "pin" | "unpin" | "inbox" | "wake") =>
      dispatch(item, { type, sessionID: session.id, at: Date.now() });
    const selected = selectedID === session.id && runtime?.profileID === connection.profile.id;
    const openTask = () =>
      void attempt("无法打开任务", () =>
        navigation.openSession(session.id, { profileID: connection.profile.id }),
      );
    const preload = () => {
      if (connected) void navigation.preloadSession(session.id, connection.profile.id);
    };
    const buttonProps = {
      "aria-current": selected ? ("page" as const) : undefined,
      "aria-label": `${session.title} · ${connectionDescription(connection.profile)}`,
      title: `${session.title ?? "未命名任务"} · ${connectionDescription(connection.profile)} · ${connected ? "已连接" : "未连接"}`,
      onClick: openTask,
      onPointerEnter: preload,
      onFocus: preload,
    };
    const startRename = () => {
      setRenameItem(item);
      setTitle(session.title ?? "");
    };
    const settle = () =>
      dispatch(item, {
        type: "settle",
        sessionID: session.id,
        at: Date.now(),
        through: item.activityThrough,
      });
    const snooze = (until: number) =>
      dispatch(item, {
        type: "snooze",
        sessionID: session.id,
        at: Date.now(),
        until,
        through: item.activityThrough,
      });
    // 已延后的行不给「暂停」按钮（它的快捷操作已经是「唤醒」）。
    const snoozable = item.section !== "snoozed";
    const pullRequestLinks = pullRequestsByProfile.get(connection.profile.id)?.get(session.id);
    const badge =
      connection.profile.kind === "local" ? null : (
        <ConnectionBadge profile={connection.profile} connected={connected} compact />
      );
    const menu = (
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className={mode === "inbox" ? INBOX_CARD_ACTION_BUTTON_CLASS : undefined}
              aria-label={`${connectionDescription(connection.profile)} 上 ${session.title} 的操作`}
            />
          }
        >
          <Ellipsis aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{connectionDescription(connection.profile)}</DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuItem
            disabled={disabled}
            onClick={() => command(item.pinnedAt !== null ? "unpin" : "pin")}
          >
            {item.pinnedAt !== null ? "取消置顶" : "置顶"}
          </DropdownMenuItem>
          {item.section === "settled" ? (
            <DropdownMenuItem disabled={disabled} onClick={() => command("inbox")}>
              移回收件箱
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              disabled={disabled || !item.canSettle}
              onClick={() =>
                dispatch(item, {
                  type: "settle",
                  sessionID: session.id,
                  at: Date.now(),
                  through: item.activityThrough,
                })
              }
            >
              结算
            </DropdownMenuItem>
          )}
          {item.section === "snoozed" ? (
            <DropdownMenuItem disabled={disabled} onClick={() => command("wake")}>
              唤醒
            </DropdownMenuItem>
          ) : (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={disabled}>暂停到</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {sessionSnoozeChoices.map(([label, resolve]) => (
                  <DropdownMenuItem key={label} onClick={() => snooze(resolve(Date.now()))}>
                    {label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={disabled} onClick={startRename}>
            重命名
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={disabled || item.running || item.attention}
            onClick={() =>
              void run(item, () => overview.archive(connection.profile.id, session.id))
            }
          >
            删除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
    // Project rows lead with the one triage step that fits the task's shelf.
    const quickAction =
      item.section === "settled" ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="取消结算"
          title="取消结算"
          disabled={disabled}
          onClick={() => command("inbox")}
        >
          <Undo2 aria-hidden="true" />
        </Button>
      ) : item.section === "snoozed" ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="唤醒任务"
          title="立即唤醒"
          disabled={disabled}
          onClick={() => command("wake")}
        >
          <BellRing aria-hidden="true" />
        </Button>
      ) : item.section === "pinned" ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="取消置顶任务"
          title="取消置顶"
          disabled={disabled}
          onClick={() => command("unpin")}
        >
          <PinOff aria-hidden="true" />
        </Button>
      ) : item.canSettle ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="结算任务"
          title="结算"
          disabled={disabled}
          onClick={settle}
        >
          <Check aria-hidden="true" />
        </Button>
      ) : null;
    return (
      <OwnedSessionInteractions
        key={rowKey(item)}
        item={item}
        disabled={disabled}
        onRename={startRename}
        onSnooze={(until) =>
          dispatch(item, {
            type: "snooze",
            sessionID: session.id,
            at: Date.now(),
            until,
            through: item.activityThrough,
          })
        }
        renderRow={(windowDrag) => {
          if (mode === "inbox" && (item.section === "snoozed" || item.section === "settled"))
            return (
              <InboxCompactRowSurface
                key={rowKey(item)}
                item={item}
                selected={selected}
                hint={windowDrag.hint}
                buttonProps={{ ...windowDrag.handleProps, ...buttonProps }}
                connectionBadge={badge}
                pullRequest={<PullRequestBadge links={pullRequestLinks} />}
              >
                <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center opacity-0 transition-opacity group-hover/compact:opacity-100 group-has-[:focus-visible]/compact:opacity-100 group-has-[[data-popup-open]]/compact:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={item.section === "snoozed" ? "唤醒任务" : "取消结算"}
                    disabled={disabled}
                    onClick={() => command(item.section === "snoozed" ? "wake" : "inbox")}
                  >
                    {item.section === "snoozed" ? (
                      <BellRing aria-hidden="true" />
                    ) : (
                      <Undo2 aria-hidden="true" />
                    )}
                  </Button>
                  {menu}
                </div>
              </InboxCompactRowSurface>
            );
          return (
            <div
              {...sidebarFluidRowProps}
              key={rowKey(item)}
              className="group/owned-row relative flex min-w-0 items-center"
            >
              {windowDrag.hint}
              <button
                type="button"
                {...windowDrag.handleProps}
                {...buttonProps}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  if (!disabled) startRename();
                }}
                className={sidebarFluidItemClass(
                  cn(
                    // The actions reserve their gutter only while shown, so titles
                    // use the full row at rest. Selection is a brightened label with
                    // a hairline accent at the row's left edge, no grey block.
                    "flex min-w-0 flex-1 items-center gap-2 transition-[color,background-color,padding] relative",
                    "data-active:font-medium data-active:bg-transparent data-active:hover:bg-transparent",
                    "data-active:before:absolute data-active:before:-left-1.5 data-active:before:inset-y-1 data-active:before:w-0.5 data-active:before:rounded-full data-active:before:bg-info",
                    quickAction
                      ? snoozable
                        ? "group-hover/owned-row:pr-24 group-has-[:focus-visible]/owned-row:pr-24 group-has-[[data-popup-open]]/owned-row:pr-24"
                        : "group-hover/owned-row:pr-14 group-has-[:focus-visible]/owned-row:pr-14 group-has-[[data-popup-open]]/owned-row:pr-14"
                      : "group-hover/owned-row:pr-8 group-has-[:focus-visible]/owned-row:pr-8 group-has-[[data-popup-open]]/owned-row:pr-8",
                    connected && "cursor-grab active:cursor-grabbing",
                  ),
                )}
                data-active={selected || undefined}
              >
                <span className="min-w-0 flex-1 truncate text-left">
                  {session.title ?? "未命名任务"}
                </span>
                {item.attention || item.failed || item.running ? (
                  <span
                    className="size-1 shrink-0 opacity-80 rounded-full bg-info"
                    role="img"
                    aria-label={
                      item.attention ? "需要关注" : item.running ? "工作中" : "已失败"
                    }
                  />
                ) : null}
                <PullRequestBadge links={pullRequestLinks} />
              </button>
              {/* Quiet until the row is hovered or holds keyboard focus; never removed
                  from the tab order. */}
              <div className="absolute top-1/2 right-0.5 flex -translate-y-1/2 items-center opacity-0 transition-opacity group-hover/owned-row:opacity-100 group-has-[:focus-visible]/owned-row:opacity-100 group-has-[[data-popup-open]]/owned-row:opacity-100">
                {quickAction}
                {snoozable ? (
                  <SnoozeMenuButton disabled={disabled} onSnooze={snooze} />
                ) : null}
                {menu}
              </div>
            </div>
          );
        }}
      >
        <ContextMenuItem
          disabled={disabled}
          onClick={() => command(item.pinnedAt !== null ? "unpin" : "pin")}
        >
          {item.pinnedAt !== null ? "取消置顶" : "置顶"}
        </ContextMenuItem>
        {item.section === "settled" ? (
          <ContextMenuItem disabled={disabled} onClick={() => command("inbox")}>
            移回收件箱
          </ContextMenuItem>
        ) : (
          <ContextMenuItem disabled={disabled || !item.canSettle} onClick={settle}>
            结算
          </ContextMenuItem>
        )}
        {item.section === "snoozed" ? (
          <ContextMenuItem disabled={disabled} onClick={() => command("wake")}>
            唤醒
          </ContextMenuItem>
        ) : null}
      </OwnedSessionInteractions>
    );
  };
  let remaining = limit;
  const boundedRows = (list: OwnedItem[]) => {
    const rows = list.slice(0, remaining);
    remaining -= rows.length;
    return rows.map(renderRow);
  };
  const boundedInboxGroups = (list: OwnedItem[]) => {
    const chunks: Array<{
      group: InboxProjectGroup<OwnedItem>;
      badge: ReactNode;
      newTaskButton: ReactNode;
      rows: ReactElement[];
    }> = [];
    for (const group of groupInboxByProject(list, (row) => row.connection.profile.id)) {
      const take = group.items.slice(0, remaining);
      remaining -= take.length;
      if (take.length) {
        const connection = take[0]!.connection;
        const badge =
          connection.profile.kind === "local" || !connection.runtime ? null : (
            <ConnectionBadge profile={connection.profile} connected={connection.runtime.connected === true} compact />
          );
        // 收件箱分组头也带「+ 新任务」（2026-10-24 用户要求），与任务视图分组头一致。
        const newTaskButton = (
          <InboxNewTaskButton
            label={`${connectionDescription(connection.profile)} 上 ${group.label} 的新任务`}
            disabled={!connection.runtime?.connected || connection.phase !== "ready"}
            onOpen={() => {
              const projectID =
                group.items[0]?.session.projectID ?? group.key.split("\u0000")[1];
              void attempt("无法打开新任务", () =>
                navigation.openNewTask(projectID || undefined, connection.profile.id),
              );
            }}
          />
        );
        chunks.push({ group, badge, newTaskButton, rows: take.map(renderRow) });
      }
    }
    return chunks;
  };

  return (
    <>
      <InboxToolbar
        projects={projects}
        filters={filters}
        onFiltersChange={(update) => {
          const next = typeof update === "function" ? update(filters) : update;
          setProjectFilter(next.projectID);
          setInboxFilters((current) => ({ ...current, states: next.states }));
          setLimit(pageSize);
        }}
        viewPreferences={preferences}
        onViewPreferencesChange={setPreferences}
        onShelvesChange={(update) => {
          if (mode === "inbox") {
            setShelves(update);
            return;
          }
          // The toolbar's expand/collapse-all commands apply to the displayed mode.
          const next = typeof update === "function" ? update(shelves) : update;
          setProjectSections((current) => ({
            ...current,
            ...Object.fromEntries(
              visible.flatMap((connection) =>
                connection.projects.map((project) => [
                  JSON.stringify([connection.profile.id, project.id]),
                  next.inbox,
                ]),
              ),
            ),
          }));
        }}
        runtime={runtime}
        additionalFilterCount={Number(overview.visibleProfileIDs !== null)}
        onClearFilters={() => overview.setVisibleProfileIDs(null)}
        pagination={{
          hasNextPage: visible.some((c) => c.hasMore),
          isFetchingNextPage: visible.some((c) => c.loadingMore),
          loadMore: async () => {
            await Promise.all(
              visible
                .filter((c) => c.hasMore && c.runtime?.connected && c.phase === "ready")
                .map((c) =>
                  attempt(`无法从 ${c.profile.name} 加载任务`, () =>
                    overview.loadMore(c.profile.id),
                  ),
                ),
            );
          },
        }}
        filterItems={
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="min-h-9">
              <Server aria-hidden="true" />
              <span>服务器</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-w-sm">
              <DropdownMenuItem onClick={() => overview.setVisibleProfileIDs(null)}>
                全部服务器
              </DropdownMenuItem>
              {included.map((c) => (
                <DropdownMenuCheckboxItem
                  key={c.profile.id}
                  closeOnClick={false}
                  checked={
                    overview.visibleProfileIDs === null ||
                    overview.visibleProfileIDs.includes(c.profile.id)
                  }
                  onCheckedChange={(checked) =>
                    overview.setVisibleProfileIDs(
                      checked
                        ? [
                            ...new Set([
                              ...(overview.visibleProfileIDs ?? overview.includedProfileIDs),
                              c.profile.id,
                            ]),
                          ]
                        : (overview.visibleProfileIDs ?? overview.includedProfileIDs).filter(
                            (id) => id !== c.profile.id,
                          ),
                    )
                  }
                >
                  {connectionDescription(c.profile)}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        }
        optionItems={
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>已启用的服务器</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-w-sm">
                {overview.connections.map((c) => (
                  <DropdownMenuCheckboxItem
                    key={c.profile.id}
                    closeOnClick={false}
                    checked={overview.includedProfileIDs.includes(c.profile.id)}
                    onCheckedChange={(checked) =>
                      overview.setIncludedProfileIDs(
                        checked
                          ? [...overview.includedProfileIDs, c.profile.id]
                          : overview.includedProfileIDs.filter((id) => id !== c.profile.id),
                      )
                    }
                  >
                    启用 {connectionDescription(c.profile)}
                  </DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSeparator />
                {included.map((c) => (
                  <DropdownMenuItem
                    key={c.profile.id}
                    disabled={c.phase === "loading"}
                    onClick={() =>
                      void attempt("无法刷新连接", () =>
                        c.runtime?.connected
                          ? overview.refresh(c.profile.id)
                          : overview.connect(c.profile.id),
                      )
                    }
                  >
                    {c.runtime?.connected ? "刷新" : "重试"} {connectionDescription(c.profile)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        }
      />
      <SidebarContent className="min-h-0 overflow-hidden" {...freezeProps}>
        <ScrollArea className="h-full min-h-0">
          <div className="space-y-1 px-2 pt-0.5 pb-2">
            {visible.map((c) =>
              c.phase === "ready" && c.runtime?.connected && c.attentionState !== "ready" ? (
                <div
                  key={c.profile.id}
                  className="rounded-md px-2 py-1.5 text-meta text-muted-foreground"
                  role="status"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="min-w-0 flex-1 truncate"
                      title={connectionDescription(c.profile)}
                    >
                      {c.profile.name}
                    </span>
                    <ConnectionBadge
                      profile={c.profile}
                      connected={Boolean(c.runtime?.connected)}
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <span>
                      {c.attentionState === "syncing"
                        ? "正在同步请求…"
                        : "请求状态不可用"}
                    </span>
                  </div>
                </div>
              ) : null,
            )}
            {visible.length === 0 ? (
              <p className="px-2 text-meta text-muted-foreground">
                没有可见服务器。请在筛选任务中选择服务器。
              </p>
            ) : null}
            {mode === "inbox"
              ? sections.map((section) => {
                  if (
                    (section === "snoozed" && !preferences.showSnoozed) ||
                    (section === "settled" && !preferences.showSettled)
                  )
                    return null;
                  const rows = sectionRows[section];
                  if (!rows.length && (section === "pinned" || section === "snoozed")) return null;
                  return (
                    <Collapsible
                      key={section}
                      className="border-t border-sidebar-border/40 pt-2.5 first:border-0 first:pt-0 [&:not(:first-child)]:mt-3"
                      open={shelves[section]}
                      onOpenChange={(open) => setShelves((s) => ({ ...s, [section]: open }))}
                    >
                      <SectionTrigger
                        title={SECTION_LABELS[section]}
                        count={rows.length}
                        open={shelves[section]}
                        action={
                          section === "inbox" ? (
                            <SettleIdleMenu
                              items={rows}
                              disabled={!rows.some((item) => canMutate(item.connection))}
                              onSettle={(selected) => void settleIdle(selected)}
                            />
                          ) : undefined
                        }
                      />
                      <CollapsibleContent>
                        {shelves[section] ? (
                          rows.length ? (
                            <SidebarFluidList
                              className={
                                section === "pinned" || section === "inbox"
                                  ? "space-y-0.5"
                                  : "space-y-px pb-2"
                              }
                            >
                              {sortProjectSections(
                                boundedInboxGroups(rows).map(({ group, badge, newTaskButton, rows: elements }) => {
                                  const [profileID, projectID] = group.key.split("\u0000");
                                  const key =
                                    profileID && projectID
                                      ? projectGroupKey(profileID, projectID)
                                      : group.key;
                                  return { key, group, badge, newTaskButton, elements };
                                }),
                              ).map(({ key, group, badge, newTaskButton, elements }) => (
                                <div
                                  key={group.key}
                                  draggable
                                  aria-label={`拖动排序：${group.label}`}
                                  onDragStart={(event) => onProjectDragStart(key, event)}
                                  onDragEnd={onProjectDragEnd}
                                  onDragOver={(event) => onProjectDragOver(key, event)}
                                  onDrop={(event) => onProjectDrop(key, event)}
                                >
                                  <InboxProjectGroupHeader
                                    label={group.label}
                                    count={group.items.length}
                                    badge={badge}
                                    action={newTaskButton}
                                  />
                                  <div
                                    className={
                                      section === "pinned" || section === "inbox"
                                        ? "space-y-0.5 pl-6 pt-1"
                                        : "space-y-px pb-2 pl-6 pt-1"
                                    }
                                  >
                                    {elements}
                                  </div>
                                </div>
                              ))}
                            </SidebarFluidList>
                          ) : section === "inbox" ? (
                            <div className="px-2.5 py-4 text-xs text-muted-foreground">
                              {visible.some(
                                (c) => !c.runtime?.connected || c.attentionState === "error",
                              )
                                ? "请求状态不可用"
                                : visible.some((c) => c.attentionState !== "ready")
                                  ? "正在检查请求…"
                                  : visible.some((c) => c.hasMore)
                                    ? "已加载的任务不在收件箱中"
                                    : "收件箱已清空"}
                            </div>
                          ) : null
                        ) : null}
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })
              : sortProjectSections(
                  visible.flatMap((connection) =>
                    connection.projects
                      .filter((project) => {
                        const rows = stableRows.filter(inProject(connection, project.id));
                        return rows.length > 0;
                      })
                      .map((project) => {
                        const key = projectGroupKey(connection.profile.id, project.id);
                        const rows = stableRows.filter(inProject(connection, project.id));
                        return { key, connection, project, rows };
                      }),
                  ),
                ).map(({ key, connection, project, rows }) => {
                    const open = projectSections[key] ?? true;
                    return (
                      <div
                        key={key}
                        draggable
                        aria-label={`拖动排序：${projectName(project)}`}
                        onDragStart={(event) => onProjectDragStart(key, event)}
                        onDragEnd={onProjectDragEnd}
                        onDragOver={(event) => onProjectDragOver(key, event)}
                        onDrop={(event) => onProjectDrop(key, event)}
                      >
                      <Collapsible
                        data-project-section
                        data-profile-id={connection.profile.id}
                        data-project-id={project.id}
                        className="border-t border-sidebar-border/40 pt-2.5 first:border-0 first:pt-0 [&:not(:first-child)]:mt-3"
                        open={open}
                        onOpenChange={(value) =>
                          setProjectSections((current) => ({ ...current, [key]: value }))
                        }
                        aria-label={`${projectName(project)} · ${connectionDescription(connection.profile)}`}
                      >
                        <SectionTrigger
                          title={projectName(project)}
                          count={rows.length}
                          open={open}
                          hideCount
                          className="text-base font-semibold text-sidebar-foreground"
                          icon={
                            <Folder
                              aria-hidden="true"
                              className="size-4 shrink-0 text-sidebar-foreground/60"
                            />
                          }
                          label={`${projectName(project)} ${rows.length} · ${connectionDescription(connection.profile)}`}
                          badge={
                            connection.profile.kind !== "local" ? (
                              <ConnectionBadge
                                profile={connection.profile}
                                connected={connection.runtime?.connected === true}
                                compact
                              />
                            ) : null
                          }
                          action={
                            <InboxNewTaskButton
                              label={`${connectionDescription(connection.profile)} 上 ${projectName(project)} 的新任务`}
                              disabled={
                                !connection.runtime?.connected || connection.phase !== "ready"
                              }
                              onOpen={() =>
                                void attempt("无法打开新任务", () =>
                                  navigation.openNewTask(project.id, connection.profile.id),
                                )
                              }
                            />
                          }
                        />
                        <CollapsibleContent>
                          {open ? (
                            <SidebarFluidList className="pl-6 pt-1">{boundedRows(rows)}</SidebarFluidList>
                          ) : null}
                        </CollapsibleContent>
                      </Collapsible>
                      </div>
                    );
                  })
                }
            {items.length > limit ? (
              <Button variant="ghost" size="sm" onClick={() => setLimit((n) => n + pageSize)}>
                显示更多任务
              </Button>
            ) : null}
          </div>
        </ScrollArea>
      </SidebarContent>
      <Dialog
        open={renameItem !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setRenameItem(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名任务</DialogTitle>
            <DialogDescription>
              {renameItem ? connectionDescription(renameItem.connection.profile) : ""}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!renameItem || !title.trim() || !canRename) return;
              setSaving(true);
              void (async () => {
                try {
                  await overview.rename(
                    renameItem.connection.profile.id,
                    renameItem.session.id,
                    title.trim(),
                  );
                  setRenameItem(null);
                } catch (error) {
                  showErrorToast("无法重命名任务", error);
                } finally {
                  setSaving(false);
                }
              })();
            }}
          >
            <Input
              aria-label="任务标题"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={saving}
            />
            <DialogFooter>
              <Button type="submit" disabled={saving || !title.trim() || !canRename}>
                保存
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
