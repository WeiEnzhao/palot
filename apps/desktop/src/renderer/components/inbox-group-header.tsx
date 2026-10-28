import type { ReactNode } from "react";
import { Folder, Plus } from "lucide-react";
import { cn } from "../lib/cn";
import { Button } from "./ui/button";

/**
 * 收件箱项目分组头（单连接 / 多连接共用）。
 *
 * 这两条渲染路径历史上各写了一份：形状一样、右侧多出来的东西不一样
 * （多连接有服务器徽标，单连接没有）。改成同一个组件后，改分组头只改这里一处。
 */
export function InboxProjectGroupHeader({
  label,
  count,
  badge,
  action,
  className,
}: {
  label: string;
  count: number;
  /** 连接徽标之类的附加信息，渲染在操作按钮左侧。 */
  badge?: ReactNode;
  /** 悬停/常显的操作按钮（当前是「+ 新任务」）。 */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-7 min-w-0 items-center gap-2 px-1.5 pt-3 pb-1 text-base font-semibold text-sidebar-foreground",
        className,
      )}
    >
      <Folder aria-hidden="true" className="size-4 shrink-0 text-sidebar-foreground/60" />
      <span className="truncate">{label}</span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {badge}
        {action}
        <span className="tabular-nums opacity-70">{count}</span>
      </span>
    </div>
  );
}

/** 分组头上的「+ 新任务」按钮，两条路径共用同一套外观与无障碍文案。 */
export function InboxNewTaskButton({
  label,
  disabled,
  onOpen,
}: {
  label: string;
  disabled?: boolean;
  onOpen(): void;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      disabled={disabled}
      onClick={onOpen}
    >
      <Plus aria-hidden="true" />
    </Button>
  );
}
