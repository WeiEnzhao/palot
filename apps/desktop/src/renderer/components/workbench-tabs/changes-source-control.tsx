import type { FileDiffInfo, ModelRef } from "@opencode/client";
import { useMutation } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { ArrowDown, ArrowUp, ChevronRight, GitBranch, Sparkles } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type {
  GitCommitResult,
  GitPushResult,
  GitWorkingTreeStatus,
} from "../../../shared/source-control-contract";
import type { PalotSession } from "../../../shared";
import { runtimeAtom } from "../../atoms/workspace";
import { useSessionCatalogSelector } from "../../hooks/use-session-catalog";
import {
  SourceControlError,
  useGitCommit,
  useGitPush,
  useGitStage,
  useGitStatus,
  useGitUnstage,
  useSourceControlStatus,
} from "../../hooks/use-source-control";
import {
  cleanCommitMessage,
  commitMessagePrompt,
  gitFileEntries,
  stageablePaths,
  stagedPaths,
  type GitFileEntry,
} from "../../lib/git-staging";
import { shortcutPlatform } from "../../lib/keyboard-shortcuts";
import { generateOpenCodeText } from "../../services/opencode-generate";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import { Spinner } from "../ui/spinner";
import { Textarea } from "../ui/textarea";

type SourceControlAction = "stage" | "unstage" | "commit" | "push" | "generate";

type Feedback =
  | { kind: "committed"; result: GitCommitResult }
  | { kind: "pushed"; result: GitPushResult }
  | { kind: "error"; action: SourceControlAction; error: unknown };

export interface ChangesSourceControlInput {
  profileID: string;
  directory: string;
  /** Working mode of an active tab whose project has a repository. */
  enabled: boolean;
  /** OpenCode's working-tree diffs shown in the tab. */
  diffs: readonly FileDiffInfo[];
  /** Changes when the diff list refreshes, so Git status follows the same events. */
  diffsUpdatedAt: number;
  /** The task whose model drafts commit messages. */
  sessionID?: string;
}

function sameModel(left: ModelRef | null, right: ModelRef | null): boolean {
  return (
    left === right ||
    (left?.id === right?.id &&
      left?.providerID === right?.providerID &&
      left?.variant === right?.variant)
  );
}

/**
 * Commit and push state for the Changes tab. It lives at the tab's top level so the
 * draft message and the last result survive the tab switching between its list and
 * its empty state (a commit that leaves no changes still offers Push).
 */
export function useChangesSourceControl(input: ChangesSourceControlInput) {
  const { profileID, directory, enabled } = input;
  const status = useSourceControlStatus(profileID);
  const supported = status.data?.supported === true;
  const git = useGitStatus(directory, { profileID, enabled: enabled && supported });
  const unsupported =
    status.data?.supported === false ||
    (git.error instanceof SourceControlError && git.error.code === "unsupported-connection");
  const availability: "hidden" | "unsupported" | "ready" = !enabled
    ? "hidden"
    : unsupported
      ? "unsupported"
      : supported && git.data
        ? "ready"
        : "hidden";

  // OpenCode refreshes its diffs on file events; keep Git's staged view in step.
  const refetchGit = git.refetch;
  const seenDiffs = useRef(input.diffsUpdatedAt);
  useEffect(() => {
    if (seenDiffs.current === input.diffsUpdatedAt) return;
    seenDiffs.current = input.diffsUpdatedAt;
    if (enabled && supported) void refetchGit();
  }, [enabled, input.diffsUpdatedAt, refetchGit, supported]);

  const diffPaths = useMemo(() => input.diffs.map((file) => file.file), [input.diffs]);
  const tree: GitWorkingTreeStatus | undefined = git.data;
  const entries = useMemo(
    () => (tree ? gitFileEntries(tree, directory, diffPaths) : new Map<string, GitFileEntry>()),
    [diffPaths, directory, tree],
  );

  const stage = useGitStage();
  const unstage = useGitUnstage();
  const commit = useGitCommit();
  const push = useGitPush();
  const runtime = useAtomValue(runtimeAtom);
  const selectModel = useCallback(
    (sessions: PalotSession[]) =>
      input.sessionID
        ? (sessions.find((session) => session.id === input.sessionID)?.model ?? null)
        : null,
    [input.sessionID],
  );
  const model = useSessionCatalogSelector(selectModel, sameModel);
  const generate = useMutation({
    mutationFn: (prompt: string) =>
      generateOpenCodeText({ prompt, model }, runtime?.connectionID ?? undefined),
  });

  const [message, setMessage] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const fail = (action: SourceControlAction) => (error: unknown) =>
    setFeedback({ kind: "error", action, error });

  const pathsBusy = stage.isPending || unstage.isPending;
  const stagedCount = tree ? stagedPaths(tree).length : 0;

  const setStaged = (paths: string[], staged: boolean) => {
    if (paths.length === 0) return;
    setFeedback(null);
    const mutation = staged ? stage : unstage;
    mutation.mutate(
      { profileID, directory, paths },
      { onError: fail(staged ? "stage" : "unstage") },
    );
  };

  const toggle = (diffPath: string) => {
    const entry = entries.get(diffPath);
    if (entry) setStaged([entry.path], entry.state !== "staged");
  };

  const canCommit =
    stagedCount > 0 && message.trim() !== "" && !commit.isPending && !generate.isPending;
  const commitNow = () => {
    if (!canCommit) return;
    setFeedback(null);
    commit.mutate(
      { profileID, directory, message: message.trim() },
      {
        onSuccess: (result) => {
          setMessage("");
          setFeedback({ kind: "committed", result });
        },
        onError: fail("commit"),
      },
    );
  };

  const pushNow = () => {
    if (push.isPending) return;
    setFeedback(null);
    push.mutate(
      { profileID, directory },
      {
        onSuccess: (result) => setFeedback({ kind: "pushed", result }),
        onError: fail("push"),
      },
    );
  };

  const generateMessage = () => {
    const staged = input.diffs.filter((file) => {
      const state = entries.get(file.file)?.state;
      return state === "staged" || state === "partial";
    });
    if (staged.length === 0 || generate.isPending) return;
    setFeedback(null);
    generate.mutate(commitMessagePrompt(staged), {
      onSuccess: (text) => {
        const cleaned = cleanCommitMessage(text);
        if (cleaned) setMessage(cleaned);
        else setFeedback({ kind: "error", action: "generate", error: new Error("No message") });
      },
      onError: fail("generate"),
    });
  };

  return {
    availability,
    tree,
    entries,
    stagedCount,
    pathsBusy,
    message,
    setMessage,
    feedback,
    canCommit,
    committing: commit.isPending,
    pushing: push.isPending,
    generating: generate.isPending,
    toggle,
    stageAll: () => tree && setStaged(stageablePaths(tree), true),
    unstageAll: () => tree && setStaged(stagedPaths(tree), false),
    commit: commitNow,
    push: pushNow,
    generateMessage,
    refetch: refetchGit,
  };
}

export type ChangesSourceControl = ReturnType<typeof useChangesSourceControl>;

/** Stage checkbox for a changed-file header. Always rendered at the same size. */
export function StageCheckbox({
  controller,
  path,
}: {
  controller: ChangesSourceControl;
  path: string;
}) {
  if (controller.availability !== "ready") return null;
  const entry = controller.entries.get(path);
  if (!entry) return <span className="size-4 shrink-0" aria-hidden="true" />;
  const staged = entry.state === "staged";
  const label = `${staged ? "取消暂存" : "暂存"} ${path}`;
  return (
    <Checkbox
      aria-label={label}
      title={
        entry.conflicted
          ? "暂存前请先解决冲突"
          : entry.state === "partial"
            ? "部分已暂存"
            : staged
              ? "已暂存"
              : "未暂存"
      }
      checked={staged}
      indeterminate={entry.state === "partial"}
      disabled={controller.pathsBusy || entry.conflicted}
      className="data-indeterminate:border-primary data-indeterminate:text-primary"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onCheckedChange={() => controller.toggle(path)}
    />
  );
}

export function ChangesSourceControlPanel({ controller }: { controller: ChangesSourceControl }) {
  if (controller.availability === "unsupported") {
    return (
      <p className="shrink-0 border-t border-border bg-background px-3 py-1.5 text-meta text-muted-foreground">
        提交和推送仅适用于本地连接。
      </p>
    );
  }
  if (controller.availability !== "ready" || !controller.tree) return null;
  const { branch } = controller.tree;
  const total = controller.tree.files.length;
  const unstagedCount = stageablePaths(controller.tree).length;
  const canPush = Boolean(branch.name) && (!branch.upstream || branch.ahead > 0);
  const pushLabel = branch.upstream ? "推送" : "发布分支";
  const onMessageKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.key !== "Enter") return;
    const mod = shortcutPlatform() === "mac" ? event.metaKey : event.ctrlKey;
    if (!mod || event.shiftKey || event.altKey) return;
    event.preventDefault();
    controller.commit();
  };

  return (
    <section
      aria-label="提交更改"
      className="flex shrink-0 flex-col gap-1.5 border-t border-border bg-background px-2 py-1.5"
    >
      <div className="flex h-7 min-w-0 items-center gap-2 text-meta">
        <GitBranch className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 truncate font-medium" title={branch.name ?? undefined}>
          {branch.name ?? "分离的 HEAD"}
        </span>
        {branch.ahead > 0 || branch.behind > 0 ? (
          <span
            className="flex shrink-0 items-center gap-1 font-mono text-diff text-muted-foreground tabular-nums"
            aria-label={`${branch.ahead} 领先，${branch.behind} 落后 ${branch.upstream ?? "上游"}`}
          >
            {branch.ahead > 0 ? (
              <span className="flex items-center">
                <ArrowUp className="size-3" aria-hidden="true" />
                {branch.ahead}
              </span>
            ) : null}
            {branch.behind > 0 ? (
              <span className="flex items-center">
                <ArrowDown className="size-3" aria-hidden="true" />
                {branch.behind}
              </span>
            ) : null}
          </span>
        ) : null}
        <span className="hidden shrink-0 text-muted-foreground tabular-nums @min-[28rem]/workbench:inline">
          已暂存 {controller.stagedCount} / {total}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {unstagedCount > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={controller.pathsBusy}
              onClick={controller.stageAll}
            >
              全部暂存
            </Button>
          ) : null}
          {controller.stagedCount > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={controller.pathsBusy}
              onClick={controller.unstageAll}
            >
              全部取消暂存
            </Button>
          ) : null}
          {canPush ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={controller.pushing}
              aria-busy={controller.pushing || undefined}
              onClick={controller.push}
            >
              {controller.pushing ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
              {pushLabel}
            </Button>
          ) : null}
        </div>
      </div>
      <Textarea
        value={controller.message}
        onChange={(event) => controller.setMessage(event.target.value)}
        onKeyDown={onMessageKeyDown}
        placeholder="提交消息"
        aria-label="提交消息"
        aria-keyshortcuts={shortcutPlatform() === "mac" ? "Meta+Enter" : "Control+Enter"}
        rows={2}
        spellCheck
        className="max-h-40 min-h-14 text-compact"
      />
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={controller.stagedCount === 0 || controller.generating}
          aria-busy={controller.generating || undefined}
          onClick={controller.generateMessage}
        >
          {controller.generating ? (
            <Spinner data-icon="inline-start" aria-hidden="true" />
          ) : (
            <Sparkles data-icon="inline-start" aria-hidden="true" />
          )}
          {controller.generating ? "正在生成…" : "生成消息"}
        </Button>
        <Button
          type="button"
          size="xs"
          className="ml-auto"
          disabled={!controller.canCommit}
          aria-busy={controller.committing || undefined}
          onClick={controller.commit}
        >
          {controller.committing ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
          提交
        </Button>
      </div>
      <SourceControlFeedback controller={controller} canPush={canPush} pushLabel={pushLabel} />
    </section>
  );
}

function SourceControlFeedback({
  controller,
  canPush,
  pushLabel,
}: {
  controller: ChangesSourceControl;
  canPush: boolean;
  pushLabel: string;
}) {
  const { feedback } = controller;
  if (!feedback) return null;
  if (feedback.kind === "committed") {
    return (
      <div role="status" className="flex min-w-0 items-center gap-2 text-meta">
        <span className="min-w-0 truncate text-muted-foreground">
          已提交{" "}
          <span className="font-mono text-foreground">{shortOid(feedback.result.oid)}</span>{" "}
          {feedback.result.summary}
        </span>
        {canPush ? (
          <Button
            type="button"
            variant="link"
            size="xs"
            className="shrink-0"
            disabled={controller.pushing}
            onClick={controller.push}
          >
            {pushLabel}
          </Button>
        ) : null}
      </div>
    );
  }
  if (feedback.kind === "pushed") {
    const { remote, branch, setUpstream } = feedback.result;
    return (
      <p role="status" className="truncate text-meta text-muted-foreground">
        {setUpstream ? "已发布" : "已推送"} {branch} to {remote}
        {feedback.result.branchStatus.oid ? (
          <span className="font-mono"> · {shortOid(feedback.result.branchStatus.oid)}</span>
        ) : null}
      </p>
    );
  }
  const { text, detail, detailLabel } = describeSourceControlError(feedback.action, feedback.error);
  return (
    <div role="alert" className="flex flex-col gap-1 text-meta text-destructive">
      <p>{text}</p>
      {detail ? (
        <Collapsible>
          <CollapsibleTrigger className="group/detail flex items-center gap-1 text-muted-foreground hover:text-foreground">
            <ChevronRight
              className="size-3 transition-transform group-data-panel-open/detail:rotate-90"
              aria-hidden="true"
            />
            {detailLabel}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-muted px-2 py-1.5 font-mono text-diff whitespace-pre-wrap text-foreground">
              {detail}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}

function shortOid(oid: string): string {
  return oid.slice(0, 7);
}

const ACTION_FAILED: Record<SourceControlAction, string> = {
  stage: "无法暂存文件",
  unstage: "无法取消暂存文件",
  commit: "无法提交",
  push: "无法推送",
  generate: "无法生成提交消息",
};

/** Specific, actionable text for a failed action; `detail` is Git or hook output. */
export function describeSourceControlError(
  action: SourceControlAction,
  error: unknown,
): { text: string; detail?: string; detailLabel: string } {
  const message = error instanceof Error && error.message ? error.message : "未知错误";
  if (!(error instanceof SourceControlError)) {
    return { text: `${ACTION_FAILED[action]}: ${message}`, detailLabel: "详情" };
  }
  const detail = error.detail?.trim() || undefined;
  const result = (text: string, detailLabel = "Git 输出") => ({
    text,
    ...(detail ? { detail } : {}),
    detailLabel,
  });
  switch (error.code) {
    case "hook-failed":
      return result(`${ACTION_FAILED[action]}：Git hook 拒绝了它。`, "Hook 输出");
    case "identity-missing":
      return result(
        "提交前 Git 需要您的姓名和邮箱。请使用 git config 设置 user.name 和 user.email，然后再次提交。",
      );
    case "nothing-to-commit":
      return result("没有已暂存的内容可供提交。");
    case "push-rejected":
      return result(
        "远程仓库有该分支没有的提交。先拉取它们，然后再次推送。",
      );
    case "auth-failed":
      return result(
        "Git 无法登录远程仓库。请检查您的 Git 凭据，然后重试。",
      );
    case "no-remote":
      return result(
        "此仓库没有可推送的远程仓库。请使用 git remote add 添加一个，然后推送。",
      );
    case "detached-head":
      return result("HEAD 已分离。请先检出分支。");
    case "path-outside-repository":
      return result(`${ACTION_FAILED[action]}：路径在此仓库之外。`);
    case "unsupported-connection":
      return result("提交和推送仅适用于本地连接。");
    default:
      return result(`${ACTION_FAILED[action]}: ${message}`);
  }
}
