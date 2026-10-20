import { memo, useCallback, useState } from "react";
import { Shield, ShieldAlert } from "lucide-react";
import type { ApprovalPreset, SessionApprovalMode } from "../lib/session-permissions";
import {
  ComposerPicker,
  useComposerPickerAction,
  type ComposerPickerSection,
} from "./ui/composer-picker";
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

const SECTIONS: ComposerPickerSection<ApprovalPreset>[] = [
  {
    key: "presets",
    options: [
      {
        key: "normal",
        value: "normal",
        label: "默认",
        description: "使用项目和智能体权限规则。",
      },
      {
        key: "full",
        value: "full",
        label: "完全访问",
        description: "允许工具操作而无需常规审批提示。",
        tone: "warning",
      },
    ],
  },
];

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
  const confirmed = useCallback(() => {
    setConfirm(false);
    onSelectionComplete();
  }, [onSelectionComplete]);
  const failed = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : "无法更改权限。");
  }, []);
  const confirmAction = useComposerPickerAction({
    errorTitle: "无法更改权限",
    onSuccess: confirmed,
    onError: failed,
  });
  const updating = busy || confirmAction.busy;
  // Custom rules match neither preset, so nothing is marked current.
  const selectedKey = mode === "custom" ? null : mode;

  return (
    <>
      <ComposerPicker<ApprovalPreset>
        label={label}
        ariaLabel={`Approvals: ${label}`}
        icon={
          mode === "full" ? (
            <ShieldAlert className="shrink-0" aria-hidden="true" />
          ) : (
            <Shield className="shrink-0" aria-hidden="true" />
          )
        }
        tone={mode === "full" ? "warning" : "default"}
        triggerClassName="shrink-0 gap-1"
        disabled={disabled || updating}
        open={open}
        onOpenChange={onOpenChange}
        popupClassName="w-80"
        title="此线程的审批"
        notice={
          mode === "custom"
            ? "自定义会话规则已生效。选择预设将替换它们。"
            : undefined
        }
        listLabel="审批预设"
        sections={SECTIONS}
        selectedKey={selectedKey}
        footer="已有的审批请求仍需回复。"
        errorTitle="无法更改权限"
        confirm={(option) => {
          if (option.value !== "full") return false;
          setError(null);
          setConfirm(true);
          return true;
        }}
        onSelect={(option) => onSelect(option.value)}
        onSelectionComplete={onSelectionComplete}
      />
      <AlertDialog
        open={confirm}
        onOpenChange={(value) => {
          if (!updating) setConfirm(value);
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
            <AlertDialogCancel disabled={updating}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={disabled || updating}
              onClick={() => {
                setError(null);
                void confirmAction.run(() => onSelect("full"));
              }}
            >
              {updating ? "正在更新权限…" : "启用完全访问"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
});
