import { useEffect, useRef, useState } from "react";
import type { OpenCodeInstallation } from "../../shared/opencode-installation-contract";
import type { OpenCodeLoginStatus } from "../../shared/opencode-login-contract";
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
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

export function OpenCodeLoginAutostartSettings({
  disabled = false,
  onBusyChange,
}: {
  disabled?: boolean;
  onBusyChange?(busy: boolean): void;
}) {
  const [status, setStatus] = useState<OpenCodeLoginStatus | null>(null);
  const [busy, setBusy] = useState<"status" | "inspect" | "save" | null>("status");
  const [consent, setConsent] = useState<"enable" | "disable" | null>(null);
  const [installations, setInstallations] = useState<OpenCodeInstallation[]>([]);
  const [selectedID, setSelectedID] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const locked = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    onBusyChange?.(busy !== null || consent !== null);
  }, [busy, consent, onBusyChange]);

  async function refresh() {
    if (locked.current) return;
    locked.current = true;
    const current = generation.current;
    setBusy("status");
    setError(null);
    setNotice(null);
    try {
      const result = await palot.getOpenCodeLoginStatus();
      if (current === generation.current) setStatus(result);
    } catch {
      if (current === generation.current) {
        setStatus(null);
        setError(
          "Could not read login startup. Check that your user service manager is available, then refresh status.",
        );
      }
    } finally {
      if (current === generation.current) {
        locked.current = false;
        setBusy(null);
      }
    }
  }

  useEffect(() => {
    // Only read manager state here. Executable inspection requires an explicit enable action.
    void refresh();
    return () => {
      generation.current += 1;
      locked.current = false;
    };
  }, []);

  const conflict = Boolean(status && !status.owned && (status.enabled || status.running));
  const canChange = Boolean(status?.supported && !conflict && !status.reason);
  const selected = installations.find((installation) => installation.id === selectedID);
  const blocked = disabled || busy !== null || consent !== null;

  async function requestEnable() {
    if (locked.current || disabled || !canChange) return;
    locked.current = true;
    const current = generation.current;
    setConsent("enable");
    setBusy("inspect");
    setError(null);
    setNotice(null);
    setInstallations([]);
    setSelectedID(null);
    try {
      const result = await palot.inspectOpenCodeInstallations();
      if (current !== generation.current) return;
      if (result.error) {
        setError(
          "Could not inspect installed OpenCode CLIs. Check the Installed OpenCode settings, then try enabling again.",
        );
        return;
      }
      const eligible = result.installations.filter((item) => item.compatible || item.approved);
      setInstallations(eligible);
      setSelectedID(
        eligible.find((item) => item.id === result.selectedID)?.id ?? eligible[0]?.id ?? null,
      );
    } catch {
      if (current === generation.current)
        setError(
          "Could not inspect installed OpenCode CLIs. Check the Installed OpenCode settings, then try enabling again.",
        );
    } finally {
      if (current === generation.current) {
        locked.current = false;
        setBusy(null);
      }
    }
  }

  async function save() {
    if (locked.current || disabled || !canChange || !consent) return;
    const enabled = consent === "enable";
    if (enabled && !selected) return;
    locked.current = true;
    const current = generation.current;
    setBusy("save");
    setError(null);
    try {
      const result = await palot.updateOpenCodeLogin(
        enabled && selected
          ? { enabled: true, installationID: selected.id, version: selected.version }
          : { enabled: false },
      );
      if (current !== generation.current) return;
      setStatus(result);
      if (result.supported && result.enabled === enabled && (!enabled || result.owned)) {
        setNotice(
          enabled
            ? "登录启动已为后续登录启用。运行中的服务不受影响。"
            : "登录启动已为后续登录禁用。任何运行中的服务继续运行。",
        );
      } else {
        setError(
          "Could not verify the login startup change. Check your user service manager, then refresh status before trying again.",
        );
      }
    } catch {
      if (current === generation.current) {
        // Never retry an old executable/version confirmation after a failed update.
        setStatus(null);
        setError(
          "Could not change login startup. Refresh status and review the installation again; it may have changed or the user service manager may be unavailable.",
        );
      }
    } finally {
      if (current === generation.current) {
        setConsent(null);
        setInstallations([]);
        setSelectedID(null);
        locked.current = false;
        setBusy(null);
      }
    }
  }

  return (
    <SettingsSection
      title="登录时启动 OpenCode"
      description="登录时运行本地 OpenCode 服务，独立于 Palot。这不会打开 Palot 窗口。"
      action={
        <Badge variant="outline">
          {!status
            ? busy === "status"
              ? "Checking"
              : "Unknown"
            : !status.supported
              ? "Unavailable"
              : conflict
                ? "Managed elsewhere"
                : status.enabled
                  ? "Enabled"
                  : "Disabled"}
        </Badge>
      }
    >
      <SettingsGroup>
        <div className="min-w-0 space-y-4 p-4">
          <p className="text-compact leading-relaxed text-muted-foreground">
            {status?.manager === "systemd"
              ? "Uses a systemd user service on Linux."
              : status?.manager === "launchd"
                ? "Uses a LaunchAgent on macOS."
                : "Uses a systemd user service on Linux or a LaunchAgent on macOS."}{" "}
            No administrator access is needed. Startup is at login, never at boot before you sign
            in.
          </p>
          {status?.binaryPath ? (
            <div className="min-w-0">
              <p className="text-meta text-muted-foreground">已配置的可执行文件</p>
              <code className="block text-code-compact wrap-anywhere">{status.binaryPath}</code>
            </div>
          ) : null}
          {status?.supported ? (
            <p className="text-compact text-muted-foreground">
              User service manager:{" "}
              {status.running
                ? `Running${status.pid ? ` (process ${status.pid})` : ""}`
                : "Not running"}
              . The shared service may run separately.
            </p>
          ) : null}
          {status?.reason || conflict || (status && !status.supported) ? (
            <Alert>
              <AlertTitle>
                {conflict
                  ? "Existing startup configuration is not owned by Palot"
                  : "Login startup unavailable"}
              </AlertTitle>
              <AlertDescription>
                {status?.reason ??
                  (conflict
                    ? "Palot will not replace or remove another startup configuration. Review it in your user service manager, then refresh status."
                    : "Use a Linux login session with systemd user services or macOS with LaunchAgents, then refresh status.")}
              </AlertDescription>
            </Alert>
          ) : null}
          {error && !consent ? (
            <Alert variant="destructive">
              <AlertTitle>登录启动操作失败</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {notice ? (
            <p role="status" className="text-compact text-muted-foreground">
              {notice}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={blocked || !canChange}
              onClick={() => {
                if (status?.enabled) {
                  setError(null);
                  setNotice(null);
                  setConsent("disable");
                } else void requestEnable();
              }}
            >
              {status?.enabled ? "禁用登录自启动" : "启用登录自启动"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={blocked}
              onClick={() => void refresh()}
            >
              刷新状态
            </Button>
          </div>
          <p className="text-compact leading-relaxed text-muted-foreground">
            变更仅影响未来的登录，不会启动、重启或停止正在运行的服务。
            需要时请使用独立的共享服务启动或重启操作。如果已有其他守护进程在运行，
            可能需要先手动停止，用户服务管理器才能接管。
          </p>
        </div>
      </SettingsGroup>
      <AlertDialog
        open={consent !== null}
        onOpenChange={(open) => {
          if (!open && !locked.current) {
            setConsent(null);
            setError(null);
          }
        }}
      >
        <AlertDialogContent className="max-h-[calc(100%-2rem)] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {consent === "disable"
                ? "Disable OpenCode login startup?"
                : "Enable OpenCode login startup?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {consent === "disable"
                ? "This prevents startup at future logins. It does not stop the running service or open or close Palot."
                : "This registers the installed CLI below for future logins without opening Palot. It does not start or replace the running service now."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {consent === "enable" ? (
            <div className="min-w-0 space-y-3">
              {busy === "inspect" ? (
                <p role="status" className="text-compact text-muted-foreground">
                  Inspecting installed OpenCode…
                </p>
              ) : null}
              {installations.length > 1 ? (
                <Select
                  value={selectedID}
                  disabled={disabled || busy !== null}
                  onValueChange={setSelectedID}
                >
                  <SelectTrigger aria-label="OpenCode 安装">
                    <SelectValue>
                      {selected ? `OpenCode ${selected.version}` : "Choose installation"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {installations.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        OpenCode {item.version} · {item.launchPath ?? item.path}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              {selected ? (
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-medium">
                    OpenCode {selected.version}
                    {selected.approved && !selected.compatible ? " (approved beta)" : ""}
                  </p>
                  <code className="block text-code-compact wrap-anywhere">
                    {selected.launchPath ?? selected.path}
                  </code>
                </div>
              ) : busy !== "inspect" && !error ? (
                <p className="text-compact text-muted-foreground">
                  No compatible or approved installed CLI was found. Install a supported OpenCode
                  CLI, or approve an installed beta in Installed OpenCode, then try again. Palot's
                  bundled fallback is not used for login startup.
                </p>
              ) : null}
            </div>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>安装检查失败</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                disabled || busy !== null || !canChange || (consent === "enable" && !selected)
              }
              onClick={() => void save()}
            >
              {busy === "save"
                ? "保存中…"
                : consent === "disable"
                  ? "确认禁用"
                  : "确认启用"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  );
}
