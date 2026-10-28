import {
  Archive,
  ChevronDown,
  ChevronRight,
  Clock3,
  CircleDot,
  FolderPlus,
  FolderGit2,
  Ellipsis,
  ListFilter,
  LoaderCircle,
  SlidersHorizontal,
} from "lucide-react";
import { useAtomValue } from "jotai";
import { useState, type ReactNode, type ComponentProps } from "react";
import { type PalotProject } from "../../shared";

import {
  type InboxFilters,
  type InboxStateFilter,
  type InboxViewPreferences,
} from "../atoms/ui";
import { runtimeAtom } from "../atoms/workspace";
import { useRootSessionPagination } from "../hooks/use-session-catalog";
import { catalogSessionIsUnread } from "../hooks/use-session-info";
import { cn } from "../lib/cn";
import {
  formatSnoozeMenuTime,
  formatSnoozeWakeTime,
  sessionSnoozeChoices,
} from "../lib/session-snooze";
import { inboxSessionState, type InboxSessionView } from "../lib/session-inbox";
import { AddProjectDialog } from "./add-project-dialog";
import { ProjectPickerContent } from "./project-picker";
import { Button } from "./ui/button";
import { CollapsibleTrigger } from "./ui/collapsible";
import { InboxStateGlyph } from "./inbox-card-surface";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import {
  sidebarSectionIconVariants,
  sidebarSectionTriggerVariants,
} from "./ui/sidebar-styles";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { Switch } from "./ui/switch";
import {
  sectionChevronRevealClass,
  sidebarFluidItemClass,
  sidebarFluidRowProps,
} from "./sidebar-fluid-list";

const STATE_FILTERS: ReadonlyArray<{ value: InboxStateFilter; label: string }> =
  [
    { value: "attention", label: "需要输入" },
    { value: "running", label: "运行中" },
    { value: "failed", label: "失败" },
    { value: "unread", label: "未读" },
  ];
const INBOX_ORDERING_LABELS: Record<InboxViewPreferences["ordering"], string> =
  {
    newest: "最新",
    oldest: "最早",
    attention: "需要输入优先",
  };
type InboxShelves = {
  pinned: boolean;
  inbox: boolean;
  snoozed: boolean;
  settled: boolean;
};

export function InboxToolbar({
  projects,
  filters,
  onFiltersChange,
  viewPreferences,
  onViewPreferencesChange,
  onShelvesChange,
  pagination,
  runtime,
  filterItems,
  optionItems,
  additionalFilterCount = 0,
  onClearFilters,
}: {
  projects: PalotProject[];
  filters: InboxFilters;
  onFiltersChange(
    update: InboxFilters | ((current: InboxFilters) => InboxFilters),
  ): void;
  viewPreferences: InboxViewPreferences;
  onViewPreferencesChange(
    update:
      | InboxViewPreferences
      | ((current: InboxViewPreferences) => InboxViewPreferences),
  ): void;
  onShelvesChange(
    update: InboxShelves | ((current: InboxShelves) => InboxShelves),
  ): void;
  pagination: Pick<
    ReturnType<typeof useRootSessionPagination>,
    "hasNextPage" | "isFetchingNextPage" | "loadMore"
  >;
  runtime: ReturnType<typeof useAtomValue<typeof runtimeAtom>>;
  filterItems?: ReactNode;
  optionItems?: ReactNode;
  additionalFilterCount?: number;
  onClearFilters?(): void;
}) {
  const [addProjectOpen, setAddProjectOpen] = useState(false);
  const activeCount =
    Number(Boolean(filters.projectID)) +
    filters.states.length +
    additionalFilterCount;
  const selectedProject = projects.find(
    (project) => project.id === filters.projectID,
  );
  const toggleState = (state: InboxStateFilter, checked: boolean) =>
    onFiltersChange((current) => ({
      ...current,
      states: checked
        ? [...current.states, state]
        : current.states.filter((candidate) => candidate !== state),
    }));

  return (
    <>
      <div className="flex h-8 shrink-0 items-center justify-between px-2.5 pb-1">
        <div className="flex items-center gap-0.5">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="relative text-sidebar-secondary hover:bg-(--palot-sidebar-hover) hover:text-sidebar-foreground"
                  aria-label={
                    activeCount ? `筛选任务，${activeCount} 个生效` : "筛选任务"
                  }
                />
              }
            >
              <ListFilter aria-hidden="true" />
              {activeCount > 0 ? (
                <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-info ring-1 ring-sidebar" />
              ) : null}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56 p-1.5">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="px-2 py-1.5 text-xs font-normal text-muted-foreground">
                  添加筛选…
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="min-h-9">
                  <FolderGit2 aria-hidden="true" />
                  <span>项目</span>
                  {selectedProject ? (
                    <span className="ml-auto max-w-24 truncate text-xs text-muted-foreground">
                      {selectedProject.name}
                    </span>
                  ) : null}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-80 p-1">
                  <ProjectPickerContent
                    projects={projects}
                    value={filters.projectID}
                    allLabel="所有项目"
                    onValueChange={(projectID) =>
                      onFiltersChange((current) => ({ ...current, projectID }))
                    }
                  />
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="min-h-9">
                  <CircleDot aria-hidden="true" />
                  <span>状态</span>
                  {filters.states.length > 0 ? (
                    <span className="ml-auto text-xs text-muted-foreground">
                      {filters.states.length}
                    </span>
                  ) : null}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-48 p-1">
                  {STATE_FILTERS.map((state) => (
                    <DropdownMenuCheckboxItem
                      key={state.value}
                      checked={filters.states.includes(state.value)}
                      onCheckedChange={(checked) =>
                        toggleState(state.value, checked)
                      }
                      closeOnClick={false}
                    >
                      {state.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              {filterItems}
              {activeCount > 0 ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-muted-foreground"
                    onClick={() => {
                      onFiltersChange({ projectID: null, states: [] });
                      onClearFilters?.();
                    }}
                  >
                    清除筛选
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
          <Popover>
            <Tooltip>
              <TooltipTrigger
                render={
                  <PopoverTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-sidebar-secondary hover:bg-(--palot-sidebar-hover) hover:text-sidebar-foreground"
                        aria-label="收件箱视图设置"
                      />
                    }
                  />
                }
              >
                <SlidersHorizontal aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent>视图设置</TooltipContent>
            </Tooltip>
            <PopoverContent align="start" className="w-64 gap-3 p-3">
              <div className="space-y-1.5">
                <label htmlFor="inbox-ordering" className="text-xs font-medium">
                  排序
                </label>
                <Select
                  value={viewPreferences.ordering}
                  onValueChange={(ordering) => {
                    if (!ordering) return;
                    onViewPreferencesChange((current) => ({
                      ...current,
                      ordering,
                    }));
                  }}
                >
                  <SelectTrigger id="inbox-ordering" className="w-full">
                    <SelectValue>
                      {INBOX_ORDERING_LABELS[viewPreferences.ordering]}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">最新</SelectItem>
                    <SelectItem value="oldest">最早</SelectItem>
                    <SelectItem value="attention">需要输入优先</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="h-px bg-border/50" />
              <InboxViewToggle
                label="未读优先"
                checked={viewPreferences.unreadFirst}
                onCheckedChange={(unreadFirst) =>
                  onViewPreferencesChange((current) => ({
                    ...current,
                    unreadFirst,
                  }))
                }
              />
              <InboxViewToggle
                label="显示已延后"
                checked={viewPreferences.showSnoozed}
                onCheckedChange={(showSnoozed) =>
                  onViewPreferencesChange((current) => ({
                    ...current,
                    showSnoozed,
                  }))
                }
              />
              <InboxViewToggle
                label="显示已结算"
                checked={viewPreferences.showSettled}
                onCheckedChange={(showSettled) =>
                  onViewPreferencesChange((current) => ({
                    ...current,
                    showSettled,
                  }))
                }
              />
            </PopoverContent>
          </Popover>
        </div>
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-sidebar-secondary hover:bg-(--palot-sidebar-hover) hover:text-sidebar-foreground"
                  aria-label="添加项目文件夹"
                  onClick={() => setAddProjectOpen(true)}
                />
              }
            >
              <FolderPlus aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent>添加项目文件夹</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-sidebar-secondary hover:bg-(--palot-sidebar-hover) hover:text-sidebar-foreground"
                  aria-label="收件箱选项"
                />
              }
            >
              <Ellipsis aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem
                disabled={
                  !pagination.hasNextPage || pagination.isFetchingNextPage
                }
                onClick={() => void pagination.loadMore()}
              >
                {pagination.isFetchingNextPage ? (
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                ) : (
                  <Archive aria-hidden="true" />
                )}
                {pagination.hasNextPage ? "加载更早的任务" : "所有任务已加载"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() =>
                  onShelvesChange({
                    pinned: true,
                    inbox: true,
                    snoozed: true,
                    settled: true,
                  })
                }
              >
                展开所有分区
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  onShelvesChange({
                    pinned: false,
                    inbox: false,
                    snoozed: false,
                    settled: false,
                  })
                }
              >
                折叠所有分区
              </DropdownMenuItem>
              {optionItems}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {addProjectOpen && (
        <AddProjectDialog
          initialProfileID={runtime?.profileID}
          onClose={() => setAddProjectOpen(false)}
        />
      )}
    </>
  );
}

function InboxViewToggle({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange(checked: boolean): void;
}) {
  return (
    <label className="flex min-h-7 cursor-pointer items-center justify-between gap-4 text-sm">
      <span>{label}</span>
      <Switch size="sm" checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  );
}

export function SnoozeMenuButton({
  onSnooze,
  disabled = false,
  className,
}: {
  onSnooze(until: number): void;
  disabled?: boolean;
  className?: string;
}) {
  const [displayNow] = useState(() => Date.now());
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className={className}
                  aria-label="暂停任务"
                  disabled={disabled}
                />
              }
            />
          }
        >
          <Clock3 aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent>暂停</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>暂停至</DropdownMenuLabel>
          {sessionSnoozeChoices.map(([label, resolve]) => (
            <DropdownMenuItem
              key={label}
              onClick={() => void onSnooze(resolve(Date.now()))}
            >
              <span>{label}</span>
              <span className="ml-auto text-muted-foreground tabular-nums">
                {formatSnoozeMenuTime(resolve(displayNow))}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SectionTrigger({
  title,
  count,
  open,
  badge,
  action,
  label,
  icon,
  className,
  hideCount,
}: {
  title: string;
  count: number;
  open: boolean;
  badge?: ReactNode;
  action?: ReactNode;
  label?: string;
  icon?: ReactNode;
  className?: string;
  hideCount?: boolean;
}) {
  const trigger = (
    <CollapsibleTrigger
      render={
        <button
          type="button"
          aria-label={label}
          className={cn(
            sidebarSectionTriggerVariants(),
            // 覆盖层（±/归档等 action）落在外层 wrapper 的 col-start-2，触发行整行跨 3 列即可；
            // 不用 subgrid：它会覆盖基础变体的 flex，28px 行里 16px 文本行高 + py-1
            // 把 chevron 列往下顶 4.2px，和盖层居中的按钮错位（2026-10-23 CDP 实测）。
            action && "col-span-3 col-start-1 row-start-1 flex",
            className,
          )}
        />
      }
    >
      <span className="flex min-w-0 items-center gap-1">
        {icon}
        <span className="truncate">{title}</span>
        {badge}
      </span>
      {action ? <span className="w-9" aria-hidden="true" /> : null}
      <span className="ml-auto flex items-center">
        {hideCount ? null : (
          <span
            className={cn(
              "ml-auto mr-2 text-micro text-sidebar-foreground/45 tabular-nums transition-colors group-hover/section-label:text-sidebar-foreground/70 group-focus-visible/section-label:text-sidebar-foreground/70",
              // action 与计数共用「折叠箭头左侧」那一格：悬停/聚焦时计数让位给按钮，
              // 否则两者叠在同一格里（2026-10-24 CDP 实测 plus 与箭头重叠 16px）。
              action &&
                "group-hover/section-row:opacity-0 group-focus-within/section-row:opacity-0",
            )}
          >
            {count}
          </span>
        )}
        {open ? (
          <ChevronDown
            className={cn(
              sidebarSectionIconVariants(),
              sectionChevronRevealClass(true),
            )}
            aria-hidden="true"
          />
        ) : (
          <ChevronRight
            className={sidebarSectionIconVariants({ direction: "right" })}
            aria-hidden="true"
          />
        )}
      </span>
    </CollapsibleTrigger>
  );
  return action ? (
    // 列宽固定：col2 = action 位（28px），col3 = 折叠箭头位（24px）。auto 列在
    // 跨列触发行里会被算成 0，盖层于是贴到最右、正好压在箭头上。
    <div className="group/section-row grid grid-cols-[minmax(0,1fr)_1.75rem_1.5rem] items-center">
      {trigger}
      {/* Quiet until the row is hovered or holds focus; never removed from the tab order. */}
      <div className="relative z-10 col-start-2 row-start-1 flex items-center justify-center opacity-0 transition-opacity group-focus-within/section-row:opacity-100 group-hover/section-row:opacity-100">
        {action}
      </div>
    </div>
  ) : (
    trigger
  );
}

export function InboxCompactRowSurface({
  item,
  selected,
  hint,
  buttonProps,
  connectionBadge,
  pullRequest,
  children,
  ...props
}: ComponentProps<"div"> & {
  item: InboxSessionView;
  selected: boolean;
  hint?: ReactNode;
  buttonProps: ComponentProps<"button">;
  connectionBadge?: ReactNode;
  /** A linked pull request marker; stays visible while the row's metadata yields to actions. */
  pullRequest?: ReactNode;
  children?: ReactNode;
}) {
  const visualState = inboxSessionState(
    item,
    !selected && catalogSessionIsUnread(item.session),
  );
  return (
    <div
      {...sidebarFluidRowProps}
      {...props}
      className={cn("group/compact relative", props.className)}
      data-inbox-compact-row
    >
      {hint}
      <button
        {...buttonProps}
        type="button"
        className={cn(
          "relative flex w-full cursor-grab items-center text-left active:cursor-grabbing",
          sidebarFluidItemClass(),
          selected &&
            "font-medium text-sidebar-foreground before:absolute before:-left-1.5 before:inset-y-0.5 before:w-0.5 before:rounded-full before:bg-info",
          buttonProps.className,
        )}
      >
        {item.section === "snoozed" ? <Clock3 aria-hidden="true" /> : null}
        <span className="min-w-0 flex-1 truncate text-compact font-normal">
          {item.session.title ?? "未命名任务"}
        </span>
        {pullRequest}
        {connectionBadge}
        {item.section === "snoozed" && item.snoozedUntil ? (
          <span className="flex min-w-0 max-w-28 shrink-0 items-center gap-1 text-right text-micro text-muted-foreground transition-opacity group-hover/compact:opacity-0 group-has-[:focus-visible]/compact:opacity-0">
            <InboxStateGlyph state={visualState} />
            {formatSnoozeWakeTime(item.snoozedUntil)}
          </span>
        ) : visualState && visualState !== "unread" ? (
          // Rows read as pure titles at rest; only live states (attention, failed,
          // running) still surface their glyph.
          <span className="absolute top-1/2 right-1.5 -translate-y-1/2 transition-opacity group-hover/compact:opacity-0">
            <InboxStateGlyph state={visualState} />
          </span>
        ) : null}
      </button>
      {children}
    </div>
  );
}
