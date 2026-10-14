import { useState } from "react";
import type { OpenCodeRuntimeStatus, PalotSession } from "../../shared";
import { useConnectionOverview } from "../hooks/use-connection-overview";
import { useCacheSession } from "../hooks/use-session-catalog";
import { usePalotNavigation } from "../hooks/use-navigation";
import { copySessionToServer } from "../services/opencode-session-copy";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "./ui/select";

export function SessionCopyDialog({
  session,
  source,
  onClose,
}: {
  session: PalotSession;
  source: OpenCodeRuntimeStatus;
  onClose(): void;
}) {
  const { connections, includedProfileIDs } = useConnectionOverview();
  const destinations = connections.filter(
    (entry) =>
      entry.profile.id !== source.profileID &&
      includedProfileIDs.includes(entry.profile.id) &&
      entry.runtime?.connected,
  );
  const [profileID, setProfileID] = useState("");
  const [directory, setDirectory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedTarget, setCopiedTarget] = useState<{
    sessionID: string;
    profileID: string;
    serverName: string;
  } | null>(null);
  const destination = destinations.find((entry) => entry.profile.id === profileID);
  const cache = useCacheSession(destination?.runtime ?? null);
  const { openSession } = usePalotNavigation();
  async function copy() {
    const owner = destination?.runtime;
    if (busy || (!copiedTarget && (!owner?.connected || !directory.trim()))) return;
    let target = copiedTarget;
    setBusy(true);
    setError(null);
    try {
      if (!target) {
        const copied = await copySessionToServer({
          sessionID: session.id,
          sourceConnectionID: source.connectionID,
          destinationConnectionID: owner!.connectionID,
          location: { directory: directory.trim() },
        });
        target = {
          sessionID: copied.id,
          profileID: owner!.profileID,
          serverName: destination!.profile.name,
        };
        setCopiedTarget(target);
        cache(copied);
      }
      await openSession(target.sessionID, { profileID: target.profileID });
      onClose();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "操作失败。";
      setError(
        target
          ? `任务已复制到 ${target.serverName}，但无法打开：${message} 请重试打开已有的副本；不会重新导入。`
          : message,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="grid-cols-[minmax(0,1fr)] max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>复制任务到服务器</DialogTitle>
          <DialogDescription>
            将当前对话复制为独立任务。原始任务保持不变。项目文件、运行中的工具、终端、凭证和子任务不会被复制。目标服务器需要自己的项目文件和模型访问权限。仅复制到你信任的服务器。目标上已有的副本不会被覆盖。
          </DialogDescription>
        </DialogHeader>
        <Select
          value={profileID}
          disabled={busy || Boolean(copiedTarget)}
          onValueChange={(value) => {
            setProfileID(value ?? "");
            setDirectory("");
            setError(null);
          }}
        >
          <SelectTrigger className="w-full min-w-0" aria-label="目标服务器">
            <SelectValue className="min-w-0 truncate" placeholder="选择已启用的服务器">
              {copiedTarget?.serverName ?? destination?.profile.name}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {destinations.map((entry) => (
              <SelectItem key={entry.profile.id} value={entry.profile.id}>
                {entry.profile.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {destination?.projects.length ? (
          <Select
            value={directory}
            disabled={busy || Boolean(copiedTarget)}
            onValueChange={(value) => setDirectory(value ?? "")}
          >
            <SelectTrigger className="w-full min-w-0" aria-label="目标项目">
              <SelectValue className="min-w-0 truncate" placeholder="选择项目">
                {destination.projects.find((project) => project.canonical === directory)?.name ||
                  directory ||
                  undefined}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {destination.projects.map((project) => (
                <SelectItem key={project.id} value={project.canonical}>
                  {project.name || project.canonical}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Input
          aria-label="目标文件夹"
          placeholder="目标服务器上的绝对文件夹路径"
          value={directory}
          disabled={!destination || busy || Boolean(copiedTarget)}
          onChange={(event) => setDirectory(event.target.value)}
        />
        {!destinations.length ? (
          <p className="text-sm text-muted-foreground">
            在"连接"中启用另一个服务器以复制此任务。
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {copiedTarget ? "关闭" : "取消"}
          </Button>
          <Button
            disabled={busy || (!copiedTarget && (!destination || !directory.trim()))}
            onClick={() => void copy()}
          >
            {copiedTarget
              ? busy
                ? "正在打开…"
                : "打开已复制的任务"
              : busy
                ? "正在复制…"
                : "复制任务"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
