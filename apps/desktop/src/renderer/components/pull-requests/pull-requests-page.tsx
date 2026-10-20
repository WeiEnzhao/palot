import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { CircleAlert, GitPullRequest, LoaderCircle, RefreshCw } from "lucide-react";
import { useAtom } from "jotai";
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  pullRequestKey,
  type PullRequestLink,
  type PullRequestSearchPage,
  type PullRequestSnapshot,
} from "../../../shared/source-control-contract";
import { useSessionCatalog } from "../../hooks/use-session-catalog";
import {
  sourceControlKeys,
  usePullRequestLinks,
  useSourceControlStatus,
} from "../../hooks/use-source-control";
import { cn } from "../../lib/cn";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { PullRequestDetailPane } from "./pull-request-detail";
import { PullRequestFilterMenu } from "./pull-request-filters";
import { PullRequestList, useShiftHeld } from "./pull-request-list";
import { PULL_REQUEST_LIST_WIDTH, pullRequestListWidthAtom } from "./pull-request-preferences";
import { formatRetryTime, sourceControlErrorMessage } from "./pull-request-presentation";
import {
  formatPullRequestParam,
  parsePullRequestParam,
  validatePullRequestsSearch,
} from "./pull-request-ref";

const UNSUPPORTED_FALLBACK = "拉取请求关联任务仅在此计算机上可用。";
// Narrow-container variants stay literal so Tailwind generates them: under 44rem the
// panes stack (list alone, or the selected detail alone).

/**
 * GitHub review screen: lists on the left, the selected pull request on the right. The
 * selection lives in the `pr` search param so tasks can deep-link into it. Under a narrow
 * container the panes stack and the detail gets a back button.
 */
export function PullRequestsPage() {
  const search = useRouterState({
    select: (state) => validatePullRequestsSearch(state.location.search as Record<string, unknown>),
  });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const status = useSourceControlStatus();
  const links = usePullRequestLinks();
  const sessions = useSessionCatalog();
  const shiftHeld = useShiftHeld();
  const [savedListWidth, setSavedListWidth] = useAtom(pullRequestListWidthAtom);
  // Follows the pointer while dragging; saved once the drag ends.
  const [draggedListWidth, setDraggedListWidth] = useState<number | null>(null);
  const listWidth = draggedListWidth ?? savedListWidth;
  const selected = useMemo(() => parsePullRequestParam(search.pr), [search.pr]);
  const github = status.data?.github;
  const authenticated = github?.authenticated === true;
  const linkUnsupported = status.error
    ? sourceControlErrorMessage(status.error)
    : status.data && !status.data.supported
      ? (status.data.unsupportedReason ?? UNSUPPORTED_FALLBACK)
      : null;
  const pausedUntil =
    github?.pausedUntil && github.pausedUntil > Date.now() ? github.pausedUntil : null;
  const authRejected = github?.error?.code === "github-auth-failed";

  const linksByKey = useMemo(() => {
    const grouped = new Map<string, PullRequestLink[]>();
    for (const link of links.data ?? [])
      grouped.set(link.key, [...(grouped.get(link.key) ?? []), link]);
    return grouped;
  }, [links.data]);

  const select = useCallback(
    (pullRequest: PullRequestSnapshot | null) =>
      void navigate({
        to: "/pull-requests",
        search: (previous) => {
          const { pr: _previous, ...rest } = previous as Record<string, unknown>;
          return pullRequest ? { ...rest, pr: formatPullRequestParam(pullRequest) } : rest;
        },
        replace: true,
      }),
    [navigate],
  );
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: [...sourceControlKeys.all, "status"] });
    void queryClient.invalidateQueries({ queryKey: sourceControlKeys.searches() });
    void links.refetch();
  };
  const knownLogins = () => {
    const logins = new Set<string>();
    for (const [, data] of queryClient.getQueriesData<{ pages: PullRequestSearchPage[] }>({
      queryKey: sourceControlKeys.searches(),
    }))
      for (const page of data?.pages ?? [])
        for (const item of page.items) if (item.author) logins.add(item.author);
    return [...logins].toSorted((left, right) => left.localeCompare(right));
  };

  return (
    <main
      className="palot-main-surface @container/pull-requests relative flex size-full min-h-0 min-w-0 overflow-hidden bg-background"
      aria-label="拉取请求"
    >
      {status.isPending ? (
        <PageMessage>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
            正在检查 GitHub 登录
          </div>
        </PageMessage>
      ) : !authenticated || authRejected ? (
        <PageMessage>
          <Empty className="min-h-64 max-w-md border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <GitPullRequest aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>登录 GitHub</EmptyTitle>
              <EmptyDescription>
                在终端中运行 <code className="font-mono text-code-compact">gh auth login</code>
                或设置 <code className="font-mono text-code-compact">GH_TOKEN</code>，然后刷新。
              </EmptyDescription>
            </EmptyHeader>
            <Button type="button" variant="outline" size="sm" onClick={refresh}>
              <RefreshCw data-icon="inline-start" aria-hidden="true" />
              刷新
            </Button>
          </Empty>
        </PageMessage>
      ) : (
        <>
          <aside
            id="pull-request-lists"
            aria-label="拉取请求列表"
            style={{ "--pull-request-list-width": `${listWidth}px` } as CSSProperties}
            className={cn(
              "flex w-(--pull-request-list-width) shrink-0 flex-col",
              "@max-[44rem]/pull-requests:w-full",
              selected && "@max-[44rem]/pull-requests:hidden",
            )}
          >
            <div className="window-drag flex h-(--shell-header-height) shrink-0 items-center gap-2 border-b border-border/60 pr-3 pl-(--thread-header-leading-inset,18px)">
              <h1 className="text-compact font-semibold">拉取请求</h1>
              {github?.login ? (
                <span className="truncate text-meta text-muted-foreground">{github.login}</span>
              ) : null}
              <div className="ml-auto flex items-center gap-0.5">
                <PullRequestFilterMenu />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="刷新拉取请求"
                  className="window-no-drag"
                  onClick={refresh}
                >
                  <RefreshCw aria-hidden="true" />
                </Button>
              </div>
            </div>
            {pausedUntil ? (
              <p
                role="status"
                className="mx-3 mt-3 flex items-start gap-1.5 text-meta text-muted-foreground"
              >
                <CircleAlert className="mt-px size-3 shrink-0 text-warning" aria-hidden="true" />
                GitHub 速率限制已达。Palot 将在 {formatRetryTime(pausedUntil)} 后重试。
              </p>
            ) : null}
            <PullRequestList
              enabled={authenticated}
              selected={selected}
              onSelect={select}
              linksByKey={linksByKey}
              sessions={sessions}
              quickActions={shiftHeld}
            />
            {linkUnsupported ? (
              <p className="shrink-0 border-t border-border/60 px-4 py-2 text-micro text-muted-foreground">
                任务关联在此连接不可用。{linkUnsupported}
              </p>
            ) : (
              <p className="shrink-0 border-t border-border/60 px-4 py-2 text-micro text-muted-foreground">
                按住 Shift 显示快捷操作。
              </p>
            )}
          </aside>
          <ListResizeHandle
            width={listWidth}
            onDrag={setDraggedListWidth}
            onCommit={(width) => {
              setDraggedListWidth(null);
              setSavedListWidth(width);
            }}
          />
          <div
            className={cn(
              "flex min-h-0 min-w-0 flex-1 flex-col",
              !selected && "@max-[44rem]/pull-requests:hidden",
            )}
          >
            {selected ? (
              <PullRequestDetailPane
                key={pullRequestKey(selected)}
                pullRequest={selected}
                links={linksByKey.get(pullRequestKey(selected)) ?? []}
                sessions={sessions}
                linkingSupported={linkUnsupported === null}
                knownLogins={knownLogins()}
                onBack={() => select(null)}
              />
            ) : (
              <>
                <div className="window-drag h-(--shell-header-height) shrink-0 border-b border-border/60" />
                <PageMessage>
                  <Empty className="max-w-sm">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <GitPullRequest aria-hidden="true" />
                      </EmptyMedia>
                      <EmptyTitle>选择拉取请求</EmptyTitle>
                      <EmptyDescription>
                        评审更改、检查和对话，然后在不离开 Palot 的情况下合并。
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </PageMessage>
              </>
            )}
          </div>
        </>
      )}
    </main>
  );
}

const KEYBOARD_STEP = 16;

function clampListWidth(width: number): number {
  return Math.round(
    Math.min(PULL_REQUEST_LIST_WIDTH.max, Math.max(PULL_REQUEST_LIST_WIDTH.min, width)),
  );
}

/**
 * The 1px border between the list and the detail, draggable to resize the list. Arrow
 * keys step it, Home/End jump to the limits, and a double-click restores the default.
 * Hidden when the panes stack under a narrow container.
 */
function ListResizeHandle({
  width,
  onDrag,
  onCommit,
}: {
  width: number;
  onDrag(width: number): void;
  onCommit(width: number): void;
}) {
  const drag = useRef<{ pointerID: number; startX: number; startWidth: number } | null>(null);
  const [active, setActive] = useState(false);
  const end = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerID !== event.pointerId) return;
    drag.current = null;
    setActive(false);
    onCommit(clampListWidth(current.startWidth + event.clientX - current.startX));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next =
      event.key === "ArrowLeft"
        ? width - KEYBOARD_STEP
        : event.key === "ArrowRight"
          ? width + KEYBOARD_STEP
          : event.key === "Home"
            ? PULL_REQUEST_LIST_WIDTH.min
            : event.key === "End"
              ? PULL_REQUEST_LIST_WIDTH.max
              : null;
    if (next === null) return;
    event.preventDefault();
    onCommit(clampListWidth(next));
  };
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label="调整拉取请求列表大小"
      aria-controls="pull-request-lists"
      aria-orientation="vertical"
      aria-valuemin={PULL_REQUEST_LIST_WIDTH.min}
      aria-valuemax={PULL_REQUEST_LIST_WIDTH.max}
      aria-valuenow={width}
      data-active={active || undefined}
      className={cn(
        "group/list-resize relative z-10 w-px shrink-0 cursor-col-resize touch-none bg-border/60 outline-none transition-colors duration-150",
        "hover:bg-foreground/35 focus-visible:bg-foreground/35 data-active:bg-ring/55",
        // Widen the pointer target without reserving layout space.
        "before:absolute before:inset-y-0 before:-left-1 before:-right-1 before:content-['']",
        "@max-[44rem]/pull-requests:hidden",
      )}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerID: event.pointerId, startX: event.clientX, startWidth: width };
        setActive(true);
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (!current || current.pointerID !== event.pointerId) return;
        onDrag(clampListWidth(current.startWidth + event.clientX - current.startX));
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={() => onCommit(PULL_REQUEST_LIST_WIDTH.default)}
      onKeyDown={onKeyDown}
    />
  );
}

function PageMessage({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 items-center justify-center p-6">{children}</div>;
}
