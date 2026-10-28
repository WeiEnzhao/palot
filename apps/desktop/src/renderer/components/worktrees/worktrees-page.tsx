import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  AlertTriangle,
  ChevronDown,
  FolderGit2,
  LoaderCircle,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useAtom, useAtomValue } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PalotProject, PalotSession } from "../../../shared";
import { persistedAtom } from "../../atoms/persisted";
import { runtimeAtom, selectedSessionIDAtom } from "../../atoms/workspace";
import { useProjectWorktrees, useRemoveProjectCopy } from "../../hooks/use-project-worktrees";
import { useProjectCatalogState, useSessionCatalog } from "../../hooks/use-session-catalog";
import { useSessionActivityForSession } from "../../hooks/use-session-activity";
import { validateProjectSearch } from "../../lib/route-search";
import { showErrorToast } from "../../lib/toast-error";
import { orderProjects, visibleProjects } from "../../lib/view-models";
import { worktreeRemovalRequiresForce } from "../../services/opencode-worktrees";
import { getOpenCodeVcsStatus } from "../../services/opencode-vcs";
import { ProjectSelect } from "../project-select";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
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
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { toast } from "../ui/toast";

const MAX_REMEMBERED_PROFILES = 20;

/** The project last shown on the Worktrees page, per connection profile. */
export const worktreesProjectAtom = persistedAtom({
  key: "worktrees.last-project",
  initialValue: {} as Record<string, string>,
  validate: (value: unknown): value is Record<string, string> =>
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value as object).length <= MAX_REMEMBERED_PROFILES &&
    Object.entries(value as object).every(
      ([key, projectID]) =>
        key.length > 0 &&
        key.length <= 512 &&
        typeof projectID === "string" &&
        projectID.length > 0 &&
        projectID.length <= 512,
    ),
});

interface RemovalTarget {
  connectionID: string;
  projectID: string;
  directory: string;
  files: string[];
  forceRequired: boolean;
}

export function WorktreesPage() {
  const search = useRouterState({
    select: (state) => validateProjectSearch(state.location.search as Record<string, unknown>),
  });
  const onWorktreesRoute = useRouterState({
    select: (state) => state.location.pathname === "/worktrees",
  });
  const navigate = useNavigate();
  const runtime = useAtomValue(runtimeAtom);
  const catalog = useProjectCatalogState();
  const sessions = useSessionCatalog();
  const projects = useMemo(
    () => visibleProjects(orderProjects(catalog.projects, sessions)),
    [catalog.projects, sessions],
  );
  const project = projects.find((candidate) => candidate.id === search.projectID) ?? null;
  const selectedSessionID = useAtomValue(selectedSessionIDAtom);
  const [rememberedProjects, setRememberedProjects] = useAtom(worktreesProjectAtom);
  const profileID = runtime?.profileID ?? null;
  // Without a project in the route, open on the current task's project, else the last one shown.
  const defaultProjectID = useMemo(() => {
    const taskProjectID = sessions.find((session) => session.id === selectedSessionID)?.projectID;
    const remembered = profileID ? rememberedProjects[profileID] : undefined;
    return (
      [taskProjectID, remembered].find(
        (candidate) => candidate && projects.some((item) => item.id === candidate),
      ) ?? null
    );
  }, [profileID, projects, rememberedProjects, selectedSessionID, sessions]);
  const routeProfileID = search.profileID;
  useEffect(() => {
    if (!onWorktreesRoute || search.projectID || !catalog.ready || !defaultProjectID) return;
    void navigate({
      to: "/worktrees",
      search: { profileID: routeProfileID, projectID: defaultProjectID },
      replace: true,
    });
  }, [
    catalog.ready,
    defaultProjectID,
    navigate,
    onWorktreesRoute,
    routeProfileID,
    search.projectID,
  ]);
  useEffect(() => {
    if (!profileID || !project) return;
    setRememberedProjects((current) => {
      if (current[profileID] === project.id) return current;
      const others = Object.entries(current).filter(([key]) => key !== profileID);
      return {
        ...Object.fromEntries(others.slice(-(MAX_REMEMBERED_PROFILES - 1))),
        [profileID]: project.id,
      };
    });
  }, [profileID, project, setRememberedProjects]);
  const worktreesQuery = useProjectWorktrees(project);
  const removeProjectCopy = useRemoveProjectCopy(project);
  const [target, setTarget] = useState<RemovalTarget | null>(null);
  const [checkingDirectory, setCheckingDirectory] = useState<string | null>(null);
  const removalGeneration = useRef(0);
  useEffect(() => {
    removalGeneration.current += 1;
    setTarget(null);
    setCheckingDirectory(null);
    return () => {
      removalGeneration.current += 1;
    };
  }, [runtime?.connectionID, project?.id]);
  const managed = useMemo(
    () =>
      (worktreesQuery.data ?? []).filter(
        (item) => item.strategy !== null && item.directory !== project?.canonical,
      ),
    [project?.canonical, worktreesQuery.data],
  );

  const updateProject = (projectID: string | null) => {
    if (!projectID) return;
    void navigate({
      to: "/worktrees",
      search: { profileID: search.profileID, projectID },
      replace: true,
    });
  };

  const remove = useCallback(async () => {
    if (!target || !project) return;
    const generation = removalGeneration.current;
    try {
      if (target.connectionID !== runtime?.connectionID || target.projectID !== project.id)
        throw new Error(
          "服务器或项目已变更。请在移除前重新检查此工作树。",
        );
      await removeProjectCopy.mutateAsync({
        directory: target.directory,
        force: target.forceRequired,
      });
      if (generation !== removalGeneration.current) return;
      setTarget(null);
      toast.add({
        type: "success",
        title: "工作树已移除",
        description: directoryLabel(target.directory),
      });
    } catch (error) {
      if (generation !== removalGeneration.current) return;
      if (!target.forceRequired && worktreeRemovalRequiresForce(error)) {
        setTarget({ ...target, forceRequired: true });
        return;
      }
      showErrorToast("无法移除工作树", error);
    }
  }, [project, removeProjectCopy, target, runtime?.connectionID]);

  const prepareRemoval = useCallback(
    async (directory: string) => {
      if (!runtime?.connected || !project) return;
      const generation = ++removalGeneration.current;
      setCheckingDirectory(directory);
      try {
        const files = await getOpenCodeVcsStatus({ directory }, undefined, runtime.connectionID);
        if (generation !== removalGeneration.current) return;
        setTarget({
          connectionID: runtime.connectionID,
          projectID: project.id,
          directory,
          files: files.map((file) => file.file),
          forceRequired: files.length > 0,
        });
      } catch (error) {
        if (generation === removalGeneration.current)
          showErrorToast("无法检查工作树变更", error);
      } finally {
        if (generation === removalGeneration.current) setCheckingDirectory(null);
      }
    },
    [runtime, project],
  );

  return (
    <main
      className="palot-main-surface relative size-full min-h-0 min-w-0 overflow-hidden bg-background"
      aria-label="工作树"
    >
      <div className="window-drag h-(--shell-header-height) shrink-0" aria-hidden="true" />
      <div className="palot-native-scrollbar h-[calc(100%-var(--shell-header-height))] overflow-y-auto px-6 pb-16 @max-[42rem]/workspace-shell:px-3">
        <div className="mx-auto w-full max-w-4xl pt-5">
          <header className="mb-7 flex flex-wrap items-start gap-4 px-2">
            <div className="min-w-0 flex-1">
              <h1 className="text-page-title/tight font-medium tracking-[-0.035em]">工作树</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                管理一个项目的隔离 OpenCode 检出。
              </p>
            </div>
            <div className="flex items-center gap-2">
              <ProjectSelect
                projects={projects}
                value={project?.id ?? null}
                onValueChange={updateProject}
                ariaLabel="选择工作树项目"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="刷新工作树"
                disabled={!project || runtime?.connected !== true || worktreesQuery.isFetching}
                onClick={() => void worktreesQuery.refetch()}
              >
                <RefreshCw className={worktreesQuery.isFetching ? "animate-spin" : undefined} />
              </Button>
            </div>
          </header>

          {!project && catalog.ready ? <ProjectRequired projects={projects} /> : null}
          {project && runtime?.connected === false ? (
            <Alert>
              <AlertTriangle aria-hidden="true" />
              <AlertTitle>OpenCode 已断开连接</AlertTitle>
              <AlertDescription>请重新连接以检查或移除受管工作树。</AlertDescription>
            </Alert>
          ) : null}
          {project && worktreesQuery.error ? (
            <Alert variant="destructive">
              <AlertTriangle aria-hidden="true" />
              <AlertTitle>无法加载工作树</AlertTitle>
              <AlertDescription>{worktreesQuery.error.message}</AlertDescription>
            </Alert>
          ) : null}
          {project && !worktreesQuery.data && worktreesQuery.isPending ? (
            <div className="flex items-center gap-2 px-3 py-8 text-sm text-muted-foreground">
              <LoaderCircle className="animate-spin" aria-hidden="true" />
              正在加载工作树
            </div>
          ) : null}
          {project && worktreesQuery.data ? (
            <section
              className="overflow-hidden rounded-xl border bg-card/45"
              aria-label="项目工作树"
            >
              <WorktreeRow
                directory={project.canonical}
                label="主检出"
                detail="主项目目录"
              />
              {managed.map((item) => {
                const attached = sessions.filter(
                  (session) =>
                    session.projectID === project.id &&
                    session.location.directory === item.directory,
                );
                return (
                  <WorktreeRow
                    key={item.directory}
                    directory={item.directory}
                    attachedTasks={attached}
                    checking={checkingDirectory === item.directory}
                    removing={removeProjectCopy.isPending && target?.directory === item.directory}
                    onRemove={() => void prepareRemoval(item.directory)}
                  />
                );
              })}
              {managed.length === 0 ? (
                <Empty className="min-h-40 border-0 border-t rounded-none">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <FolderGit2 aria-hidden="true" />
                    </EmptyMedia>
                    <EmptyTitle>无受管工作树</EmptyTitle>
                  </EmptyHeader>
                </Empty>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>
      <RemovalDialog
        target={target}
        pending={removeProjectCopy.isPending}
        onClose={() => setTarget(null)}
        onRemove={remove}
      />
    </main>
  );
}

function ProjectRequired({ projects }: { projects: PalotProject[] }) {
  return (
    <Empty className="min-h-64 border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FolderGit2 aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{projects.length ? "选择一个项目" : "无可用项目"}</EmptyTitle>
      </EmptyHeader>
    </Empty>
  );
}

function WorktreeRow({
  directory,
  label = directoryLabel(directory),
  detail,
  attachedTasks = [],
  checking = false,
  removing = false,
  onRemove,
}: {
  directory: string;
  label?: string;
  detail?: string;
  attachedTasks?: PalotSession[];
  checking?: boolean;
  removing?: boolean;
  onRemove?: () => void;
}) {
  const removalBlocked = attachedTasks.length > 0 || checking || removing;
  return (
    <Collapsible className="min-w-0 border-b last:border-b-0">
      <div className="flex min-h-20 items-center gap-3 px-4 py-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background/70 text-muted-foreground">
          <FolderGit2 className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 break-all font-medium">{label}</span>
            {!onRemove ? <Badge variant="secondary">主要</Badge> : null}
            {onRemove && attachedTasks.length > 0 ? (
              <CollapsibleTrigger
                render={<Button variant="ghost" size="sm" />}
                aria-label={`${label} 中的任务`}
              >
                {attachedTasks.length} 个任务
                <ChevronDown
                  className="transition-transform in-data-open:rotate-180"
                  aria-hidden="true"
                />
              </CollapsibleTrigger>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={directory}>
            {detail ?? directory}
          </p>
        </div>
        {onRemove ? (
          <div className="flex shrink-0 items-center">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`移除 ${label}`}
              title={
                attachedTasks.length > 0
                  ? "请先移走这些任务再移除工作树"
                  : undefined
              }
              disabled={removalBlocked}
              onClick={onRemove}
            >
              {checking || removing ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
            </Button>
          </div>
        ) : null}
      </div>
      {attachedTasks.length > 0 ? (
        <CollapsibleContent>
          <ul className="min-w-0 space-y-1 px-4 pb-3" aria-label={`${label} 中的任务`}>
            {attachedTasks.map((session) => (
              <AttachedTaskLink key={session.id} session={session} />
            ))}
          </ul>
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  );
}

function AttachedTaskLink({ session }: { session: PalotSession }) {
  const activity = useSessionActivityForSession(session.id).data;
  const status = activity.execution.get(session.id)?.status;
  const statusLabel = status
    ? {
        inactive: "空闲",
        running: "运行中",
        succeeded: "已完成",
        failed: "已失败",
        interrupted: "已中断",
      }[status]
    : null;
  const title = session.title?.trim() || "未命名任务";
  return (
    <li className="min-w-0">
      <Link
        to="/sessions/$sessionID"
        params={{ sessionID: session.id }}
        search={{}}
        className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-2 py-2 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        title={title}
      >
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {statusLabel ? <Badge variant="secondary">{statusLabel}</Badge> : null}
        {session.archivedAt !== null ? <Badge variant="outline">已结算</Badge> : null}
      </Link>
    </li>
  );
}

function RemovalDialog({
  target,
  pending,
  onClose,
  onRemove,
}: {
  target: RemovalTarget | null;
  pending: boolean;
  onClose: () => void;
  onRemove: () => void | Promise<void>;
}) {
  return (
    <AlertDialog open={Boolean(target)} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <Trash2 aria-hidden="true" />
          </AlertDialogMedia>
          <AlertDialogTitle>
            移除 {target ? directoryLabel(target.directory) : "工作树"}？
          </AlertDialogTitle>
          <AlertDialogDescription>
            {target?.forceRequired
              ? target.files.length
                ? `这将永久丢弃 ${target.files.length} 个已变更${target.files.length === 1 ? "文件" : "文件"}并移除受管工作树。`
                : "工作树在检查后发生了变更。现在移除将永久丢弃其未提交的变更。"
              : "这将移除受管工作树。主检出不受影响。"}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {target?.files.length ? (
          <div className="max-h-36 overflow-y-auto rounded-md border border-border bg-muted/30 p-2 font-mono text-code-compact text-muted-foreground">
            {target.files.slice(0, 20).map((file) => (
              <div key={file} className="truncate" title={file}>
                {file}
              </div>
            ))}
            {target.files.length > 20 ? <div>+{target.files.length - 20} 个更多</div> : null}
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={() => void onRemove()}
          >
            {pending ? "正在移除..." : "移除工作树"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function directoryLabel(directory: string): string {
  return directory.split(/[\\/]/).filter(Boolean).at(-1) ?? directory;
}
