import { useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { Check, ChevronDown, Cloud, Monitor } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
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
import { Button } from "./ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

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
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="context"
            role="combobox"
            aria-label="任务目标"
            aria-expanded={open}
            title={project?.canonical}
          />
        }
      >
        {selected?.profile.kind === "local" ? (
          <Monitor aria-hidden="true" />
        ) : (
          <Cloud aria-hidden="true" />
        )}
        <span className="max-w-48 truncate">
          {project ? projectName(project) : "选择目标"}
        </span>
        <span className="max-w-32 truncate text-muted-foreground">
          {selected?.profile.name ?? value.profileID}
        </span>
        {disabled.includes(value.profileID) || offline ? (
          <span className="text-warning">
            {disabled.includes(value.profileID) ? "已禁用" : "离线"}
          </span>
        ) : null}
        <ChevronDown aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 max-w-[calc(100vw-2rem)] gap-0 p-1">
        <Command label="搜索目标" className="bg-transparent p-0">
          <CommandInput
            placeholder="搜索项目、路径或服务器…"
            aria-label="搜索目标"
            autoFocus
          />
          <CommandList className="max-h-80">
            <CommandEmpty>未找到目标</CommandEmpty>
            {groups.map((entry) => {
              const isDisabled = disabled.includes(entry.profile.id);
              const connected =
                entry.profile.id === runtime?.profileID
                  ? runtime.connected
                  : entry.runtime?.connected;
              const status = isDisabled ? "已禁用" : connected ? "" : "离线";
              const rows: (PalotProject | null)[] = entry.projects.length ? entry.projects : [null];
              return (
                <CommandGroup
                  key={entry.profile.id}
                  heading={`${entry.profile.name} · ${connectionDescription(entry.profile)}`}
                >
                  {rows.map((item) => (
                    <CommandItem
                      key={destinationKey(entry.profile.id, item)}
                      value={destinationKey(entry.profile.id, item)}
                      keywords={[
                        entry.profile.name,
                        connectionDescription(entry.profile),
                        item ? projectName(item) : "选择服务器",
                        item?.canonical ?? "",
                      ]}
                      disabled={isDisabled || !onChange}
                      onSelect={() => {
                        if (isDisabled) return;
                        onChange?.({ profileID: entry.profile.id, projectID: item?.id ?? null });
                        setOpen(false);
                      }}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">
                          {item ? projectName(item) : "选择服务器"}
                        </span>
                        {item ? (
                          <span className="block truncate text-meta text-muted-foreground">
                            {item.canonical}
                          </span>
                        ) : null}
                        <span className="block truncate text-meta text-muted-foreground">
                          {entry.profile.name}
                          {status ? ` · ${status}` : ""}
                        </span>
                      </span>
                      {entry.profile.id === value.profileID &&
                      item?.id === (value.projectID ?? undefined) ? (
                        <Check aria-hidden="true" />
                      ) : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
