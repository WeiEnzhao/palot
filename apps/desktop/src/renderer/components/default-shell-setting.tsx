import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { runtimeAtom } from "../atoms/workspace";
import { openCodeKeys } from "../lib/opencode-query";
import { canFetchOpenCode } from "../lib/opencode-runtime-query";
import { showErrorToast } from "../lib/toast-error";
import {
  loadShellSettings,
  shellSelectOptions,
  updateDefaultShell,
  type ShellSettings,
} from "../services/opencode-settings";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { SettingsRow } from "./settings-layout";

const AUTO = "__auto__";

// Nested under the settings key so `config.updated` events and saves refresh it.
export function shellSettingsKey(connectionID: string) {
  return [...openCodeKeys.settings(connectionID), "shell"] as const;
}

/** Default shell for the current task's OpenCode server, saved in its global config. */
export function DefaultShellSetting() {
  const runtime = useAtomValue(runtimeAtom);
  const connectionID = runtime?.connectionID ?? "disconnected";
  const available = canFetchOpenCode(runtime);
  const queryClient = useQueryClient();
  const queryKey = shellSettingsKey(connectionID);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => loadShellSettings(connectionID, signal),
    enabled: available,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const mutation = useMutation({
    mutationFn: (shell: string | null) => updateDefaultShell(connectionID, shell),
    onMutate: async (shell) => {
      await queryClient.cancelQueries({ queryKey, exact: true });
      const previous = queryClient.getQueryData<ShellSettings>(queryKey);
      if (previous) queryClient.setQueryData<ShellSettings>(queryKey, { ...previous, shell });
      return { previous };
    },
    onError: (error, _shell, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      showErrorToast("无法更改默认 shell", error);
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: openCodeKeys.settings(connectionID) }),
  });

  const settings = query.data;
  const options = settings ? shellSelectOptions(settings) : [];
  const current = settings?.shell ?? null;
  const currentLabel = current
    ? (options.find((option) => option.value === current)?.label ?? current)
    : "自动";
  const status = !available
    ? "连接到 OpenCode 服务器以选择其 shell。"
    : query.isPending
      ? "正在加载可用 shell…"
      : undefined;

  return (
    <SettingsRow
      title="默认 shell"
      description="OpenCode 用于终端和智能体命令的 shell。自动让 OpenCode 选择。适用于当前任务服务器上的每个项目。"
      status={status}
      control={
        query.isError ? (
          <>
            <span role="alert" className="text-meta text-destructive">
              {query.error instanceof Error ? query.error.message : "无法加载 shell。"}
            </span>
            <Button type="button" size="sm" variant="outline" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </>
        ) : (
          <Select
            value={current ?? AUTO}
            disabled={!available || !settings || mutation.isPending}
            onValueChange={(value) => {
              const shell = value === AUTO || value === null ? null : value;
              if (shell !== current) mutation.mutate(shell);
            }}
          >
            <SelectTrigger className="w-full @lg/settings:w-48" aria-label="默认 shell">
              <SelectValue>{currentLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value={AUTO}>自动</SelectItem>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                  {option.terminalOnly ? (
                    <span className="ml-auto pl-3 text-meta text-muted-foreground">
                      Terminal only
                    </span>
                  ) : null}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      }
    />
  );
}
