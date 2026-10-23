/** 底部常驻工作中计时器，显示当前轮次的运行时长和任务状态。 */

import { memo } from "react";
import type { TranscriptTurn } from "../lib/turn-projection";
import { formatDurationCn } from "../lib/format-duration";
import { useCurrentTime } from "./thread";

export interface WorkingTimerProps {
  turn: TranscriptTurn | null;
  visible: boolean;
}

/**
 * 底部常驻计时胶囊：工作中时显示「工作中 X 分 Y 秒」，结束即消失。
 * 风格贴现有组件（小字号、半透明背景、圆角），不抢视觉焦点。
 */
export const WorkingTimer = memo(function WorkingTimer({ turn, visible }: WorkingTimerProps) {
  const now = useCurrentTime(visible && turn?.status === "working");
  if (!visible || !turn || turn.status !== "working") return null;

  const startedAt = turn.startedAt ?? now;
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1_000));
  const duration = formatDurationCn(seconds, { hideZeroSeconds: true });

  return (
    <div
      className="flex items-center justify-center px-3 py-1.5"
      role="status"
      aria-label={`工作中，已用时 ${duration}`}
    >
      <div className="flex items-center gap-2 rounded-full bg-muted/80 px-3 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur-sm">
        <span className="inline-block size-1.5 animate-pulse rounded-full bg-primary" aria-hidden="true" />
        <span className="font-medium">工作中</span>
        <span className="tabular-nums">{duration}</span>
      </div>
    </div>
  );
});
