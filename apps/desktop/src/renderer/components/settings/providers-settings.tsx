import type { LocationRef } from "@opencode/client";
import {
  ArrowRight,
  Cable,
  Ellipsis,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  Trash2,
  Unplug,
} from "lucide-react";
import { useAtomValue } from "jotai";
import { useState } from "react";
import type {
  PalotIntegration,
  PalotIntegrationConnection,
  PalotProject,
  PalotSettingsSnapshot,
} from "../../../shared";
import { modelPickerPreferencesAtom } from "../../atoms/ui";
import { useSettingsOwner } from "../../hooks/use-settings-owner";
import { cn } from "../../lib/cn";
import {
  modelPreferenceKey,
  modelProjectPreferenceKey,
  reconcileModelPreference,
} from "../../lib/model-preferences";
import { isPopularProvider, orderProviderIntegrations } from "../../lib/provider-presentation";
import { palot } from "../../services/palot";
import { useArmedConfirm } from "../pull-requests/use-armed-confirm";
import { ProviderConnectionDialog } from "../provider-connection-dialog";
import {
  SettingsDisclosure,
  SettingsEmpty,
  SettingsGroup,
  SettingsNotice,
  SettingsRow,
  SettingsSection,
} from "../settings-layout";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Badge } from "../ui/badge";
import { Banner } from "../ui/banner";
import { Button } from "../ui/button";
import { CopyField } from "../ui/copy-field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Input } from "../ui/input";
import { ProviderIcon } from "../ui/provider-icon";
import { toast } from "../ui/toast";
import {
  PROVIDER_SOURCE_DESCRIPTION,
  PROVIDER_SOURCE_LABEL,
  connectable,
  connectedProviderEntries,
  envNames,
  providerPolicy,
  type ProviderEntry,
} from "./provider-model-data";
import { useModelProviderLinks } from "./settings-links";

const COLLAPSED_PROVIDER_COUNT = 8;
/** Disconnecting reads a sentence first, so it stays armed a little longer than row actions. */
const DISCONNECT_ARMED_MS = 5_000;

type CredentialActionTarget = {
  integration: PalotIntegration;
  connection: PalotIntegrationConnection;
};

type LocationInput = {
  connectionID: string | undefined;
  projectID: string;
  directory: string;
  workspaceID?: string;
};

export function ProviderSettings({
  project,
  location,
  snapshot,
  refresh,
}: {
  project: PalotProject;
  location: LocationRef;
  snapshot: PalotSettingsSnapshot | null;
  refresh(): Promise<void>;
}) {
  const owner = useSettingsOwner();
  const links = useModelProviderLinks(project.id);
  const preferences = useAtomValue(modelPickerPreferencesAtom);
  const [dialog, setDialog] = useState<PalotIntegration | null>(null);
  const [wellknownOpen, setWellknownOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [providerQuery, setProviderQuery] = useState("");
  const [busyCredentialID, setBusyCredentialID] = useState<string | null>(null);
  const [disconnectingID, setDisconnectingID] = useState<string | null>(null);
  const [removing, setRemoving] = useState<CredentialActionTarget | null>(null);
  const [rename, setRename] = useState<{
    integrationName: string;
    credentialID: string;
    label: string;
  } | null>(null);
  const integrations = snapshot?.integrations ?? [];
  const configSources = snapshot?.configSources ?? [];
  const models = snapshot?.catalog.models ?? [];
  const hidden = new Set(
    reconcileModelPreference(
      models,
      preferences[modelProjectPreferenceKey(owner?.profileID ?? "disconnected", project.id)],
    ).hidden,
  );
  const entries = connectedProviderEntries({
    integrations,
    providers: snapshot?.catalog.providers ?? [],
    configSources,
  });
  const connectedIDs = new Set(entries.map((entry) => entry.id));
  const normalizedQuery = providerQuery.trim().toLowerCase();
  const matches = (name: string, id: string) =>
    !normalizedQuery || `${name} ${id}`.toLowerCase().includes(normalizedQuery);
  const available = orderProviderIntegrations(integrations).filter(
    (integration) => !connectedIDs.has(integration.id) && matches(integration.name, integration.id),
  );
  const popular = available
    .filter((integration) => isPopularProvider(integration.id))
    .slice(0, COLLAPSED_PROVIDER_COUNT);
  const browsing = expanded || Boolean(normalizedQuery);
  const visibleAvailable = browsing ? available : popular;
  const connectedMatches = normalizedQuery
    ? entries.filter((entry) => matches(entry.name, entry.id))
    : [];
  const storedCredentialCount = integrations.reduce(
    (count, integration) =>
      count +
      integration.connections.filter((connection) => connection.type === "credential").length,
    0,
  );
  const integrationsError = snapshot?.errors.find((error) => error.capability === "integrations");
  const locationInput: LocationInput = {
    connectionID: owner?.connectionID,
    projectID: project.id,
    directory: location.directory,
    ...(location.workspaceID ? { workspaceID: location.workspaceID } : {}),
  };

  async function activate(connection: PalotIntegrationConnection) {
    if (!connection.id || connection.active) return;
    setBusyCredentialID(connection.id);
    try {
      await palot.activateCredential({ ...locationInput, credentialID: connection.id });
      await refresh();
      toast.add({ type: "success", title: `${connection.label} 现已启用` });
    } catch (cause) {
      showError("无法切换凭据", cause);
    } finally {
      setBusyCredentialID(null);
    }
  }

  async function removeCredential(target: CredentialActionTarget) {
    if (!target.connection.id) return;
    const credentialID = target.connection.id;
    setRemoving(null);
    setBusyCredentialID(credentialID);
    try {
      await palot.removeCredential({ ...locationInput, credentialID });
      await refresh();
      toast.add({ type: "success", title: `${target.connection.label} 已移除` });
    } catch (cause) {
      showError("无法移除凭据", cause);
    } finally {
      setBusyCredentialID(null);
    }
  }

  async function disconnect(entry: ProviderEntry) {
    const credentials = (entry.integration?.connections ?? []).filter(
      (connection): connection is PalotIntegrationConnection & { id: string } =>
        connection.type === "credential" && Boolean(connection.id),
    );
    if (credentials.length === 0) return;
    setDisconnectingID(entry.id);
    try {
      for (const credential of credentials) {
        await palot.removeCredential({ ...locationInput, credentialID: credential.id });
      }
      toast.add({ type: "success", title: `${entry.name} 已断开` });
    } catch (cause) {
      showError(`无法断开 ${entry.name}`, cause);
    } finally {
      await refresh().catch(() => undefined);
      setDisconnectingID(null);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <SettingsSection
        title="已连接的提供者"
        description="凭据归属于本 OpenCode 服务，并被连接到该服务的所有项目共享。"
        icon={Cable}
        action={
          <>
            <Badge variant="outline">
              {entries.length} 个已连接 · {storedCredentialCount} 个已存储
            </Badge>
            {links.available ? (
              <Button type="button" variant="outline" size="sm" onClick={() => links.openModels()}>
                选择模型
                <ArrowRight data-icon="inline-end" aria-hidden="true" />
              </Button>
            ) : null}
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {integrationsError ? (
            <SettingsNotice
              status="error"
              title={
                integrations.length ? "无法刷新提供者" : "无法加载提供者"
              }
            >
              {integrationsError.message}
            </SettingsNotice>
          ) : null}
          {entries.map((entry) => {
            const owned = new Set(entry.providers.map((provider) => provider.id));
            const providerModels = models.filter((model) => owned.has(model.providerID));
            return (
              <ConnectedProviderCard
                key={entry.id}
                entry={entry}
                shownModels={
                  providerModels.filter((model) => !hidden.has(modelPreferenceKey(model))).length
                }
                totalModels={providerModels.length}
                busyCredentialID={busyCredentialID}
                disconnecting={disconnectingID === entry.id}
                onOpenModels={links.available ? () => links.openModels(entry.id) : undefined}
                onActivate={(connection) => void activate(connection)}
                onConnect={() => entry.integration && setDialog(entry.integration)}
                onRename={(connection) =>
                  setRename({
                    integrationName: entry.name,
                    credentialID: connection.id!,
                    label: connection.label,
                  })
                }
                onRemove={(connection) =>
                  entry.integration && setRemoving({ integration: entry.integration, connection })
                }
                onDisconnect={() => void disconnect(entry)}
              />
            );
          })}
          {entries.length === 0 && !integrationsError ? (
            <SettingsGroup>
              <SettingsEmpty>
                {snapshot
                  ? "尚未有提供者连接到此 OpenCode 服务。请在下方添加一个。"
                  : "提供者不可用。请在 OpenCode 连接后刷新设置。"}
              </SettingsEmpty>
            </SettingsGroup>
          ) : null}
        </div>
      </SettingsSection>

      <SettingsSection
        title="添加提供者"
        description="在 OpenCode 启动前登录、添加 API 密钥或设置环境变量。"
        icon={Plus}
        action={
          expanded || available.length > popular.length ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={expanded}
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded ? "仅看常用" : "浏览全部"}
            </Button>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-3">
          <div className="relative min-w-0">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={providerQuery}
              placeholder="搜索提供者"
              aria-label="搜索提供者"
              className="h-8 pl-8"
              onChange={(event) => setProviderQuery(event.target.value)}
            />
          </div>
          {connectedMatches.length > 0 ? (
            <p className="text-meta text-muted-foreground">
              已连接：{connectedMatches.map((entry) => entry.name).join(", ")}
            </p>
          ) : null}
          {visibleAvailable.length > 0 ? (
            <div
              role="list"
              aria-label={browsing ? "可用提供者" : "常用提供者"}
              className="grid gap-px overflow-hidden rounded-xl border border-border bg-border @3xl/settings:grid-cols-2"
            >
              {visibleAvailable.map((integration, index) => (
                <AvailableProviderRow
                  key={integration.id}
                  integration={integration}
                  blocked={providerPolicy(configSources, integration.id)?.effect === "deny"}
                  className={cn(
                    visibleAvailable.length % 2 === 1 &&
                      index === visibleAvailable.length - 1 &&
                      "@3xl/settings:col-span-2",
                  )}
                  onConnect={() => setDialog(integration)}
                />
              ))}
            </div>
          ) : (
            <SettingsGroup>
              <SettingsEmpty>
                {!snapshot
                  ? "提供者不可用。请在 OpenCode 连接后刷新设置。"
                  : normalizedQuery
                    ? "没有其他提供者匹配此搜索。"
                    : available.length > 0
                      ? "所有常用提供者均已连接。浏览全部提供者可添加更多。"
                      : "OpenCode 未返回其他提供者集成。"}
              </SettingsEmpty>
            </SettingsGroup>
          )}
          {!browsing && available.length > visibleAvailable.length ? (
            <p className="text-meta text-muted-foreground">
              还有 {available.length - visibleAvailable.length} 个更多提供者，包括通过环境变量连接的，位于「浏览全部」下。
            </p>
          ) : null}
        </div>
      </SettingsSection>

      <SettingsDisclosure
        title="高级提供者来源"
        description="从受信任的知名 URL 添加自定义集成目录。大多数提供者不需要此功能。"
      >
        <SettingsRow
          title="自定义集成目录"
          description="OpenCode 会获取并保留此来源发布的集成。它们会显示在上方列表中。"
          control={
            <Button type="button" variant="outline" onClick={() => setWellknownOpen(true)}>
              <Plus data-icon="inline-start" aria-hidden="true" />
              添加来源
            </Button>
          }
        />
        <SettingsNotice inGroup status="neutral">
          OpenCode 不会列出已添加的来源，因此 Palot 无法在此处显示或移除它们。
        </SettingsNotice>
      </SettingsDisclosure>

      <ProviderConnectionDialog
        key={`connect:${dialog?.id ?? "closed"}`}
        integration={dialog}
        projectID={project.id}
        location={location}
        onOpenChange={(open) => !open && setDialog(null)}
        onComplete={refresh}
      />
      <WellknownIntegrationDialog
        open={wellknownOpen}
        locationInput={locationInput}
        onOpenChange={setWellknownOpen}
        onComplete={refresh}
      />
      <CredentialLabelDialog
        key={`rename:${rename?.credentialID ?? "closed"}`}
        credential={rename}
        locationInput={locationInput}
        onOpenChange={(open) => !open && setRename(null)}
        onComplete={refresh}
      />
      <AlertDialog open={Boolean(removing)} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>移除「{removing?.connection.label}」？</AlertDialogTitle>
            <AlertDialogDescription>
              {removing ? credentialRemovalDescription(removing) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyCredentialID !== null}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busyCredentialID !== null}
              onClick={() => removing && void removeCredential(removing)}
            >
              移除凭据
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ConnectedProviderCard({
  entry,
  shownModels,
  totalModels,
  busyCredentialID,
  disconnecting,
  onOpenModels,
  onActivate,
  onConnect,
  onRename,
  onRemove,
  onDisconnect,
}: {
  entry: ProviderEntry;
  shownModels: number;
  totalModels: number;
  busyCredentialID: string | null;
  disconnecting: boolean;
  onOpenModels?: () => void;
  onActivate(connection: PalotIntegrationConnection): void;
  onConnect(): void;
  onRename(connection: PalotIntegrationConnection): void;
  onRemove(connection: PalotIntegrationConnection): void;
  onDisconnect(): void;
}) {
  const connections = entry.integration?.connections ?? [];
  const credentials = connections.filter((connection) => connection.type === "credential");
  const environment = connections.filter((connection) => connection.type === "env");
  const confirmDisconnect = useArmedConfirm(onDisconnect, DISCONNECT_ARMED_MS);
  const summary =
    [
      credentials.length
        ? `${credentials.length} 个已存储凭据${credentials.length === 1 ? "" : ""}`
        : null,
      environment.length
        ? `${environment.length} 个环境变量回退${environment.length === 1 ? "" : ""}`
        : null,
    ]
      .filter(Boolean)
      .join(" · ") || PROVIDER_SOURCE_DESCRIPTION[entry.source];
  const off = Boolean(entry.blocked) || entry.disabled;
  const modelCount =
    totalModels > 0 ? `${shownModels} / ${totalModels} 个模型已显示` : "无可用模型";
  const remains = [
    environment.length
      ? `${entry.name} 将回退到环境中的 ${environment[0]!.label}`
      : null,
    entry.source === "config" ? "其 OpenCode 配置定义保留" : null,
  ].filter(Boolean);

  return (
    <article
      className="overflow-hidden rounded-xl border border-border bg-card"
      aria-label={`${entry.name} 连接`}
      data-source={entry.source}
    >
      <header className="flex flex-wrap items-start gap-3 p-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted/55 text-foreground">
          <ProviderIcon id={entry.id} className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-sm font-semibold wrap-anywhere">{entry.name}</h3>
            <Badge variant="outline" size="sm" title={PROVIDER_SOURCE_DESCRIPTION[entry.source]}>
              {PROVIDER_SOURCE_LABEL[entry.source]}
            </Badge>
            {off ? (
              <Badge variant="warning" size="sm">
                已被配置禁用
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-compact text-muted-foreground">{summary}</p>
          {off ? null : onOpenModels ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="mt-1 h-auto px-0"
              onClick={onOpenModels}
            >
              {modelCount}
            </Button>
          ) : (
            <p className="mt-1 text-meta text-muted-foreground">{modelCount}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          {entry.integration && connectable(entry.integration) ? (
            <Button type="button" variant="outline" size="sm" onClick={onConnect}>
              <Plus data-icon="inline-start" aria-hidden="true" />
              添加凭据
            </Button>
          ) : null}
          {credentials.length > 0 ? (
            <Button
              type="button"
              variant={confirmDisconnect.armed ? "destructive" : "ghost"}
              size="sm"
              disabled={disconnecting}
              {...confirmDisconnect.buttonProps}
            >
              {disconnecting ? (
                <LoaderCircle
                  className="animate-spin"
                  data-icon="inline-start"
                  aria-hidden="true"
                />
              ) : (
                <Unplug data-icon="inline-start" aria-hidden="true" />
              )}
              {confirmDisconnect.armed ? "确认断开" : "断开"}
            </Button>
          ) : null}
        </div>
      </header>
      {/* Kept mounted so the notice collapses with its exit motion when disarmed. */}
      <div className="px-4">
        <Banner
          status="warning"
          open={confirmDisconnect.armed}
          title={`断开 ${entry.name}？`}
          className="mb-3"
        >
          这将从此 OpenCode 服务中移除 {credentials.length} 个已存储凭据
          {credentials.length === 1 ? "" : ""}。{remains.length
            ? `${capitalize(remains.join("，并"))}。`
            : "环境变量和 OpenCode 配置不会被更改。"}{" "}
          点击「确认断开」继续。
        </Banner>
      </div>
      {off ? (
        <div className="px-4 pb-3">
          <Banner status="warning" title="已被配置禁用">
            {entry.blocked
              ? `${entry.blocked.path ?? "OpenCode 配置"} 中的 provider.use 拒绝策略（${entry.blocked.resource}）关闭了 ${entry.name}。其凭据仍已存储；移除该策略即可再次使用。`
              : `OpenCode 配置关闭了 ${entry.name}。其凭据仍已存储。`}
          </Banner>
        </div>
      ) : null}
      {connections.length > 0 ? (
        <div className="divide-y divide-border/60 border-t border-border/60 bg-muted/10">
          {connections.map((connection) => {
            const selectable = connection.type === "credential" && !connection.active;
            const busy = connection.id !== null && connection.id === busyCredentialID;
            return (
              <div
                key={connection.id ?? `${connection.type}:${connection.label}`}
                role="group"
                aria-label={`${connection.label} 连接`}
                className="grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3"
              >
                <span
                  className={cn(
                    "size-2.5 shrink-0",
                    connection.type === "env" ? "rotate-45 rounded-[2px]" : "rounded-full",
                    connection.active
                      ? "bg-primary ring-2 ring-primary/15"
                      : "border border-muted-foreground/45 bg-background",
                  )}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn(
                        "text-sm font-medium wrap-anywhere",
                        connection.type === "env" && "font-mono text-code-compact",
                      )}
                    >
                      {connection.label}
                    </span>
                    {connection.active ? <Badge variant="secondary">使用中</Badge> : null}
                  </div>
                  <p className="mt-1 text-compact text-muted-foreground">
                    {connection.type === "credential"
                      ? connectionMethodLabel(connection)
                      : connection.active
                        ? "环境变量"
                        : "环境变量回退 · 在已存储凭据被移除时使用"}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {selectable ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busyCredentialID !== null || disconnecting}
                      onClick={() => onActivate(connection)}
                    >
                      {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
                      使用
                    </Button>
                  ) : null}
                  {connection.type === "credential" && connection.id ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`管理 ${connection.label}`}
                            disabled={busy || disconnecting}
                          />
                        }
                      >
                        <Ellipsis aria-hidden="true" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onClick={() => onRename(connection)}>
                          <Pencil aria-hidden="true" />
                          重命名
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => onRemove(connection)}
                        >
                          <Trash2 aria-hidden="true" />
                          移除凭据
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </article>
  );
}

function AvailableProviderRow({
  integration,
  blocked,
  className,
  onConnect,
}: {
  integration: PalotIntegration;
  blocked: boolean;
  className?: string;
  onConnect(): void;
}) {
  const names = envNames(integration);
  const canConnect = connectable(integration);
  return (
    <div
      role="listitem"
      aria-label={integration.name}
      className={cn("flex min-w-0 flex-col gap-3 bg-card p-4", className)}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted/50 text-foreground">
          <ProviderIcon id={integration.id} className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium wrap-anywhere">{integration.name}</span>
            {blocked ? (
              <Badge variant="warning" size="sm">
                已被配置禁用
              </Badge>
            ) : null}
          </div>
          <div className="font-mono text-code-compact wrap-anywhere text-muted-foreground">
            {integration.id}
          </div>
        </div>
        {canConnect ? (
          <Button type="button" variant="ghost" size="sm" onClick={onConnect}>
            连接
          </Button>
        ) : null}
      </div>
      {!canConnect && names.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-meta text-muted-foreground">
            在 OpenCode 运行处{names.length === 1 ? "设置此变量" : "设置以下变量之一"}，然后重启。
          </p>
          {names.map((name) => (
            <CopyField key={name} value={name} valueName={`${name} 变量名`} />
          ))}
        </div>
      ) : canConnect && names.length > 0 ? (
        <p className="text-meta text-muted-foreground">
          或在 OpenCode 运行处设置 <span className="font-mono text-code-compact">{names.join(", ")}</span>。
        </p>
      ) : !canConnect ? (
        <p className="text-meta text-muted-foreground">
          Palot 无法连接此提供者。请在 OpenCode 配置中设置。
        </p>
      ) : null}
    </div>
  );
}

function connectionMethodLabel(connection: PalotIntegrationConnection): string {
  if (connection.method === "oauth") return "账户登录";
  if (connection.method === "key") return "已存储 API 密钥";
  if (connection.method === "external") return "外部凭据";
  return "已存储凭据";
}

function credentialRemovalDescription({ integration, connection }: CredentialActionTarget): string {
  if (!connection.active) {
    return `这将从 OpenCode 中移除已存储的凭据。${integration.name} 将继续使用其当前凭据。`;
  }
  const next = integration.connections.find(
    (candidate) => candidate.id !== connection.id && candidate.type === "credential",
  );
  if (next) {
    return `「${next.label}」将在此 OpenCode 服务中为 ${integration.name} 启用。`;
  }
  const environment = integration.connections.find((candidate) => candidate.type === "env");
  if (environment) {
    return `${integration.name} 将在此 OpenCode 服务中回退到环境中的 ${environment.label}。`;
  }
  return `${integration.name} 将不再在此 OpenCode 服务上具有连接。`;
}

function WellknownIntegrationDialog({
  open,
  locationInput,
  onOpenChange,
  onComplete,
}: {
  open: boolean;
  locationInput: LocationInput;
  onOpenChange(open: boolean): void;
  onComplete(): Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await palot.addWellknownIntegration({ ...locationInput, url: url.trim() });
      await onComplete();
      setUrl("");
      onOpenChange(false);
      toast.add({ type: "success", title: "集成来源已添加" });
    } catch (cause) {
      showError("无法添加集成来源", cause);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>添加集成来源</DialogTitle>
          <DialogDescription>
            OpenCode 将获取来源的知名文档并持久化发现的集成配置。
          </DialogDescription>
        </DialogHeader>
        <label className="grid gap-1.5 text-xs font-medium">
          来源 URL
          <Input
            type="url"
            value={url}
            placeholder="https://example.com"
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" disabled={busy || !validHttpUrl(url)} onClick={() => void submit()}>
            {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
            添加来源
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CredentialLabelDialog({
  credential,
  locationInput,
  onOpenChange,
  onComplete,
}: {
  credential: { integrationName: string; credentialID: string; label: string } | null;
  locationInput: LocationInput;
  onOpenChange(open: boolean): void;
  onComplete(): Promise<void>;
}) {
  const [label, setLabel] = useState(() => credential?.label ?? "");
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!credential) return;
    setBusy(true);
    try {
      await palot.updateCredential({
        ...locationInput,
        credentialID: credential.credentialID,
        label: label.trim(),
      });
      await onComplete();
      onOpenChange(false);
      toast.add({ type: "success", title: `${credential.integrationName} 凭据已重命名` });
    } catch (cause) {
      showError("无法重命名凭据", cause);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={Boolean(credential)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>重命名凭据</DialogTitle>
          <DialogDescription>
            密钥保留在 OpenCode 中。仅其显示标签更改。
          </DialogDescription>
        </DialogHeader>
        <label className="grid gap-1.5 text-xs font-medium">
          标签
          <Input value={label} onChange={(event) => setLabel(event.target.value)} />
        </label>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="button" disabled={busy || !label.trim()} onClick={() => void submit()}>
            {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function capitalize(value: string): string {
  return value ? `${value[0]!.toUpperCase()}${value.slice(1)}` : value;
}

function validHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function showError(title: string, cause: unknown) {
  toast.add({
    type: "error",
    title,
    description: cause instanceof Error ? cause.message : "OpenCode 拒绝了请求。",
  });
}
