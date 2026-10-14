import { useMemo, useState } from "react";
import type { OpenCodeRuntimeStatus, PalotMessage, PalotSession } from "../../shared";
import { userPromptHistory, promptHistoryLabel } from "../lib/session-history";
import { useSessionTranscript } from "../hooks/use-session-transcript";
import { useSessionFork } from "../hooks/use-session-fork";
import { showErrorToast } from "../lib/toast-error";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";

export function SessionHistoryDialog({
  messages,
  mode,
  onClose,
  onSelect,
  hasMore,
  loading,
  error,
  onLoadMore,
}: {
  messages: PalotMessage[];
  mode: "timeline" | "fork";
  onClose(): void;
  onSelect(message: PalotMessage): void | Promise<void>;
  hasMore: boolean;
  loading: boolean;
  error: boolean;
  onLoadMore(): void;
}) {
  const [search, setSearch] = useState("");
  const [selecting, setSelecting] = useState(false);
  const prompts = useMemo(() => userPromptHistory(messages), [messages]);
  const matches = useMemo(
    () =>
      prompts
        .filter((message) =>
          promptHistoryLabel(message).toLocaleLowerCase().includes(search.toLocaleLowerCase()),
        )
        .toReversed(),
    [prompts, search],
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !selecting) onClose();
      }}
    >
      <DialogContent className="max-h-[80vh] sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{mode === "fork" ? "从提示词分叉" : "提示词时间线"}</DialogTitle>
          <DialogDescription>
            {mode === "fork"
              ? "复制某个提示词之前的历史，并将其恢复为可编辑的未发送草稿。文件注释将转为文本；不可用的附件会标注说明。"
              : "查找用户提示词并跳转到对应回合。"}
          </DialogDescription>
        </DialogHeader>
        <Input
          aria-label="搜索提示词"
          placeholder="搜索提示词…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <p role="status" className="text-meta text-muted-foreground">
          {loading
            ? "正在加载更早的提示词…"
            : hasMore
              ? `正在搜索已加载的 ${prompts.length} 条提示词。更早的历史尚未搜索。`
              : `正在搜索全部 ${prompts.length} 条提示词。`}
        </p>
        <div
          className="flex min-h-0 max-h-80 flex-col gap-1 overflow-y-auto"
          aria-label="提示词结果"
        >
          {matches.map((message) => (
            <Button
              key={message.id}
              variant="ghost"
              className="h-auto justify-start gap-3 py-2 text-left"
              disabled={selecting}
              onClick={() => {
                setSelecting(true);
                void Promise.resolve()
                  .then(() => onSelect(message))
                  .catch((cause) => showErrorToast("无法打开提示词", cause))
                  .finally(() => setSelecting(false));
              }}
            >
              <span className="min-w-0 flex-1 truncate">{promptHistoryLabel(message)}</span>
              <span className="shrink-0 text-meta text-muted-foreground">
                {new Date(message.createdAt).toLocaleString(undefined, {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </span>
            </Button>
          ))}
          {!matches.length ? (
            <p className="p-3 text-sm text-muted-foreground">
              {hasMore
                ? "没有匹配的已加载提示词。加载更早的历史以搜索更多。"
                : "没有匹配的提示词。"}
            </p>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="text-meta">
            无法加载更早的提示词。请重试。
          </p>
        ) : null}
        {hasMore || error ? (
          <Button variant="outline" disabled={loading || selecting} onClick={onLoadMore}>
            {error ? "重试加载历史" : "加载更早的提示词"}
          </Button>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Mount only while open: context menus do not eagerly hydrate every task. */
export function SessionForkHistoryDialog({
  session,
  owner,
  onClose,
}: {
  session: PalotSession;
  owner?: OpenCodeRuntimeStatus | null;
  onClose(): void;
}) {
  const transcript = useSessionTranscript(session, owner);
  const fork = useSessionFork(owner);
  return (
    <SessionHistoryDialog
      mode="fork"
      messages={transcript.messages}
      onClose={onClose}
      loading={transcript.isPending || transcript.isFetchingNextPage || transcript.isHydrating}
      hasMore={transcript.hasNextPage}
      error={Boolean(transcript.error)}
      onLoadMore={() => {
        void transcript.fetchNextPage();
      }}
      onSelect={async (message) => {
        await fork({ sessionID: session.id, beforeMessageID: message.id, restore: message });
        onClose();
      }}
    />
  );
}
