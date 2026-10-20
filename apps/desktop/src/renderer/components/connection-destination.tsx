import { useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { Cloud, CloudOff, Monitor } from "lucide-react";
import { useCallback, useSyncExternalStore } from "react";
import { disabledProfileIDsAtom } from "../atoms/connections";
import { runtimeAtom } from "../atoms/workspace";
import { connectionOverview } from "../lib/connection-overview";
import { ConnectionBadge, connectionDescription } from "./connection-badge";
import { ComposerPicker, type ComposerPickerSection } from "./ui/composer-picker";
import type { PalotProject } from "../../shared";
import type { NewTaskDestination } from "../lib/new-task-destination";
import { DestinationPicker } from "./destination-picker";

/** Keep the execution owner visible without subscribing the composer to background tasks. */
export function ConnectionDestination({
  onProfileChange,
  destination,
  projects,
  onDestinationChange,
}: {
  onProfileChange?(profileID: string): void;
  destination?: NewTaskDestination;
  projects?: PalotProject[];
  onDestinationChange?(destination: NewTaskDestination): void;
} = {}) {
  if (destination)
    return (
      <DestinationPicker value={destination} projects={projects} onChange={onDestinationChange} />
    );
  return <ConnectionContext onProfileChange={onProfileChange} />;
}

function ConnectionContext({ onProfileChange }: { onProfileChange?(profileID: string): void }) {
  const runtime = useAtomValue(runtimeAtom);
  const controller = connectionOverview(useQueryClient());
  const select = useCallback(() => {
    return controller.getSnapshot().find((entry) => entry.profile.id === runtime?.profileID)
      ?.profile;
  }, [controller, runtime?.profileID]);
  const profile = useSyncExternalStore(controller.subscribe, select, select);
  if (onProfileChange) return <ConnectionSelector onProfileChange={onProfileChange} />;
  if (!profile || (profile.kind === "local" && runtime?.connected)) return null;
  if (!runtime?.connected) {
    return (
      <span
        role="status"
        title={`${connectionDescription(profile)} · 重新连接以发送消息`}
        className="inline-flex h-6 min-w-0 max-w-full items-center gap-1 px-1.5 text-meta text-warning"
      >
        <CloudOff className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="max-w-40 truncate">{profile.name}</span>
        <span className="shrink-0"> · 离线</span>
      </span>
    );
  }
  return (
    <span
      className="inline-flex h-6 min-w-0 items-center px-1.5"
      aria-label={`执行连接：${profile.name}`}
    >
      <ConnectionBadge profile={profile} connected />
    </span>
  );
}

/** Drafts can change execution owners; existing sessions must keep theirs. */
function ConnectionSelector({ onProfileChange }: { onProfileChange(profileID: string): void }) {
  const runtime = useAtomValue(runtimeAtom);
  const disabled = useAtomValue(disabledProfileIDsAtom);
  const controller = connectionOverview(useQueryClient());
  const connections = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const profile = connections.find((entry) => entry.profile.id === runtime?.profileID)?.profile;
  if (!profile) return null;
  if (connections.length === 1 && profile.kind === "local" && runtime?.connected) return null;
  const Icon = !runtime?.connected ? CloudOff : profile.kind === "local" ? Monitor : Cloud;
  const sections: ComposerPickerSection<string>[] = [
    {
      key: "servers",
      heading: "在此任务上运行",
      options: connections.map((entry) => {
        const isDisabled = disabled.includes(entry.profile.id);
        const EntryIcon = entry.profile.kind === "local" ? Monitor : Cloud;
        const description = connectionDescription(entry.profile);
        return {
          key: entry.profile.id,
          value: entry.profile.id,
          label: entry.profile.name,
          description: `${description}${isDisabled ? " · 已禁用" : !entry.runtime?.connected ? " · 离线" : ""}`,
          keywords: [description, entry.profile.id],
          icon: <EntryIcon aria-hidden="true" />,
          disabled: isDisabled,
        };
      }),
    },
  ];
  return (
    <ComposerPicker<string>
      size="context"
      triggerRole="combobox"
      label={profile.name}
      ariaLabel={`服务器：${profile.name}`}
      icon={
        <Icon
          className={runtime?.connected && profile.kind !== "local" ? "text-success" : undefined}
          aria-hidden="true"
        />
      }
      status={!runtime?.connected ? "离线" : null}
      labelClassName="max-w-40"
      triggerProps={{ title: connectionDescription(profile) }}
      side="bottom"
      listLabel="服务器"
      search={{ label: "搜索服务器", placeholder: "搜索服务器…" }}
      sections={sections}
      selectedKey={runtime?.profileID ?? null}
      emptyLabel="未找到服务器"
      errorTitle="无法更改服务器"
      onSelect={(option) => onProfileChange(option.value)}
    />
  );
}
