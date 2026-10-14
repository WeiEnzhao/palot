import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  Check,
  ClipboardCopy,
  Clock3,
  Download,
  FileUp,
  FolderGit2,
  GitFork,
  History,
  LoaderCircle,
  MoreHorizontal,
  PanelsTopLeft,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAtomValue, useStore } from "jotai";
import { useCallback, useState, type ReactElement, type ReactNode } from "react";
import type { OpenCodeRuntimeStatus, PalotProject, PalotSession } from "../../shared";
import { usePalotNavigation } from "../hooks/use-navigation";
import { showErrorToast } from "../lib/toast-error";
import { palot } from "../services/palot";
import { useSessionFork } from "../hooks/use-session-fork";
import { SessionForkHistoryDialog } from "./session-history-dialog";
import { SessionCopyDialog } from "./session-copy-dialog";
import { useCacheSession } from "../hooks/use-session-catalog";
import { runtimeAtom, selectedSessionIDAtom } from "../atoms/workspace";
import { removeSession as removeCatalogSession } from "../lib/session-catalog-query";
import { useCreateProjectCopy, useProjectWorktrees } from "../hooks/use-project-worktrees";
import { formatSnoozeMenuTime, sessionSnoozeChoices } from "../lib/session-snooze";
import {
  formatShortcut,
  useShortcutKeys,
  type KeyboardShortcutID,
} from "../lib/keyboard-shortcuts";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { toast } from "./ui/toast";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "./ui/alert-dialog";

export function SessionContextMenu({
  trigger,
  session,
  project,
  owner,
  disabled = false,
  moveDisabled = false,
  snoozeDisabled = false,
  onSnooze,
  onRename,
  children,
}: {
  trigger: ReactElement;
  session: PalotSession;
  project?: PalotProject | null;
  /** Undefined uses the active runtime; null deliberately has no owner. */
  owner?: OpenCodeRuntimeStatus | null;
  disabled?: boolean;
  moveDisabled?: boolean;
  snoozeDisabled?: boolean;
  onSnooze?: (until: number) => void | Promise<void>;
  onRename?: () => void;
  children?: ReactNode;
}) {
  const { openNewTask, openScheduled } = usePalotNavigation();
  const forkSession = useSessionFork(owner);
  const queryClient = useQueryClient();
  const activeRuntime = useAtomValue(runtimeAtom);
  const runtime = owner === undefined ? activeRuntime : owner;
  const unavailable = disabled || (owner !== undefined && !ownerAvailable(owner));
  const store = useStore();
  const selectedSessionID = useAtomValue(selectedSessionIDAtom);
  const [forking, setForking] = useState(false);
  const [forkHistoryOpen, setForkHistoryOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const transfer = useSessionTransfer(session, owner, unavailable);

  const fork = useCallback(async () => {
    if (unavailable || forking) return;
    setForking(true);
    try {
      await forkSession({ sessionID: session.id });
    } catch (error) {
      showErrorToast("无法分叉任务", error);
    } finally {
      setForking(false);
    }
  }, [forkSession, forking, session.id, unavailable]);
  const deleteSession = useCallback(async () => {
    if (unavailable || deleting) return;
    setDeleting(true);
    try {
      await palot.removeSession(session.id, runtime?.connectionID);
      removeCatalogSession(queryClient, runtime?.connectionID ?? "disconnected", session.id);
      setDeleteOpen(false);
      if (
        selectedSessionID === session.id &&
        store.get(runtimeAtom)?.connectionID === runtime?.connectionID &&
        store.get(selectedSessionIDAtom) === session.id
      )
        await openNewTask(session.projectID, runtime?.profileID);
    } catch (error) {
      showErrorToast("无法删除任务", error);
    } finally {
      setDeleting(false);
    }
  }, [
    deleting,
    openNewTask,
    queryClient,
    runtime?.connectionID,
    runtime?.profileID,
    store,
    selectedSessionID,
    session.id,
    session.projectID,
    unavailable,
  ]);
  return (
    <>
      {transfer.serverCopyDialog}
      <ContextMenu>
        <ContextMenuTrigger render={trigger} />
        <ContextMenuContent>
          {children ? (
            <>
              <ContextMenuGroup>{children}</ContextMenuGroup>
              <ContextMenuSeparator />
            </>
          ) : null}
          <ContextMenuGroup>
            <ContextMenuItem
              disabled={unavailable}
              onClick={() => void openSessionWindow(session.id, runtime?.connectionID)}
            >
              <PanelsTopLeft aria-hidden="true" />
              在新窗口中打开
            </ContextMenuItem>
            <ContextMenuItem disabled={unavailable || forking} onClick={() => void fork()}>
              {forking ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : (
                <GitFork aria-hidden="true" />
              )}
              分叉
            </ContextMenuItem>
            <ContextMenuItem disabled={unavailable} onClick={() => setForkHistoryOpen(true)}>
              从提示词分叉…
            </ContextMenuItem>
            {onRename ? (
              <ContextMenuItem disabled={unavailable} onClick={onRename}>
                重命名
              </ContextMenuItem>
            ) : null}
            <ContextMenuItem
              disabled={unavailable || runtime?.capabilities?.scheduledAutomations === false}
              title={
                runtime?.capabilities?.scheduledAutomations === false
                  ? "此连接不可用计划后续任务"
                  : undefined
              }
              onClick={() =>
                void openScheduled({
                  mode: "create",
                  sessionID: session.id,
                  profileID: runtime?.profileID,
                })
              }
            >
              <CalendarClock aria-hidden="true" />
              安排后续任务
            </ContextMenuItem>
            <SessionTransferItems transfer={transfer} />
            {onSnooze ? (
              <SessionSnoozeMenu disabled={unavailable || snoozeDisabled} onSnooze={onSnooze} />
            ) : null}
            <SessionMoveMenu
              session={session}
              project={project}
              owner={owner}
              disabled={unavailable || moveDisabled}
            />
          </ContextMenuGroup>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            disabled={unavailable || deleting}
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 aria-hidden="true" />
            删除任务
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {forkHistoryOpen ? (
        <SessionForkHistoryDialog
          session={session}
          owner={unavailable ? null : owner}
          onClose={() => setForkHistoryOpen(false)}
        />
      ) : null}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <Trash2 aria-hidden="true" />
            </AlertDialogMedia>
            <AlertDialogTitle>确定删除 {session.title ?? "此任务"}？</AlertDialogTitle>
            <AlertDialogDescription>
              这将从 OpenCode 中永久删除该任务及其所有子任务。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={unavailable || deleting}
              onClick={() => void deleteSession()}
            >
              {deleting ? "正在删除…" : "删除任务"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export interface SessionHistoryActions {
  loadingOlder: boolean;
  previousTurn(): void;
  nextTurn(): void;
  openTimeline(): void;
  forkFromPrompt(): void;
  /** Opens Find in task. */
  find?(): void;
}

/** Shortcut hint that stays out of the menu item's accessible name. */
function MenuShortcut({ id }: { id: KeyboardShortcutID }) {
  const keys = useShortcutKeys(id);
  if (keys.length === 0) return null;
  return <DropdownMenuShortcut aria-hidden="true">{formatShortcut(keys)}</DropdownMenuShortcut>;
}

async function openSessionWindow(sessionID: string, connectionID?: string): Promise<void> {
  try {
    await palot.openSessionWindow(sessionID, connectionID);
  } catch (error) {
    showErrorToast("无法在新窗口中打开任务", error);
  }
}

export function SessionExportMenu({
  session,
  historyActions,
}: {
  session: PalotSession;
  historyActions?: SessionHistoryActions;
}) {
  const connectionID = useAtomValue(runtimeAtom)?.connectionID;
  const transfer = useSessionTransfer(session);
  return (
    <>
      {transfer.serverCopyDialog}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="window-no-drag shrink-0"
              aria-label="Task actions"
            />
          }
        >
          <MoreHorizontal aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 max-w-(--available-width)">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => void openSessionWindow(session.id, connectionID)}>
              <PanelsTopLeft aria-hidden="true" />
              在新窗口中打开
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          {historyActions ? (
            <>
              <DropdownMenuGroup>
                {historyActions.find ? (
                  <DropdownMenuItem onClick={historyActions.find}>
                    <Search aria-hidden="true" />
                    Find in task
                    <MenuShortcut id="task.find" />
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  disabled={historyActions.loadingOlder}
                  onClick={historyActions.previousTurn}
                >
                  <ArrowUp aria-hidden="true" />
                  上一轮用户输入
                  <MenuShortcut id="task.turn.previous" />
                </DropdownMenuItem>
                <DropdownMenuItem onClick={historyActions.nextTurn}>
                  <ArrowDown aria-hidden="true" />
                  下一轮用户输入
                  <MenuShortcut id="task.turn.next" />
                </DropdownMenuItem>
                <DropdownMenuItem onClick={historyActions.openTimeline}>
                  <History aria-hidden="true" />
                  提示词时间线
                </DropdownMenuItem>
                <DropdownMenuItem onClick={historyActions.forkFromPrompt}>
                  <GitFork aria-hidden="true" />
                  从提示词分叉…
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuGroup>
            <SessionTransferItems transfer={transfer} dropdown />
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

function ownerAvailable(owner: OpenCodeRuntimeStatus | null): boolean {
  return Boolean(owner?.connected && owner.phase === "connected");
}

function useSessionTransfer(
  session: PalotSession,
  owner?: OpenCodeRuntimeStatus | null,
  disabled = false,
) {
  const { openSession } = usePalotNavigation();
  const activeRuntime = useAtomValue(runtimeAtom);
  const runtime = owner === undefined ? activeRuntime : owner;
  const unavailable = disabled || (owner !== undefined && !ownerAvailable(owner));
  const cacheSession = useCacheSession(runtime);
  const [transferring, setTransferring] = useState<"copy" | "export" | "import" | null>(null);
  const [serverCopy, setServerCopy] = useState<{
    session: PalotSession;
    source: OpenCodeRuntimeStatus;
  } | null>(null);
  const exportSession = useCallback(async () => {
    if (unavailable || transferring) return;
    setTransferring("export");
    try {
      const path = await palot.exportSession(session.id, session.title, runtime?.connectionID);
      if (path) toast.add({ type: "success", title: "任务已导出", description: path });
    } catch (error) {
      showErrorToast("无法导出任务", error);
    } finally {
      setTransferring(null);
    }
  }, [session.id, session.title, transferring, runtime?.connectionID, unavailable]);
  const importSession = useCallback(async () => {
    if (unavailable || transferring) return;
    setTransferring("import");
    try {
      const imported = await palot.importSession(session.location, runtime?.connectionID);
      if (!imported) return;
      cacheSession(imported);
      await openSession(imported.id, { profileID: runtime?.profileID });
    } catch (error) {
      showErrorToast("无法导入任务", error);
    } finally {
      setTransferring(null);
    }
  }, [
    cacheSession,
    openSession,
    runtime?.connectionID,
    runtime?.profileID,
    session.location,
    transferring,
    unavailable,
  ]);
  const copySession = useCallback(async () => {
    if (unavailable || transferring) return;
    setTransferring("copy");
    try {
      await palot.copySessionMarkdown(session.id, runtime?.connectionID);
      toast.add({ type: "success", title: "对话已复制为 Markdown" });
    } catch (error) {
      showErrorToast("无法复制对话", error);
    } finally {
      setTransferring(null);
    }
  }, [session.id, transferring, runtime?.connectionID, unavailable]);
  return {
    transferring,
    unavailable,
    exportSession,
    copySession,
    importSession,
    openServerCopy: () => {
      if (runtime?.connected) setServerCopy({ session, source: runtime });
    },
    serverCopyDialog: serverCopy ? (
      <SessionCopyDialog
        session={serverCopy.session}
        source={serverCopy.source}
        onClose={() => setServerCopy(null)}
      />
    ) : null,
  };
}

function SessionTransferItems({
  transfer,
  dropdown = false,
}: {
  transfer: ReturnType<typeof useSessionTransfer>;
  dropdown?: boolean;
}) {
  const { transferring, unavailable, exportSession, copySession, importSession } = transfer;
  const Item = dropdown ? DropdownMenuItem : ContextMenuItem;
  return (
    <>
      <Item disabled={unavailable || Boolean(transferring)} onClick={() => void exportSession()}>
        {transferring === "export" ? <LoaderCircle className="animate-spin" /> : <Download />}
        导出任务
      </Item>
      <Item disabled={unavailable || Boolean(transferring)} onClick={() => void copySession()}>
        {transferring === "copy" ? <LoaderCircle className="animate-spin" /> : <ClipboardCopy />}
        复制对话为 Markdown
      </Item>
      <Item disabled={unavailable || Boolean(transferring)} onClick={transfer.openServerCopy}>
        <PanelsTopLeft />
        复制任务到服务器…
      </Item>
      {!dropdown ? (
        <Item disabled={unavailable || Boolean(transferring)} onClick={() => void importSession()}>
          {transferring === "import" ? <LoaderCircle className="animate-spin" /> : <FileUp />}
          导入任务
        </Item>
      ) : null}
    </>
  );
}

function SessionSnoozeMenu({
  disabled,
  onSnooze,
}: {
  disabled: boolean;
  onSnooze: (until: number) => void | Promise<void>;
}) {
  const [displayNow] = useState(() => Date.now());
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger disabled={disabled}>
        <Clock3 aria-hidden="true" />
        暂停
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="min-w-52">
        <ContextMenuGroup>
          {sessionSnoozeChoices.map(([label, resolve]) => (
            <ContextMenuItem
              key={label}
              disabled={disabled}
              onClick={() => void onSnooze(resolve(Date.now()))}
            >
              <span>{label}</span>
              <span className="ml-auto text-muted-foreground tabular-nums">
                {formatSnoozeMenuTime(resolve(displayNow))}
              </span>
            </ContextMenuItem>
          ))}
        </ContextMenuGroup>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

function SessionMoveMenu({
  session,
  project,
  owner,
  disabled = false,
}: {
  session: PalotSession;
  project?: PalotProject | null;
  owner?: OpenCodeRuntimeStatus | null;
  disabled?: boolean;
}) {
  const activeRuntime = useAtomValue(runtimeAtom);
  const runtime = owner === undefined ? activeRuntime : owner;
  const cacheSession = useCacheSession(runtime);
  const directoriesQuery = useProjectWorktrees(project, false, owner);
  const createProjectCopy = useCreateProjectCopy(project, owner);
  const [moving, setMoving] = useState(false);
  const unavailable = disabled || moving || !project;

  const loadDirectories = useCallback(() => {
    if (unavailable || !project || directoriesQuery.isFetching) return;
    void directoriesQuery.refetch().then((result) => {
      if (result.error) showErrorToast("无法加载工作树", result.error);
    });
  }, [directoriesQuery, project, unavailable]);

  const move = useCallback(
    async (directory: string) => {
      if (unavailable || directory === session.location.directory) return;
      setMoving(true);
      try {
        const moved = await palot.moveSession(session.id, directory, runtime?.connectionID);
        if (moved) cacheSession(moved);
        toast.add({
          type: "success",
          title: "任务已移动",
          description: `Now working in ${directoryLabel(directory)}.`,
        });
      } catch (error) {
        showErrorToast("无法移动任务", error);
      } finally {
        setMoving(false);
      }
    },
    [cacheSession, runtime?.connectionID, session.id, session.location.directory, unavailable],
  );

  const createAndMove = useCallback(async () => {
    if (unavailable || !project || runtime?.capabilities?.worktreeCreate === false) return;
    setMoving(true);
    try {
      const copy = await createProjectCopy.mutateAsync(session.location.directory);
      const moved = await palot.moveSession(session.id, copy.directory, runtime?.connectionID);
      if (moved) cacheSession(moved);
      toast.add({
        type: "success",
        title: "任务已移动到新工作树",
        description: directoryLabel(copy.directory),
      });
    } catch (error) {
      showErrorToast("无法将任务移动到新工作树", error);
    } finally {
      setMoving(false);
    }
  }, [
    createProjectCopy,
    runtime?.connectionID,
    runtime?.capabilities?.worktreeCreate,
    project,
    session.id,
    session.location.directory,
    cacheSession,
    unavailable,
  ]);

  const directories = directoriesQuery.data;
  const loading = directoriesQuery.isFetching;
  const targets = directories?.filter(
    (item, index, items) =>
      item.directory !== session.location.directory &&
      items.findIndex((candidate) => candidate.directory === item.directory) === index,
  );
  const mainTarget = targets?.find((item) => item.directory === project?.canonical);
  const worktreeTargets = targets?.filter((item) => item !== mainTarget);

  const renderTarget = (item: NonNullable<typeof targets>[number]) => (
    <ContextMenuItem
      key={item.directory}
      disabled={unavailable}
      title={item.directory}
      onClick={() => void move(item.directory)}
    >
      <FolderGit2 aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">
        {item.directory === project?.canonical ? "主检出" : directoryLabel(item.directory)}
      </span>
    </ContextMenuItem>
  );

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger
        disabled={unavailable}
        onMouseEnter={() => void loadDirectories()}
        onFocus={() => void loadDirectories()}
      >
        <FolderGit2 aria-hidden="true" />
        移到工作树
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="min-w-52">
        <ContextMenuGroup>
          <ContextMenuItem
            disabled={unavailable || runtime?.capabilities?.worktreeCreate === false}
            title={
              runtime?.capabilities?.worktreeCreate === false
                ? "此连接不可用创建工作树"
                : undefined
            }
            onClick={() => void createAndMove()}
          >
            {moving ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            ) : (
              <Plus aria-hidden="true" />
            )}
            新建工作树
          </ContextMenuItem>
          {mainTarget ? renderTarget(mainTarget) : null}
        </ContextMenuGroup>
        {loading || !directories || !targets?.length || worktreeTargets?.length ? (
          <ContextMenuSeparator />
        ) : null}
        <ContextMenuGroup>
          {loading && !directories ? (
            <ContextMenuItem disabled>
              <LoaderCircle className="animate-spin" aria-hidden="true" />
              正在加载工作树
            </ContextMenuItem>
          ) : null}
          {!loading && directories && !targets?.length ? (
            <ContextMenuItem disabled>
              <Check aria-hidden="true" />
              当前工作树
            </ContextMenuItem>
          ) : null}
          {worktreeTargets?.map(renderTarget)}
        </ContextMenuGroup>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

function directoryLabel(directory: string): string {
  return directory.split(/[\\/]/).filter(Boolean).at(-1) ?? directory;
}
