import {
  Check,
  CircleAlert,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  Globe2,
  Laptop,
  LoaderCircle,
  Pencil,
  Plus,
  QrCode,
  Server,
  ShieldCheck,
  Trash2,
  WifiOff,
} from "lucide-react";
import { useClipboardCopy } from "../hooks/use-clipboard-copy";
import { useConnectionOverview } from "../hooks/use-connection-overview";
import { useAtom } from "jotai";
import { runtimeAtom } from "../atoms/workspace";
import { SharedOpenCodeAction } from "./opencode-connection-alert";
import { LocalOpenCodeRuntimeSettings } from "./open-code-release-settings";
import { OpenCodeLoginAutostartSettings } from "./open-code-login-autostart-settings";
import { useNavigate } from "@tanstack/react-router";
import QRCode from "qrcode";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  OpenCodeCredentialInput,
  OpenCodePairingInfo,
  OpenCodeProfile,
  OpenCodeProfileCreateInput,
  OpenCodeProfileSnapshot,
  OpenCodeProfileUpdateInput,
  OpenCodeWebAccessInfo,
} from "../../shared";
import { writeClipboardText } from "../lib/clipboard";
import {
  pairingInfoForAddress,
  pairingQRCodePayload,
  suggestedPairingAddress,
} from "../lib/pairing-address";
import { parsePairingText } from "../lib/pairing-import";
import { palot } from "../services/palot";
import { SettingsEmpty, SettingsGroup, SettingsSection } from "./settings-layout";
import { SshConnectionDialog } from "./ssh-connection-dialog";
import { Badge } from "./ui/badge";
import { Button, buttonVariants } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Switch } from "./ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { NativeSelect, NativeSelectOption } from "./ui/native-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Textarea } from "./ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { toast } from "./ui/toast";
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

type ConnectionTab = "profiles" | "web-access" | "local-service";

const TAB_ROUTES: Record<ConnectionTab, string> = {
  profiles: "/settings/connections/profiles",
  "web-access": "/settings/connections/web-access",
  "local-service": "/settings/connections/local-service",
};

export function ConnectionSettings({ tab }: { tab: ConnectionTab }) {
  const navigate = useNavigate();
  const { connections, includedProfileIDs, setIncludedProfileIDs } = useConnectionOverview();
  const [snapshot, setSnapshot] = useState<OpenCodeProfileSnapshot | null>(null);
  const [webAccess, setWebAccess] = useState<OpenCodeWebAccessInfo | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [sshOpen, setSshOpen] = useState(false);
  const [pairOpen, setPairOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<OpenCodeProfile | null>(null);
  const [deleting, setDeleting] = useState<OpenCodeProfile | null>(null);
  const [busyID, setBusyID] = useState<string | null>(null);
  const [accessBusy, setAccessBusy] = useState<"enable" | "disable" | "restart" | null>(null);

  const reload = () => palot.listOpenCodeProfiles().then(setSnapshot);
  const reloadWebAccess = () => palot.openCodeWebAccessInfo().then(setWebAccess);
  useEffect(() => {
    void reload().catch(showError);
  }, []);
  useEffect(() => {
    if (tab !== "profiles") void reloadWebAccess().catch(showError);
  }, [tab]);

  const removeProfile = async (profile: OpenCodeProfile) => {
    setBusyID(profile.id);
    try {
      setSnapshot(await palot.deleteOpenCodeProfile(profile.id));
    } catch (error) {
      showError(error);
    } finally {
      setBusyID(null);
    }
  };

  const updateTailscale = async (enabled: boolean) => {
    setAccessBusy(enabled ? "enable" : "disable");
    try {
      setWebAccess(
        enabled
          ? await palot.enableOpenCodeTailscaleAccess()
          : await palot.disableOpenCodeTailscaleAccess(),
      );
      toast.add({
        type: "success",
        title: enabled ? "OpenCode 已在你的 tailnet 上可用" : "Tailscale 访问已禁用",
      });
    } catch (error) {
      showError(error);
    } finally {
      setAccessBusy(null);
    }
  };

  const restartService = async () => {
    setAccessBusy("restart");
    try {
      await palot.restartLocalOpenCodeService();
      await reloadWebAccess();
      toast.add({ type: "success", title: "本地 OpenCode 服务已重启" });
    } catch (error) {
      showError(error);
    } finally {
      setAccessBusy(null);
    }
  };

  return (
    <Tabs
      value={tab}
      onValueChange={(value) =>
        void navigate({
          to: TAB_ROUTES[value as ConnectionTab],
          search: (previous) => previous,
        })
      }
      className="min-w-0 gap-6"
    >
      <div className="min-w-0 overflow-x-auto p-1">
        <TabsList aria-label="连接设置">
          <TabsTrigger value="profiles">配置</TabsTrigger>
          <TabsTrigger value="web-access">Web 访问</TabsTrigger>
          <TabsTrigger value="local-service">本地服务</TabsTrigger>
        </TabsList>
      </div>

      {tab === "profiles" ? (
        <div className="space-y-8">
          <SettingsSection
            title="服务器"
            description="启用的服务器共享一个工作区。打开任务时会自动使用其服务器。禁用服务器只会断开 Palot 的连接，不会停止服务器。"
            action={
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => setAddOpen(true)}>
                  <Plus className="size-4" /> 添加 HTTP 服务器
                </Button>
                <Button type="button" size="sm" onClick={() => setSshOpen(true)}>
                  <Plus className="size-4" /> 添加 SSH 连接
                </Button>
              </div>
            }
          >
            <SettingsGroup>
              {snapshot?.profiles.map((profile) => {
                const active = profile.id === snapshot.activeProfileID;
                const enabled = includedProfileIDs.includes(profile.id);
                const connection = connections.find((entry) => entry.profile.id === profile.id);
                return (
                  <div
                    key={profile.id}
                    className="grid min-w-0 gap-3 p-4 @lg/settings:grid-cols-[minmax(0,1fr)_auto] @lg/settings:items-center @lg/settings:gap-6"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Server
                          className="size-4 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                        <h3 className="min-w-0 text-sm font-medium wrap-anywhere">
                          {profile.name}
                        </h3>
                        {enabled && connection ? (
                          <Badge variant="secondary">
                            {connection.runtime?.connected
                              ? "已连接"
                              : connection.phase === "loading"
                                ? "连接中…"
                                : "离线"}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 text-compact leading-relaxed text-muted-foreground wrap-anywhere">
                        {profileDescription(profile)}
                      </p>
                      <p className="mt-1 text-meta text-muted-foreground">
                        {profile.kind === "local"
                          ? "本地服务"
                          : profile.kind === "ssh"
                            ? "SSH 隧道 · 断开连接时远程服务保持运行"
                            : "远程服务器"}
                      </p>
                      {profile.kind === "remote" &&
                      profile.urls.some((url) => url.startsWith("http://")) ? (
                        <p className="mt-2 text-compact leading-relaxed text-warning">
                          纯 HTTP 可能会暴露提示词、源码、凭据和终端流量。
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 @lg/settings:justify-end">
                      <div className="flex items-center gap-2 text-compact text-muted-foreground">
                        {enabled ? "已启用" : "已禁用"}
                        <Switch
                          aria-label={`启用 ${profile.name}`}
                          checked={enabled}
                          onCheckedChange={(checked) =>
                            setIncludedProfileIDs((current) =>
                              checked
                                ? [...new Set([...current, profile.id])]
                                : current.filter((id) => id !== profile.id),
                            )
                          }
                        />
                      </div>
                      {profile.id !== "local-default" && !active ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`编辑 ${profile.name}`}
                          disabled={busyID !== null}
                          onClick={() => setEditing(profile)}
                        >
                          <Pencil className="size-4" />
                        </Button>
                      ) : null}
                      {profile.id !== "local-default" && !active ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`删除 ${profile.name}`}
                          disabled={busyID !== null}
                          onClick={() => setDeleting(profile)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
              {!snapshot ? <SettingsEmpty>加载连接中…</SettingsEmpty> : null}
            </SettingsGroup>
          </SettingsSection>

          <SettingsSection
            title="导入连接"
            description="使用一次性配对链接，或从另一台电脑导入旧的 Basic 凭据。"
          >
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                <Plus className="size-4" /> 添加已配对的服务器
              </Button>
            </div>
          </SettingsSection>
        </div>
      ) : null}

      {tab === "web-access" ? (
        <WebAccessSettings
          info={webAccess}
          pairingAvailable={webAccess?.local.pairingAvailable ?? false}
          busy={accessBusy}
          onRefresh={() => void reloadWebAccess().catch(showError)}
          onPair={() => setPairOpen(true)}
          onEnable={() => void updateTailscale(true)}
          onDisable={() => void updateTailscale(false)}
        />
      ) : null}

      {tab === "local-service" ? (
        <LocalServiceSettings
          info={webAccess}
          busy={accessBusy === "restart"}
          onRefresh={() => void reloadWebAccess().catch(showError)}
          onRestart={() => void restartService()}
        />
      ) : null}

      <AddServerDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onSaved={(value) => {
          setSnapshot(value);
          setAddOpen(false);
        }}
      />
      <PairDialog
        open={pairOpen}
        onOpenChange={setPairOpen}
        suggestedAddress={suggestedPairingAddress(webAccess)}
      />
      <ImportPairDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onSaved={(value) => {
          setSnapshot(value);
          setImportOpen(false);
        }}
      />
      <EditServerDialog
        profile={editing?.kind === "ssh" ? null : editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        onSaved={(value) => {
          setSnapshot(value);
          setEditing(null);
        }}
      />
      {sshOpen || editing?.kind === "ssh" ? (
        <SshConnectionDialog
          key={editing?.id ?? "new"}
          profile={editing?.kind === "ssh" ? editing : undefined}
          onClose={() => {
            setSshOpen(false);
            setEditing(null);
          }}
          onSaved={(value) => {
            setSnapshot(value);
            setSshOpen(false);
            setEditing(null);
          }}
        />
      ) : null}
      <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除 {deleting?.name}？</AlertDialogTitle>
            <AlertDialogDescription>
              将从 Palot 中移除此连接配置及其加密凭据。不会
              删除 OpenCode 服务器、会话、认证、配置或项目。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyID !== null}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busyID !== null}
              onClick={() => {
                if (!deleting) return;
                const profile = deleting;
                setDeleting(null);
                void removeProfile(profile);
              }}
            >
              删除连接
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Tabs>
  );
}

function WebAccessSettings({
  info,
  pairingAvailable,
  busy,
  onRefresh,
  onPair,
  onEnable,
  onDisable,
}: {
  info: OpenCodeWebAccessInfo | null;
  pairingAvailable: boolean;
  busy: "enable" | "disable" | "restart" | null;
  onRefresh(): void;
  onPair(): void;
  onEnable(): void;
  onDisable(): void;
}) {
  const local = info?.local;
  const tailscale = info?.tailscale;
  const [publicQr, setPublicQr] = useState<string | null>(null);
  const [showPublicQr, setShowPublicQr] = useState(false);
  useEffect(() => {
    setPublicQr(null);
    setShowPublicQr(false);
  }, [tailscale?.publicUrl]);
  const togglePublicQr = async () => {
    if (showPublicQr) {
      setShowPublicQr(false);
      return;
    }
    if (!tailscale?.publicUrl) return;
    try {
      setPublicQr(
        publicQr ?? (await QRCode.toDataURL(tailscale.publicUrl, { margin: 1, width: 320 })),
      );
      setShowPublicQr(true);
    } catch (error) {
      showError(error);
    }
  };
  return (
    <div className="min-w-0 space-y-8">
      <ConnectionCard
        icon={Laptop}
        title="本机"
        description="在本地浏览器中打开相同的 OpenCode 服务和会话。"
        badge={local?.available ? "可用" : "不可用"}
      >
        {local?.url ? <CodeValue value={local.url} /> : null}
        {local?.reason ? <InlineNotice>{local.reason}</InlineNotice> : null}
        <div className="flex flex-wrap gap-2">
          {local?.url ? (
            <a
              href={local.url}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "default" })}
            >
              <ExternalLink className="size-4" /> 打开 OpenCode 网页
            </a>
          ) : null}
          <Button type="button" variant="outline" disabled={!pairingAvailable} onClick={onPair}>
            <QrCode className="size-4" /> 配对设备
          </Button>
          <Button type="button" variant="ghost" onClick={onRefresh}>
            刷新
          </Button>
        </div>
      </ConnectionCard>

      <ConnectionCard
        icon={Globe2}
        title="Tailscale"
        description="通过 HTTPS 将本地 Web 界面共享给你的 tailnet 所允许的设备。"
        badge={tailscaleBadge(tailscale)}
      >
        {tailscale?.publicUrl && tailscale.serveState === "active" ? (
          <CodeValue value={tailscale.publicUrl} />
        ) : null}
        {tailscale?.serveState === "conflict" ? (
          <InlineNotice>
            Tailscale Serve 已将根 Web 地址用于{" "}
            {tailscale.proxyTarget ?? "其他服务"}。Palot 不会替换它。
          </InlineNotice>
        ) : null}
        {tailscale?.error ? <InlineNotice>{tailscale.error}</InlineNotice> : null}
        {!local?.available ? (
          <InlineNotice>
            Switch to the local OpenCode profile before enabling Tailscale access.
          </InlineNotice>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {tailscale?.serveState === "active" && tailscale.publicUrl ? (
            <a
              href={tailscale.publicUrl}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "default" })}
            >
              <ExternalLink className="size-4" /> Open tailnet URL
            </a>
          ) : null}
          {tailscale?.serveState !== "active" ? (
            <Button
              type="button"
              disabled={
                busy !== null ||
                !local?.available ||
                tailscale?.connectionState !== "connected" ||
                tailscale?.serveState === "conflict"
              }
              onClick={onEnable}
            >
              {busy === "enable" ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />}
              Enable tailnet access
            </Button>
          ) : null}
          {tailscale?.managedByPalot ? (
            <Button type="button" variant="outline" disabled={busy !== null} onClick={onDisable}>
              {busy === "disable" ? <LoaderCircle className="animate-spin" /> : <WifiOff />}
              禁用
            </Button>
          ) : null}
          {tailscale?.serveState === "active" && tailscale.publicUrl ? (
            <Button type="button" variant="outline" onClick={() => void togglePublicQr()}>
              <QrCode /> {showPublicQr ? "隐藏手机 QR" : "显示手机 QR"}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={onRefresh}>
            刷新
          </Button>
        </div>
        {showPublicQr && publicQr ? (
          <div className="w-fit rounded-lg border border-border/70 bg-white p-2">
            <img src={publicQr} alt="Tailscale OpenCode 网址 QR 码" className="size-44" />
          </div>
        ) : null}
        <p className="text-compact leading-relaxed text-muted-foreground">
          OpenCode 保持绑定 loopback。Tailscale 终结 HTTPS 并应用你的 tailnet
          访问规则。不会启用 Funnel 和公网暴露。
        </p>
      </ConnectionCard>
    </div>
  );
}

export function LocalServiceSettings({
  info,
  busy,
  onRefresh,
  onRestart,
}: {
  info: OpenCodeWebAccessInfo | null;
  busy: boolean;
  onRefresh(): void;
  onRestart(): void;
}) {
  const local = info?.local;
  const [runtime, setRuntime] = useAtom(runtimeAtom);
  const [starting, setStarting] = useState(false);
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const startService = async () => {
    setStarting(true);
    try {
      setRuntime(await palot.connectOpenCode({ startLocalService: true }));
      onRefresh();
    } catch (error) {
      setRuntime(await palot.runtimeStatus().catch(() => runtime));
      showError(error);
    } finally {
      setStarting(false);
    }
  };
  return (
    <div className="min-w-0 space-y-8">
      <LocalOpenCodeRuntimeSettings
        disabled={busy || starting || loginBusy}
        onBusyChange={setReleaseBusy}
      />
      <OpenCodeLoginAutostartSettings
        disabled={busy || starting || releaseBusy}
        onBusyChange={setLoginBusy}
      />
      <ConnectionCard
        icon={Server}
        title="共享的 OpenCode 服务"
        description="Palot 和其他本地 OpenCode 客户端使用此后台服务。"
        badge={local?.available ? "已连接" : "不可用"}
      >
        {local?.url ? <CodeValue value={local.url} /> : null}
        <dl className="grid min-w-0 gap-4 text-sm @lg/settings:grid-cols-3">
          <ServiceDatum label="运行中的服务版本" value={local?.version ?? "未知"} />
          <ServiceDatum label="进程" value={local?.pid ? String(local.pid) : "未知"} />
          <ServiceDatum
            label="生命周期"
            value={local?.managed ? "由 Palot 启动" : "共享服务"}
          />
        </dl>
        {local?.reason ? <InlineNotice>{local.reason}</InlineNotice> : null}
        <div className="flex flex-wrap gap-2">
          {!runtime?.connected && runtime?.canStartLocalService ? (
            <SharedOpenCodeAction
              disabled={busy || starting || releaseBusy || loginBusy}
              onConfirm={() => void startService()}
            />
          ) : null}
          <SharedOpenCodeAction
            action="restart"
            disabled={busy || starting || releaseBusy || loginBusy || !local?.restartAvailable}
            onConfirm={onRestart}
          />
          <Button type="button" variant="ghost" onClick={onRefresh}>
            Refresh
          </Button>
        </div>
        <p className="text-compact leading-relaxed text-muted-foreground">
          Palot only connects to an existing shared service by default. Starting or recovering it
          requires confirmation and may interrupt other clients. Persistent hostname, port,
          password, and environment settings remain owned by OpenCode. Login startup only registers
          the installed CLI with your user service manager.
        </p>
      </ConnectionCard>
    </div>
  );
}

function ConnectionCard({
  icon: Icon,
  title,
  description,
  badge,
  children,
}: {
  icon: typeof Server;
  title: string;
  description: string;
  badge: string;
  children: ReactNode;
}) {
  return (
    <SettingsSection
      icon={Icon}
      title={title}
      description={description}
      action={<Badge variant="outline">{badge}</Badge>}
    >
      <SettingsGroup>
        <div className="min-w-0 space-y-4 p-4">{children}</div>
      </SettingsGroup>
    </SettingsSection>
  );
}

function CodeValue({ value }: { value: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <code className="min-w-0 flex-1 py-1 text-code-compact wrap-anywhere">{value}</code>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="复制地址"
        onClick={() => void writeClipboardText(value)}
      >
        <Copy />
      </Button>
    </div>
  );
}

function InlineNotice({ children }: { children: ReactNode }) {
  return (
    <p className="flex min-w-0 items-start gap-2 text-compact leading-relaxed text-muted-foreground">
      <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 wrap-anywhere">{children}</span>
    </p>
  );
}

function ServiceDatum({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-meta text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium wrap-anywhere">{value}</dd>
    </div>
  );
}

function tailscaleBadge(info: OpenCodeWebAccessInfo["tailscale"] | undefined): string {
  if (!info) return "检查中";
  if (info.connectionState === "unavailable") return "未安装";
  if (info.connectionState === "disconnected") return "已断开";
  if (info.serveState === "active")
    return info.managedByPalot ? "由 Palot 共享" : "已共享";
  if (info.serveState === "conflict") return "根地址已被占用";
  return "已连接";
}

function EditServerDialog({
  profile,
  onOpenChange,
  onSaved,
}: {
  profile: OpenCodeProfile | null;
  onOpenChange(open: boolean): void;
  onSaved(snapshot: OpenCodeProfileSnapshot): void;
}) {
  const [name, setName] = useState("");
  const [urls, setUrls] = useState("");
  const [auth, setAuth] = useState<"none" | "basic" | "bearer">("none");
  const [username, setUsername] = useState("opencode");
  const [secret, setSecret] = useState("");
  const [replaceCredential, setReplaceCredential] = useState(false);
  const [allowPlainHttp, setAllowPlainHttp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tested, setTested] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    setName(profile.name);
    setUrls(profile.kind === "remote" ? profile.urls.join("\n") : "");
    setAllowPlainHttp(profile.kind === "remote" && profile.allowPlainHttp);
    setAuth("none");
    setUsername("opencode");
    setSecret("");
    setReplaceCredential(false);
    setTested(null);
  }, [profile]);

  if (!profile || profile.kind !== "remote") return null;
  const remoteUrls = splitUrls(urls);
  const credentialInput = credential(auth, username, secret);
  const update: OpenCodeProfileUpdateInput = {
    id: profile.id,
    kind: "remote",
    name: name.trim(),
    urls: remoteUrls,
    allowPlainHttp,
    ...(replaceCredential ? { credential: credentialInput } : {}),
  };

  const test = async () => {
    setBusy(true);
    setTested(null);
    try {
      const result = await palot.testOpenCodeProfile({
        kind: "remote",
        name: name.trim(),
        urls: remoteUrls,
        credential: replaceCredential ? credentialInput : { type: "none" },
        allowPlainHttp,
      });
      setTested(`OpenCode ${result.version} at ${result.url}`);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      onSaved(await palot.updateOpenCodeProfile(update));
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const canTest = (profile.credentialID === null || replaceCredential) && remoteUrls.length > 0;
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>编辑 OpenCode 服务器</DialogTitle>
          <DialogDescription>
            更改将在下次此配置连接时生效。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="服务器名称"
          />
          <Textarea
            value={urls}
            onChange={(event) => setUrls(event.target.value)}
            rows={3}
            placeholder="每行一个服务器 URL"
          />
          {profile.credentialID ? (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={replaceCredential}
                onCheckedChange={(checked) => {
                  const replacing = checked === true;
                  setReplaceCredential(replacing);
                  if (replacing) setAllowPlainHttp(false);
                }}
              />
              替换已存储的凭据
            </label>
          ) : null}
          {profile.credentialID === null || replaceCredential ? (
            <>
              <Select value={auth} onValueChange={(value) => setAuth(value as typeof auth)}>
                <SelectTrigger aria-label="身份验证">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">无身份验证</SelectItem>
                  <SelectItem value="basic">用户名和密码</SelectItem>
                  <SelectItem value="bearer">Bearer 令牌</SelectItem>
                </SelectContent>
              </Select>
              {auth === "basic" ? (
                <Input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="用户名"
                />
              ) : null}
              {auth !== "none" ? (
                <Input
                  type="password"
                  value={secret}
                  onChange={(event) => setSecret(event.target.value)}
                  placeholder={auth === "bearer" ? "Token" : "密码"}
                />
              ) : null}
            </>
          ) : null}
          {remoteUrls.some((url) => url.startsWith("http://") && !isLoopback(url)) ? (
            <label className="flex items-start gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={allowPlainHttp}
                onCheckedChange={(checked) => setAllowPlainHttp(checked === true)}
              />
              允许纯 HTTP。流量和凭据可能在传输过程中被观察或修改。
            </label>
          ) : null}
          {profile.credentialID && !replaceCredential ? (
            <p className="text-xs text-muted-foreground">
              测试需要替换已存储的凭据；Palot 不会将其返回给渲染器。
            </p>
          ) : null}
          {tested ? (
            <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
              <Check className="size-4" />
              {tested}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || !canTest}
            onClick={() => void test()}
          >
            测试
          </Button>
          <Button
            type="button"
            disabled={busy || !name.trim() || remoteUrls.length === 0}
            onClick={() => void save()}
          >
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddServerDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onSaved(snapshot: OpenCodeProfileSnapshot): void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [auth, setAuth] = useState<"none" | "basic" | "bearer">("none");
  const [username, setUsername] = useState("opencode");
  const [secret, setSecret] = useState("");
  const [allowPlainHttp, setAllowPlainHttp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tested, setTested] = useState<string | null>(null);

  const input = useMemo<OpenCodeProfileCreateInput>(() => {
    return {
      kind: "remote",
      name: name.trim() || new URL(url || "http://localhost").hostname,
      urls: [url],
      credential: credential(auth, username, secret),
      allowPlainHttp,
    };
  }, [allowPlainHttp, auth, name, secret, url, username]);

  const test = async () => {
    setBusy(true);
    setTested(null);
    try {
      const result = await palot.testOpenCodeProfile(input);
      setTested(`OpenCode ${result.version} at ${result.url}`);
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      onSaved(await palot.createOpenCodeProfile(input));
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加 OpenCode 服务器</DialogTitle>
          <DialogDescription>
            远程服务器在服务器机器上运行工具并读取文件。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="服务器名称"
          />
          <Input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="http://192.168.1.40:4096"
          />
          <Select value={auth} onValueChange={(value) => setAuth(value as typeof auth)}>
            <SelectTrigger aria-label="身份验证">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">无身份验证</SelectItem>
              <SelectItem value="basic">用户名和密码</SelectItem>
              <SelectItem value="bearer">Bearer 令牌</SelectItem>
            </SelectContent>
          </Select>
          {auth === "basic" ? (
            <Input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="用户名"
            />
          ) : null}
          {auth !== "none" ? (
            <Input
              type="password"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder={auth === "bearer" ? "Token" : "密码"}
            />
          ) : null}
          {url.trim().toLowerCase().startsWith("http://") && !isLoopback(url) ? (
            <label className="flex items-start gap-2 text-sm text-muted-foreground">
              <Checkbox
                checked={allowPlainHttp}
                onCheckedChange={(checked) => setAllowPlainHttp(checked === true)}
              />
              允许纯 HTTP。流量和凭据可能在传输过程中被观察或修改。
            </label>
          ) : null}
          {tested ? (
            <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
              <Check className="size-4" />
              {tested}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || !url}
            onClick={() => void test()}
          >
            测试
          </Button>
          <Button type="button" disabled={busy || !name.trim() || !url} onClick={() => void save()}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PairDialog({
  open,
  onOpenChange,
  suggestedAddress = null,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  suggestedAddress?: string | null;
}) {
  const [info, setInfo] = useState<OpenCodePairingInfo | null>(null);
  const [address, setAddress] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [loading, setLoading] = useState(false);
  const loadRequest = useRef(0);
  const qrRequest = useRef(0);
  useEffect(() => {
    loadRequest.current += 1;
    qrRequest.current += 1;
    setInfo(null);
    setAddress(suggestedAddress ?? "");
    setQr(null);
    setShowQr(false);
    setRevealed(false);
    setLoading(false);
    return () => {
      loadRequest.current += 1;
      qrRequest.current += 1;
    };
  }, [open, suggestedAddress]);
  useEffect(() => {
    if (!info) return;
    const timeout = window.setTimeout(
      () => {
        qrRequest.current += 1;
        setInfo(null);
        setQr(null);
        setShowQr(false);
        setRevealed(false);
      },
      info.mode === "link" ? info.expiresIn * 1_000 : 60_000,
    );
    return () => window.clearTimeout(timeout);
  }, [info]);
  const pairing = useMemo(() => {
    if (!info) return { info: null, error: null };
    try {
      return { info: pairingInfoForAddress(info, address), error: null };
    } catch (error) {
      return { info: null, error: error instanceof Error ? error.message : "无效地址" };
    }
  }, [info, address]);
  const changeAddress = (value: string) => {
    qrRequest.current += 1;
    setAddress(value);
    setQr(null);
    setShowQr(false);
  };
  const load = async () => {
    const request = ++loadRequest.current;
    setLoading(true);
    try {
      const pairingInfo = await palot.openCodePairingInfo();
      if (request === loadRequest.current) setInfo(pairingInfo);
    } catch (error) {
      if (request === loadRequest.current) showError(error);
    } finally {
      if (request === loadRequest.current) setLoading(false);
    }
  };
  const toggleQr = async () => {
    const request = ++qrRequest.current;
    if (showQr) {
      setShowQr(false);
      setQr(null);
      return;
    }
    if (!pairing.info) return;
    const payload = pairingQRCodePayload(pairing.info);
    if (!payload) return;
    try {
      const image = qr ?? (await QRCode.toDataURL(payload, { margin: 1, width: 320 }));
      if (request === qrRequest.current) {
        setQr(image);
        setShowQr(true);
      }
    } catch (error) {
      if (request === qrRequest.current) showError(error);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>配对设备</DialogTitle>
          <DialogDescription>
            {info?.mode === "link"
              ? "此一次性链接和 QR 码最多 5 分钟后过期，且只能使用一次。兑换时颁发的会话凭据最长可持续 30 天。"
              : info?.mode === "credentials"
                ? "旧的配对 JSON 和 QR 码包含可重复使用的 OpenCode 服务凭据。"
                : "当另一台设备准备好后生成配对详情。"}
          </DialogDescription>
        </DialogHeader>
        {info ? (
          <div className="@container/pairing">
            <div className="grid gap-4 @md/pairing:grid-cols-[minmax(0,1fr)_12rem] @md/pairing:items-center">
              <div className="min-w-0 space-y-3 text-sm">
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="pairing-address">
                    配对地址
                  </label>
                  <Input
                    id="pairing-address"
                    value={address}
                    onChange={(event) => changeAddress(event.target.value)}
                    placeholder="使用服务地址"
                    aria-invalid={Boolean(pairing.error)}
                    aria-describedby="pairing-address-help"
                  />
                  <p id="pairing-address-help" className="text-meta text-muted-foreground">
                    留空则将服务的网络地址（包括活跃的 OpenTunnel 地址）包含在 QR 码中，
                    包括活跃的 OpenTunnel 地址。覆盖地址必须是你控制的 HTTPS 代理。
                    这不会配置代理或暴露服务。
                  </p>
                  {address ? (
                    <Button variant="ghost" size="sm" onClick={() => changeAddress("")}>
                      使用服务地址
                    </Button>
                  ) : suggestedAddress ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => changeAddress(suggestedAddress)}
                    >
                      Use Tailscale address
                    </Button>
                  ) : null}
                  {pairing.error ? (
                    <p role="alert" className="text-meta text-destructive">
                      {pairing.error}
                    </p>
                  ) : null}
                </div>
                {pairing.info?.mode === "link" && !pairingQRCodePayload(pairing.info) ? (
                  <p role="status" className="text-meta text-muted-foreground">
                    Only local addresses are available. Set up a reachable HTTPS address first.
                    OpenCode 2.0.25 supports <code>opencode pair --remote</code> in your terminal;
                    enabling it exposes the service through OpenTunnel and can restart the shared
                    service. Generate new pairing details afterward.
                  </p>
                ) : null}
                {info.mode === "link" ? (
                  <>
                    <p className="text-meta text-muted-foreground">
                      Expires{" "}
                      {info.expiresIn === 300 ? "in 5 minutes" : `in ${info.expiresIn} seconds`}{" "}
                      after generation. Redeeming it creates a longer-lived session credential.
                    </p>
                    {pairing.info ? (
                      <code className="block break-all text-code-compact">
                        {pairing.info.payload}
                      </code>
                    ) : null}
                  </>
                ) : (
                  <>
                    {pairing.info?.urls.map((url) => (
                      <p key={url} className="break-all text-code-compact">
                        {url}
                      </p>
                    ))}
                    <div className="space-y-2">
                      <PairingCredentialRow label="用户名" value={info.username} />
                      <PairingCredentialRow
                        label="密码"
                        value={info.password}
                        concealed={!revealed}
                        onToggleConcealed={() => setRevealed((value) => !value)}
                      />
                    </div>
                  </>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!pairing.info || !pairingQRCodePayload(pairing.info)}
                    onClick={() => void toggleQr()}
                  >
                    <QrCode className="size-4" />
                    {showQr ? "隐藏 QR" : "显示 QR"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!pairing.info}
                    onClick={() => {
                      if (pairing.info)
                        void writeClipboardText(pairing.info.payload).catch(showError);
                    }}
                  >
                    <Copy className="size-4" />
                    {info.mode === "link" ? "复制一次性链接" : "复制配对 JSON"}
                  </Button>
                </div>
              </div>
              {qr && showQr ? (
                <img
                  src={qr}
                  alt={
                    info.mode === "link"
                      ? "OpenCode 一次性配对 QR 码"
                      : "OpenCode 配对 QR 码"
                  }
                  className="w-48 max-w-full justify-self-center rounded-lg bg-white p-2"
                />
              ) : null}
            </div>
          </div>
        ) : (
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              仅在另一台设备准备好后生成。旧的凭据和已兑换的会话可以控制此 OpenCode 服务。
            </p>
            <Button type="button" disabled={loading} onClick={() => void load()}>
              {loading ? "加载中…" : "生成配对详情"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function PairingCredentialRow({
  label,
  value,
  concealed = false,
  onToggleConcealed,
}: {
  label: string;
  value: string;
  concealed?: boolean;
  onToggleConcealed?: () => void;
}) {
  const { copiedKey, copy } = useClipboardCopy();
  const copied = copiedKey === "credential";

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-meta text-muted-foreground">{label}</p>
        <code className="block truncate text-code-compact">
          {concealed ? "••••••••••••" : value}
        </code>
      </div>
      {onToggleConcealed ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`${concealed ? "显示" : "隐藏"}密码`}
          onClick={onToggleConcealed}
        >
          {concealed ? <Eye /> : <EyeOff />}
          {concealed ? "显示" : "隐藏"}
        </Button>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={copied ? `已复制${label}` : `复制${label.toLowerCase()}`}
        onClick={() => void copy(value, "credential")}
      >
        {copied ? <Check /> : <Copy />}
        {copied ? "已复制" : "复制"}
      </Button>
    </div>
  );
}

export function ImportPairDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onSaved(value: OpenCodeProfileSnapshot): void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [allowPlainHttp, setAllowPlainHttp] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState("");
  useEffect(() => {
    if (!open) {
      setText("");
      setAllowPlainHttp(false);
      setSelectedAddress("");
    }
  }, [open]);
  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    try {
      return { value: parsePairingText(text, selectedAddress), error: null };
    } catch (error) {
      return {
        value: null,
        error: error instanceof Error ? error.message : "无效的配对详情",
      };
    }
  }, [text, selectedAddress]);
  const insecure =
    (parsed?.value?.selectedAddress ? [parsed.value.selectedAddress] : parsed?.value?.urls)?.some(
      (url) => url.startsWith("http://") && !isLoopback(url),
    ) ?? false;
  const save = async () => {
    if (!parsed?.value || busy || (insecure && !allowPlainHttp)) return;
    setBusy(true);
    try {
      onSaved(await palot.importOpenCodePairing({ ...parsed.value.input, allowPlainHttp }));
    } catch (error) {
      showError(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (!next) {
          setText("");
          setAllowPlainHttp(false);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>添加已配对的服务器</DialogTitle>
          <DialogDescription>
            粘贴一次性配对 URL、QR 载荷或旧的 Basic 配对 JSON。导入前请查看目标。
            粘贴时不会发送任何内容。
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setAllowPlainHttp(false);
            setSelectedAddress("");
          }}
          disabled={busy}
          aria-label="配对链接或旧的 JSON"
          rows={8}
          placeholder="https://server.example/auth/connect/… 或配对 JSON"
        />
        {parsed?.error ? (
          <p role="alert" className="text-meta text-destructive">
            {parsed.error}
          </p>
        ) : null}
        {parsed?.value ? (
          <div className="space-y-2 rounded-lg border border-border/70 bg-muted/30 p-3 text-meta text-muted-foreground">
            <p>
              {"link" in parsed.value.input
                ? "一次性链接目标"
                : "旧的 Basic 凭据目标"}
            </p>
            {parsed.value.selectedAddress ? (
              <div className="space-y-2">
                <label htmlFor="pairing-import-address">在此地址兑换</label>
                <NativeSelect
                  id="pairing-import-address"
                  className="w-full"
                  value={parsed.value.selectedAddress}
                  disabled={busy}
                  onChange={(event) => {
                    setSelectedAddress(event.target.value);
                    setAllowPlainHttp(false);
                  }}
                >
                  {parsed.value.urls.map((url) => (
                    <NativeSelectOption key={url} value={url}>
                      {url}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <p>
                  只有此地址接收一次性代码。不会自动尝试其他地址。
                </p>
              </div>
            ) : (
              parsed.value.urls.map((url) => (
                <p key={url} className="break-all font-mono">
                  {url}
                </p>
              ))
            )}
          </div>
        ) : null}
        {insecure ? (
          <label className="flex items-start gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={allowPlainHttp}
              disabled={busy}
              onCheckedChange={(checked) => setAllowPlainHttp(checked === true)}
            />
            允许纯 HTTP。配对代码或凭据、提示词、源码和终端流量
            可能在传输过程中被观察或修改。
          </label>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setText("");
              setAllowPlainHttp(false);
              onOpenChange(false);
            }}
          >
            取消
          </Button>
          <Button
            type="button"
            disabled={busy || !parsed?.value || (insecure && !allowPlainHttp)}
            onClick={() => void save()}
          >
            探测并导入
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function credential(
  type: "none" | "basic" | "bearer",
  username: string,
  secret: string,
): OpenCodeCredentialInput {
  if (type === "basic") return { type, username, password: secret };
  if (type === "bearer") return { type, token: secret };
  return { type };
}

function splitUrls(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((url) => url.trim())
    .filter(Boolean);
}

function profileDescription(profile: OpenCodeProfile): string {
  if (profile.kind === "ssh")
    return `${profile.ssh.target}${profile.ssh.port ? ` (port ${profile.ssh.port})` : ""}`;
  if (profile.kind === "remote")
    return profile.lastSuccessfulUrl ?? profile.urls[0] ?? "远程 OpenCode 服务器";
  return "连接到本机上已有的共享 OpenCode 服务。Palot 不会自动启动它。";
}

function isLoopback(value: string): boolean {
  try {
    const hostname = new URL(value).hostname;
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]" ||
      hostname === "::1"
    );
  } catch {
    return false;
  }
}

function showError(error: unknown): void {
  toast.add({
    type: "error",
    title: error instanceof Error ? error.message : "OpenCode 服务器操作失败",
  });
}
