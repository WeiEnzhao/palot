import { useAtomValue } from "jotai";
import { useEffect, useId, useRef, useState } from "react";
import type { OpenCodeReleaseStatus } from "../../shared/opencode-release-contract";
import { runtimeAtom } from "../atoms/workspace";
import { palot } from "../services/palot";
import { OpenCodeInstallationSettings } from "./open-code-installation-settings";
import { SettingsGroup, SettingsSection } from "./settings-layout";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
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
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "./ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

type Operation = "status" | "channel" | "check" | "prepare" | "reset";

/** Release operations only prepare a future runtime; service lifecycle stays with confirmed actions. */
export function OpenCodeReleaseSettings({
  disabled = false,
  onBusyChange,
}: {
  disabled?: boolean;
  onBusyChange?(busy: boolean): void;
}) {
  const runtime = useAtomValue(runtimeAtom);
  const id = useId();
  const [status, setStatus] = useState<OpenCodeReleaseStatus | null>(null);
  const [busy, setBusy] = useState<Operation | null>("status");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [consent, setConsent] = useState<OpenCodeReleaseStatus["offer"]>(null);
  const locked = useRef(false);
  const generation = useRef(0);
  const retry = useRef<(() => void) | null>(null);

  useEffect(() => {
    onBusyChange?.(busy !== null || consent !== null);
  }, [busy, consent, onBusyChange]);

  async function run(
    operation: Operation,
    request: () => Promise<OpenCodeReleaseStatus>,
    message?: string,
    retryAction?: () => void,
  ) {
    if (locked.current || (disabled && operation !== "status")) return;
    locked.current = true;
    const current = generation.current;
    setBusy(operation);
    setError(null);
    setNotice(null);
    retry.current = retryAction ?? (() => void run(operation, request, message));
    try {
      const result = await request();
      if (current !== generation.current) return;
      setStatus(result);
      setNotice(message ?? null);
    } catch (cause) {
      if (current === generation.current)
        setError(cause instanceof Error ? cause.message : "OpenCode 发布操作失败。");
    } finally {
      if (current === generation.current) {
        locked.current = false;
        setBusy(null);
      }
    }
  }

  useEffect(() => {
    // Local metadata only. Checking the release feed is always a user action.
    void run("status", () => palot.openCodeReleaseStatus());
    let request = 0;
    const current = generation.current;
    const refresh = () => {
      // The initiating operation already receives the authoritative result. Keep
      // sibling checks in sync without blurring an in-flight channel selection.
      if (locked.current) return;
      const sequence = ++request;
      void palot
        .openCodeReleaseStatus()
        .then((result) => {
          if (current === generation.current && sequence === request && !locked.current) {
            setStatus(result);
          }
        })
        .catch(() => {
          if (current === generation.current) setError("无法刷新本地发布设置。");
        });
    };
    window.addEventListener("palot:opencode-release-changed", refresh);
    return () => {
      generation.current += 1;
      locked.current = false;
      window.removeEventListener("palot:opencode-release-changed", refresh);
    };
    // Initial load is intentionally independent of lifecycle control state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function prepare(offer: NonNullable<OpenCodeReleaseStatus["offer"]>, allowUntested = false) {
    if (locked.current || disabled) return;
    if (offer.requiresConfirmation && !allowUntested) {
      setConsent(offer);
      return;
    }
    setConsent(null);
    void run(
      "prepare",
      () =>
        palot.prepareOpenCodeRelease({
          version: offer.version,
          ...(allowUntested ? { allowUntested: true } : {}),
        }),
      `Palot 运行时 ${offer.version} 已作为回退或 Palot 运行时源准备好。现有服务不变。`,
      () => prepare(offer),
    );
  }

  const blocked = disabled || busy !== null || consent !== null;
  // Keep the save's initiating trigger focusable for the popup's native focus
  // return. Read-only prevents another selection without blurring the keyboard user.
  const channelDisabled = disabled || consent !== null || (busy !== null && busy !== "channel");
  return (
    <SettingsSection
      title="OpenCode 发布版本"
      description="选择更新通道，并可从 opencode.ai 下载可选的 OpenCode 回退版本，与应用更新独立。"
    >
      <SettingsGroup>
        <div className="@container/release min-w-0 space-y-4 p-4">
          {status ? (
            <>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor={id}>首选通道</FieldLabel>
                  <Select
                    value={status.channel}
                    disabled={channelDisabled}
                    readOnly={busy === "channel"}
                    onValueChange={(channel) => {
                      if (channel !== "stable" && channel !== "beta") return;
                      void run(
                        "channel",
                        () => palot.setOpenCodeReleaseChannel(channel),
                        "通道已保存。已准备好的运行时不变。准备好后可检查发布版本。",
                      );
                    }}
                  >
                    <SelectTrigger
                      id={id}
                      aria-describedby={`${id}-help`}
                      aria-busy={busy === "channel"}
                    >
                      <SelectValue>{status.channel === "beta" ? "Beta" : "Stable"}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="stable">Stable</SelectItem>
                      <SelectItem value="beta">Beta</SelectItem>
                    </SelectContent>
                  </Select>
                  <FieldDescription id={`${id}-help`}>
                    Stable 为默认通道。Beta 为实验通道，可能滞后于
                    Stable。已支持 Stable 2.x；后续版本中添加的功能可能需要
                    该版本。切换通道不会下载或替换运行时。
                  </FieldDescription>
                </Field>
              </FieldGroup>
              <dl className="grid min-w-0 gap-3 text-sm @md/release:grid-cols-2">
                <div className="min-w-0">
                  <dt className="text-meta text-muted-foreground">
                    当前运行的服务版本
                  </dt>
                  <dd className="mt-1 wrap-anywhere">
                    {runtime?.connected ? (runtime.version ?? "未知") : "未连接"}
                    {runtime?.connected && runtime.source === "network-server"
                      ? "（远程服务）"
                      : ""}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-meta text-muted-foreground">已准备好的 Palot 运行时</dt>
                  <dd className="mt-1 wrap-anywhere">
                    {status.preparedVersion ?? status.bundledVersion ?? "未下载"}
                    {status.preparedVersion
                      ? "（已下载）"
                      : status.bundledVersion
                        ? "（内置）"
                        : ""}
                  </dd>
                </div>
              </dl>
              <p className="text-compact leading-relaxed text-muted-foreground">
                准备和重置不会启动、停止或更改共享服务。默认优先使用已安装的
                OpenCode。此运行时仅在回退或您选择 Palot 运行时使用，
                需在确认后才启动或重启。
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={blocked}
                  onClick={() => void run("check", () => palot.checkOpenCodeRelease())}
                >
                  {busy === "check" ? "检查中…" : "检查发布版本"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={blocked || !status.preparedVersion}
                  onClick={() =>
                    void run(
                      "reset",
                      () => palot.resetOpenCodeRelease(),
                      status.bundledVersion
                        ? `内置 OpenCode ${status.bundledVersion} 重新成为 Palot 回退。已安装的 CLI 和现有服务不变。`
                        : "未选择已下载的运行时。已安装的 CLI 和现有服务不变。",
                    )
                  }
                >
                  {status.bundledVersion
                    ? `重置为内置 ${status.bundledVersion}`
                    : "重置已准备的运行时"}
                </Button>
              </div>
              {status.offer ? (
                <div className="space-y-2">
                  <p className="text-compact wrap-anywhere">
                    {status.offer.channel === "beta" ? "Beta" : "Stable"} 提供 OpenCode{" "}
                    {status.offer.version} ·{" "}
                    {status.offer.tested
                      ? "已通过 Palot 测试"
                      : status.offer.requiresConfirmation
                        ? "兼容性未验证 · 未经 Palot 测试"
                        : "兼容 · 尚未在此 Palot 版本测试"}{" "}
                    · {(status.offer.size / 1024 / 1024).toFixed(1)} MB
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    disabled={blocked || status.preparedVersion === status.offer.version}
                    onClick={() => status.offer && prepare(status.offer)}
                  >
                    {busy === "prepare"
                      ? "准备中…"
                      : `下载 Palot 回退 ${status.offer.version}`}
                  </Button>
                </div>
              ) : status.checkedAt ? (
                <p className="text-compact text-muted-foreground">
                  {status.channel === "beta"
                    ? "没有兼容的 Beta 可用。官方 Beta 版本早于 Palot 支持的范围。请检查 Stable 或稍后重试。"
                    : "没有兼容的 Stable 可用。官方 Stable 版本早于 Palot 支持的范围。请稍后重试。"}
                </p>
              ) : null}
              <p className="text-meta text-muted-foreground">
                {status.checkedAt
                  ? `上次检查：${new Date(status.checkedAt).toLocaleString()}`
                  : "尚未检查。仅在您请求时才检查发布版本。"}
              </p>
            </>
          ) : busy ? (
            <p role="status" className="text-compact text-muted-foreground">
              正在加载本地发布设置…
            </p>
          ) : null}
          {notice ? (
            <p role="status" className="text-compact text-muted-foreground">
              {notice}
            </p>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>无法更新 OpenCode 发布版本设置</AlertTitle>
              <AlertDescription>
                <p className="wrap-anywhere">{error}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={blocked}
                  onClick={() => retry.current?.()}
                >
                  重试发布操作
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
      </SettingsGroup>
      <AlertDialog open={consent !== null} onOpenChange={(open) => !open && setConsent(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>准备未经测试的 OpenCode {consent?.version}？</AlertDialogTitle>
            <AlertDialogDescription>
              此 {consent?.channel === "beta" ? "Beta" : "Stable"} 版本尚未
              在 Palot 中测试。当前 API 没有功能清单，因此不保证兼容性，
              部分功能可能失败。下载后将其作为稍后确认启动或重启的回退；
              不会更改运行中的服务。如需稍后更改版本，请选择已安装的运行时
              或检查 Stable 通道并准备该版本。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={disabled || busy !== null}
              onClick={() => consent && prepare(consent, true)}
            >
              继续并准备
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  );
}

/** Accessible, lazy setup access even when the workspace has not connected yet. */
export function OpenCodeReleaseSetup() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (value || !busy) setOpen(value);
      }}
    >
      <DialogTrigger render={<Button type="button" variant="outline" size="sm" />}>
        OpenCode 发布设置
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>设置本地 OpenCode</DialogTitle>
          <DialogDescription>
            管理已安装的 OpenCode 或准备回退，而不更改共享服务。
            关闭此对话框以使用单独的确认启动或重启操作。
          </DialogDescription>
        </DialogHeader>
        {open ? <LocalOpenCodeRuntimeSettings onBusyChange={setBusy} /> : null}
      </DialogContent>
    </Dialog>
  );
}

/** Share operation locks, not runtime ownership, between installation and release controls. */
export function LocalOpenCodeRuntimeSettings({
  disabled = false,
  onBusyChange,
}: {
  disabled?: boolean;
  onBusyChange?(busy: boolean): void;
}) {
  const [installationBusy, setInstallationBusy] = useState(false);
  const [releaseBusy, setReleaseBusy] = useState(false);
  useEffect(() => {
    onBusyChange?.(installationBusy || releaseBusy);
  }, [installationBusy, releaseBusy, onBusyChange]);
  return (
    <div className="min-w-0 space-y-8">
      <OpenCodeInstallationSettings
        disabled={disabled || releaseBusy}
        onBusyChange={setInstallationBusy}
      />
      <OpenCodeReleaseSettings
        disabled={disabled || installationBusy}
        onBusyChange={setReleaseBusy}
      />
    </div>
  );
}
