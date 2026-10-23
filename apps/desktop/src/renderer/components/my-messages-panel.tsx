/** 「我的消息」右侧面板：列出当前会话中用户发送的全部消息。 */

import { useAtom, useSetAtom } from "jotai";
import { X } from "lucide-react";
import { memo, useCallback, useMemo } from "react";
import type { PalotMessage } from "../../shared";
import { highlightedMessageIDAtom, myMessagesPanelOpenAtom } from "../atoms/my-messages";
import { cn } from "../lib/cn";

export interface MyMessagesPanelProps {
  messages: PalotMessage[];
  onJumpToMessage(messageID: string): void;
}

/**
 * 右侧「我的消息」面板：列出当前会话中 role=user 的全部消息，
 * 按时间倒序排列，点击跳转到对应位置并短暂高亮。
 */
export const MyMessagesPanel = memo(function MyMessagesPanel({
  messages,
  onJumpToMessage,
}: MyMessagesPanelProps) {
  const [open, setOpen] = useAtom(myMessagesPanelOpenAtom);
  const setHighlightedID = useSetAtom(highlightedMessageIDAtom);

  const userMessages = useMemo(
    () =>
      messages
        .filter((message) => message.type === "user")
        .toSorted((a, b) => b.createdAt - a.createdAt),
    [messages],
  );

  const handleClick = useCallback(
    (messageID: string) => {
      onJumpToMessage(messageID);
      setHighlightedID(messageID);
      // 2 秒后清除高亮
      setTimeout(() => setHighlightedID(null), 2_000);
    },
    [onJumpToMessage, setHighlightedID],
  );

  if (!open) return null;

  return (
    <div className="flex h-full w-80 flex-col border-l bg-background">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h2 className="text-sm font-semibold">我的消息</h2>
        <button
          type="button"
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="关闭面板"
          onClick={() => setOpen(false)}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {userMessages.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">
            暂无消息
          </div>
        ) : (
          <ul className="flex flex-col gap-1 p-2">
            {userMessages.map((message) => {
              const firstLine = message.text?.split("\n")[0] ?? "(无内容)";
              const time = new Date(message.createdAt).toLocaleTimeString("zh-CN", {
                hour: "2-digit",
                minute: "2-digit",
              });
              return (
                <li key={message.id}>
                  <button
                    type="button"
                    className={cn(
                      "w-full rounded-md px-2 py-2 text-left transition-colors hover:bg-muted",
                    )}
                    onClick={() => handleClick(message.id)}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-xs text-muted-foreground">{time}</span>
                    </div>
                    <div className="mt-0.5 truncate text-sm">{firstLine}</div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
});
