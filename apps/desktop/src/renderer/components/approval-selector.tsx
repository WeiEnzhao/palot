import { memo, useState } from "react";
import { ChevronDown, Shield, ShieldAlert } from "lucide-react";
import type { ApprovalPreset, SessionApprovalMode } from "../lib/session-permissions";
import { cn } from "../lib/cn";
import { showErrorToast } from "../lib/toast-error";
import { InputGroupButton } from "./ui/input-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
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
  AlertDialogTitle,
} from "./ui/alert-dialog";

export const ApprovalSelector = memo(function ApprovalSelector({
  mode,
  busy,
  disabled,
  open,
  onOpenChange,
  onSelect,
  onSelectionComplete,
}: {
  mode: SessionApprovalMode;
  busy: boolean;
  disabled: boolean;
  open: boolean;
  onOpenChange(open: boolean): void;
  onSelect(mode: ApprovalPreset): Promise<void>;
  onSelectionComplete(): void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = mode === "full" ? "完全访问" : mode === "custom" ? "自定义" : "默认";

  async function apply(next: ApprovalPreset) {
    if (busy || disabled) return;
    setError(null);
    try {
      await onSelect(next);
      setConfirm(false);
      onOpenChange(false);
      onSelectionComplete();
    } catch (error) {
      setError(error instanceof Error ? error.message : "无法更改权限。");
      showErrorToast("无法更改权限", error);
    }
  }

  return (
    <>
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger
          render={
            <InputGroupButton
              type="button"
              size="composer"
              aria-label={`Approvals: ${label}`}
              disabled={disabled || busy}
              className={cn("shrink-0 gap-1 px-2", mode === "full" && "text-warning")}
            />
          }
        >
          {mode === "full" ? <ShieldAlert aria-hidden="true" /> : <Shield aria-hidden="true" />}
          <span>{label}</span>
          <ChevronDown aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-80 max-w-[calc(100vw-24px)]">
          {mode === "custom" && (
            <p className="px-2 py-1 text-meta text-muted-foreground">
              自定义会话规则已生效。选择预设将替换它们。
            </p>
          )}
          <DropdownMenuRadioGroup
            value={mode}
            onValueChange={(value) => {
              if (busy || disabled || value === mode) return;
              if (value === "full") {
                onOpenChange(false);
                setError(null);
                setConfirm(true);
              } else if (value === "normal") void apply("normal");
            }}
          >
            <DropdownMenuLabel>此线程的审批</DropdownMenuLabel>
            <DropdownMenuRadioItem value="normal" disabled={disabled || busy}>
              <div>
                <div>默认</div>
                <div className="text-meta text-muted-foreground">
                  使用项目和智能体权限规则。
                </div>
              </div>
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem
              value="full"
              disabled={disabled || busy}
              className="text-warning"
            >
              <div>
                <div>完全访问</div>
                <div className="text-meta text-muted-foreground">
                  允许工具操作而无需常规审批提示。
                </div>
              </div>
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <p className="px-2 py-1 text-meta text-muted-foreground">
            已有的审批请求仍需回复。
          </p>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog
        open={confirm}
        onOpenChange={(value) => {
          if (!busy) setConfirm(value);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>启用完全访问？</AlertDialogTitle>
            <AlertDialogDescription>
              这将覆盖此线程的项目和智能体工具权限规则，包括计划编辑限制。命令可以使用 OpenCode
              服务用户的访问权限修改文件和使用网络。这不会授予额外的操作系统权限或绕过权限插件。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-meta text-muted-foreground">
            新子智能体继承这些规则；已有子智能体和待处理审批不受影响。您可以返回默认，但这不会停止已在运行的命令。
          </p>
          {error && (
            <p role="alert" className="text-meta text-destructive">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction disabled={disabled || busy} onClick={() => void apply("full")}>
              {busy ? "正在更新权限…" : "启用完全访问"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
});
