import { useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { Cloud, Monitor } from "lucide-react";
import { useSyncExternalStore } from "react";
import type { PalotProject } from "../../shared";
import { disabledProfileIDsAtom } from "../atoms/connections";
import { runtimeAtom } from "../atoms/workspace";
import { connectionOverview } from "../lib/connection-overview";
import {
  destinationGroups,
  destinationKey,
  type NewTaskDestination,
} from "../lib/new-task-destination";
import { projectName } from "../lib/view-models";
import { connectionDescription } from "./connection-badge";
import { ComposerPicker, type ComposerPickerSection } from "./ui/composer-picker";

/** A destination is one project on one device, never a project ID alone. */
export function DestinationPicker({
  value,
  projects = [],
  onChange,
}: {
  value: NewTaskDestination;
  projects?: PalotProject[];
  onChange?(destination: NewTaskDestination): void;
}) {
  const runtime = useAtomValue(runtimeAtom);
  const disabled = useAtomValue(disabledProfileIDsAtom);
  const controller = connectionOverview(useQueryClient());
  const connections = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const groups = destinationGroups(connections, runtime?.profileID, projects);
  const selected = groups.find((entry) => entry.profile.id === value.profileID);
  const project = selected?.projects.find((entry) => entry.id === value.projectID);
  const offline =
    value.profileID === runtime?.profileID ? !runtime.connected : !selected?.runtime?.connected;
  const sections: ComposerPickerSection<NewTaskDestination>[] = groups.map((entry) => {
    const isDisabled = disabled.includes(entry.profile.id);
    const connected =
      entry.profile.id === runtime?.profileID ? runtime.connected : entry.runtime?.connected;
    const status = isDisabled ? "已禁用" : connected ? "" : "离线";
    const description = connectionDescription(entry.profile);
    const rows: (PalotProject | null)[] = entry.projects.length ? entry.projects : [null];
    return {
      key: entry.profile.id,
      heading: `${entry.profile.name} · ${description}`,
      options: rows.map((item) => ({
        key: destinationKey(entry.profile.id, item),
        value: { profileID: entry.profile.id, projectID: item?.id ?? null },
        label: item ? projectName(item) : "选择服务器",
        // The section heading names the server; rows carry the path and its state.
        description: item?.canonical,
        badges: status ? [{ label: status, tone: "warning" as const }] : undefined,
        keywords: [entry.profile.name, description, item?.canonical],
        disabled: isDisabled || !onChange,
      })),
    };
  });

  return (
    <ComposerPicker<NewTaskDestination>
      size="context"
      triggerRole="combobox"
      label={project ? projectName(project) : "选择目标"}
      ariaLabel="任务目标"
      icon={
        selected?.profile.kind === "local" ? (
          <Monitor aria-hidden="true" />
        ) : (
          <Cloud aria-hidden="true" />
        )
      }
      secondary={selected?.profile.name ?? value.profileID}
      status={disabled.includes(value.profileID) ? "已禁用" : offline ? "离线" : null}
      labelClassName="max-w-48"
      triggerProps={{ title: project?.canonical }}
      side="bottom"
      popupClassName="w-96 max-w-[calc(100vw-2rem)]"
      listLabel="目标"
      search={{
        label: "搜索目标",
        placeholder: "搜索项目、路径或服务器…",
      }}
      sections={sections}
      selectedKey={destinationKey(value.profileID, project ?? null)}
      emptyLabel="未找到目标"
      errorTitle="无法更改目标"
      onSelect={(option) => onChange?.(option.value)}
    />
  );
}
