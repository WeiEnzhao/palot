import { CheckCheck } from "lucide-react";
import { useState } from "react";
import { idleInboxTasks, type InboxSessionView } from "../lib/session-inbox";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { toast } from "./ui/toast";

const DAY_MS = 24 * 60 * 60 * 1_000;
const IDLE_CHOICES = [
  { label: "空闲 1 天", idleForMs: DAY_MS },
  { label: "空闲 3 天", idleForMs: 3 * DAY_MS },
  { label: "空闲 1 周", idleForMs: 7 * DAY_MS },
] as const;

/**
 * Inbox section action: settle every listed task that can settle and has been idle for a
 * chosen time. Callers pass the rows the section shows, so filters narrow the batch.
 */
export function SettleIdleMenu<T extends InboxSessionView>({
  items,
  disabled = false,
  onSettle,
}: {
  items: readonly T[];
  disabled?: boolean;
  onSettle(items: T[]): void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const choices = [
    ...IDLE_CHOICES.map((choice) => ({
      label: choice.label,
      items: idleInboxTasks(items, now, choice.idleForMs),
    })),
    { label: "所有空闲任务", items: idleInboxTasks(items, now, 0) },
  ];
  return (
    <DropdownMenu onOpenChange={(open) => open && setNow(Date.now())}>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="结束空闲任务"
            title="结束空闲任务"
            disabled={disabled}
          />
        }
      >
        <CheckCheck aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>结束空闲任务</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {choices.map((choice) => (
            <DropdownMenuItem
              key={choice.label}
              disabled={choice.items.length === 0}
              onClick={() => onSettle(choice.items)}
            >
              {choice.label}
              <span className="ml-auto text-meta text-muted-foreground tabular-nums">
                {choice.items.length}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** One toast for a batch of settled tasks, with Undo for the whole batch. */
export function announceSettledBatch(input: {
  count: number;
  title?: string;
  description?: string;
  undo(): Promise<unknown>;
}): void {
  const tasks = input.count === 1 ? "1 个任务" : `${input.count} 个任务`;
  toast.add({
    type: "success",
    title: input.title ?? `已结算 ${tasks}`,
    ...(input.description ? { description: input.description } : {}),
    actionProps: {
      children: "撤销",
      onClick: () =>
        void input.undo().catch((error: unknown) =>
          toast.add({
            type: "error",
            title: "无法把任务移回收件箱",
            description: error instanceof Error ? error.message : undefined,
          }),
        ),
    },
  });
}
