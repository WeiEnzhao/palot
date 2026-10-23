import { useEffect, useId, useRef, useState } from "react";
import type {
  OpenCodeInstallation as Installation,
  OpenCodeInstallationStatus as Status,
  OpenCodeInstallMethod as Method,
} from "../../shared/opencode-installation-contract";
import type { OpenCodeReleaseStatus } from "../../shared/opencode-release-contract";
import { palot } from "../services/palot";
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from "./ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

type Operation = "inspect" | "preference" | "selection" | "check" | "upgrade";
const methods: Method[] = ["auto", "npm", "bun", "pnpm", "yarn", "curl"];

/** Local discovery and explicit official-CLI upgrades; never controls the shared service. */
export function OpenCodeInstallationSettings({
  disabled = false,
  onBusyChange,
}: {
  disabled?: boolean;
  onBusyChange?(busy: boolean): void;
}) {
  const id = useId();
  const [status, setStatus] = useState<Status | null>(null);
  const [release, setRelease] = useState<OpenCodeReleaseStatus | null>(null);
  const [busy, setBusy] = useState<Operation | null>("inspect");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [method, setMethod] = useState<Method>("auto");
  const [consent, setConsent] = useState<{
    installation: Installation;
    offer: NonNullable<OpenCodeReleaseStatus["offer"]>;
  } | null>(null);
  const locked = useRef(false);
  const generation = useRef(0);
  const releaseRequest = useRef(0);
  const installationRequest = useRef(0);

  useEffect(() => {
    onBusyChange?.(busy !== null || consent !== null);
  }, [busy, consent, onBusyChange]);

  async function run(operation: Operation, request: () => Promise<void>) {
    if (locked.current || (disabled && operation !== "inspect")) return;
    locked.current = true;
    installationRequest.current += 1;
    setBusy(operation);
    setError(null);
    setNotice(null);
    const current = generation.current;
    try {
      await request();
    } catch {
      // CLI output can include environment details. Never render raw process output.
      if (current === generation.current)
        setError(
          operation === "upgrade"
            ? "已安装的 OpenCode 更新未能完成。请刷新安装列表以确认版本，或使用官方说明手动更新。"
            : "无法读取或保存 OpenCode 设置。准备好后请重试。",
        );
    } finally {
      if (current === generation.current) {
        locked.current = false;
        setBusy(null);
      }
    }
  }

  useEffect(() => {
    const current = generation.current;
    const loadRelease = () => {
      const request = ++releaseRequest.current;
      void palot
        .openCodeReleaseStatus()
        .then((result) => {
          if (current === generation.current && request === releaseRequest.current)
            setRelease(result);
        })
        .catch(() => {
          if (current === generation.current)
            setError("无法读取首选发布频道。准备好后请检查更新。");
        });
    };
    // Local --version scans and cached release metadata only; no network on mount.
    void run("inspect", async () => {
      const result = await palot.inspectOpenCodeInstallations();
      if (current === generation.current) setStatus(result);
    });
    loadRelease();
    const refreshCached = () => {
      loadRelease();
      const request = ++installationRequest.current;
      void palot
        .openCodeInstallationStatus()
        .then((result) => {
          if (
            current === generation.current &&
            request === installationRequest.current &&
            !locked.current
          )
            setStatus(result);
        })
        .catch(() => {
          if (current === generation.current)
            setError(
              "无法刷新本地安装设置。准备好后请刷新安装列表。",
            );
        });
    };
    window.addEventListener("palot:opencode-release-changed", refreshCached);
    return () => {
      generation.current += 1;
      locked.current = false;
      window.removeEventListener("palot:opencode-release-changed", refreshCached);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected =
    status?.installations.find((item) => item.id === status.selectedID) ??
    status?.installations.find((item) => item.compatible || item.approved) ??
    status?.installations[0];
  const selectedUsable = Boolean(selected && (selected.compatible || selected.approved));
  const blocked = disabled || busy !== null || consent !== null;
  const selectionDisabled = (operation: Operation) =>
    disabled || consent !== null || (busy !== null && busy !== operation);

  return (
    <SettingsSection
      title="本地 OpenCode 运行时"
      description="使用已安装的 OpenCode，或为 Palot 单独下载运行时。"
    >
      <SettingsGroup>
        <div className="min-w-0 space-y-4 p-4">
          {status ? (
            <>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor={`${id}-source`}>运行时来源</FieldLabel>
                  <Select
                    value={status.preference}
                    disabled={selectionDisabled("preference")}
                    readOnly={busy === "preference"}
                    onValueChange={(preference) => {
                      if (preference !== "installed" && preference !== "palot") return;
                      void run("preference", async () => {
                        setStatus(await palot.setOpenCodeRuntimePreference(preference));
                        setNotice(
                          "运行时来源已保存。未下载或重启任何内容。请单独启动或重启服务以应用更改。",
                        );
                      });
                    }}
                  >
                    <SelectTrigger
                      id={`${id}-source`}
                      aria-busy={busy === "preference"}
                      aria-describedby={`${id}-source-help`}
                    >
                      <SelectValue>
                        {status.preference === "installed"
                          ? "已安装的 OpenCode（推荐）"
                          : "Palot 运行时"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="installed">已安装的 OpenCode（推荐）</SelectItem>
                      <SelectItem value="palot">Palot 运行时</SelectItem>
                    </SelectContent>
                  </Select>
                  <FieldDescription id={`${id}-source-help`}>
                    此处选择的是单独确认启动或重启时使用的运行时。
                    不会更改正在运行的服务，也不会全局安装 OpenCode。
                  </FieldDescription>
                </Field>
                {status.installations.length > 1 ? (
                  <Field>
                    <FieldLabel htmlFor={`${id}-installation`}>已安装的 OpenCode</FieldLabel>
                    <Select
                      value={selected?.id ?? ""}
                      disabled={selectionDisabled("selection")}
                      readOnly={busy === "selection"}
                      onValueChange={(value) => {
                        if (!value) return;
                        void run("selection", async () => {
                          setStatus(await palot.selectOpenCodeInstallation(value));
                          setNotice("已选择安装。当前运行的服务未变。");
                        });
                      }}
                    >
                      <SelectTrigger
                        id={`${id}-installation`}
                        aria-busy={busy === "selection"}
                        className="min-w-0 max-w-full"
                      >
                        <SelectValue className="min-w-0">
                          <span className="truncate">
                            {selected
                              ? `${selected.version} · ${selected.path}`
                              : "选择安装"}
                          </span>
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {status.installations.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.version} · {item.path}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                ) : null}
              </FieldGroup>
              {selected ? (
                <dl className="space-y-2 text-sm">
                  <div>
                    <dt className="text-meta text-muted-foreground">已安装的 CLI 版本</dt>
                    <dd className="wrap-anywhere">
                      {selected.version}
                      {selected.compatible
                        ? ""
                        : selected.approved
                          ? " (approved beta)"
                          : " (not compatible)"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-meta text-muted-foreground">已安装的 CLI 路径</dt>
                    <dd className="text-code-compact wrap-anywhere">{selected.path}</dd>
                  </div>
                </dl>
              ) : null}
              {!selectedUsable ? (
                <p className="text-compact text-muted-foreground">
                  {selected
                    ? "所选安装不兼容，当前不可用。"
                    : "未找到已安装的 OpenCode。"}{" "}
                  请使用官方说明安装 OpenCode，然后刷新安装列表，
                  或在下方 OpenCode 版本设置中下载备用版本。Palot 不会自动全局安装 OpenCode。
                </p>
              ) : null}
              {status.error ? (
                <p role="alert" className="text-compact text-muted-foreground">
                  部分安装未能检查。请刷新安装列表或参照官方说明。
                </p>
              ) : null}
            </>
          ) : busy === "inspect" ? (
            <p role="status" className="text-compact text-muted-foreground">
              正在检查本地 OpenCode 安装…
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={blocked}
              onClick={() =>
                void run("inspect", async () => {
                  setStatus(await palot.inspectOpenCodeInstallations());
                })
              }
            >
              Refresh installations
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={blocked}
              onClick={() =>
                void run("check", async () => {
                  setRelease(await palot.checkOpenCodeRelease());
                })
              }
            >
              {busy === "check" ? "检查中…" : "检查更新"}
            </Button>
          </div>
          <p className="text-meta text-muted-foreground">
            更新使用共享的首选频道
            {release ? `：${release.channel === "beta" ? "Beta" : "Stable"}` : ""}。可在下方
            OpenCode 版本中更改。仅在你主动检查时才会执行。
          </p>
          {release?.offer && selected && selectedUsable ? (
            selected.version === release.offer.version ? (
              <p role="status" className="text-compact text-muted-foreground">
                已安装的 OpenCode 是最新版本
              </p>
            ) : (
              <Button
                type="button"
                size="sm"
                disabled={blocked}
                onClick={() => {
                  if (!release.offer || blocked) return;
                  setMethod("auto");
                  setConsent({ installation: selected, offer: release.offer });
                }}
              >
                Update installed OpenCode to {release.offer.version}
              </Button>
            )
          ) : null}
          {busy === "upgrade" ? (
            <p role="status" className="text-compact text-muted-foreground">
              Updating installed OpenCode… This can take several minutes and has a bounded timeout.
              There is no cancel action. The running service will not be restarted.
            </p>
          ) : null}
          {notice ? (
            <p role="status" className="text-compact text-muted-foreground">
              {notice}
            </p>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>OpenCode 安装操作失败</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <a
            href="https://opencode.ai/v2/docs/"
            target="_blank"
            rel="noreferrer"
            className="text-compact underline underline-offset-4"
          >
            OpenCode 官方安装说明
          </a>
        </div>
      </SettingsGroup>
      <AlertDialog
        open={consent !== null}
        onOpenChange={(open) => {
          if (!open) setConsent(null);
        }}
      >
        <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>
              将已安装的 OpenCode 更新到 {consent?.offer.version}？
            </AlertDialogTitle>
            <AlertDialogDescription className="wrap-anywhere">
              将为 {consent?.installation.path} 运行官方 CLI 升级，从{" "}
              {consent?.installation.version} 升至 {consent?.offer.version}。此操作会更改
              Palot 之外的安装，可能耗时数分钟。不会重启共享服务。
              请单独重启以应用更改。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {consent?.offer.requiresConfirmation ? (
            <Alert>
              <AlertTitle>未经测试的发布版本</AlertTitle>
              <AlertDescription>
                此 {consent.offer.channel === "beta" ? "Beta" : "Stable"} 版本尚未
                在 Palot 中测试。不保证兼容性，部分功能可能无法正常工作。
                仅在你能接受此风险时确认。
              </AlertDescription>
            </Alert>
          ) : null}
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`${id}-method`}>安装方式</FieldLabel>
              <Select
                value={method}
                onValueChange={(value) => {
                  if (methods.includes(value as Method)) setMethod(value as Method);
                }}
              >
                <SelectTrigger id={`${id}-method`} aria-describedby={`${id}-method-help`}>
                  <SelectValue>
                    {method === "auto" ? "自动（官方 CLI 检测）" : method}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {methods.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value === "auto" ? "自动（官方 CLI 检测）" : value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription id={`${id}-method-help`}>
                自动模式使用官方 CLI 的包管理器检测，不针对特定安装路径。
                如果存在多个安装，可能会更新到其他安装。
                如需可更改此方式，或使用官方说明手动更新。
              </FieldDescription>
            </Field>
          </FieldGroup>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={disabled || busy !== null}
              onClick={() => {
                if (!consent || locked.current || disabled) return;
                const target = consent;
                setConsent(null);
                void run("upgrade", async () => {
                  const result = await palot.upgradeOpenCodeInstallation({
                    id: target.installation.id,
                    currentVersion: target.installation.version,
                    version: target.offer.version,
                    method,
                    ...(target.offer.requiresConfirmation ? { allowUntested: true } : {}),
                  });
                  setStatus(result);
                  setNotice(
                    "已安装的 OpenCode 更新完成。当前运行的服务未变。请单独重启以应用更改。",
                  );
                });
              }}
            >
              确认更新已安装的版本
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  );
}
