import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { ChevronRight, Folder, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { persistedAtom } from "../atoms/persisted";
import { useConnectionOverview } from "../hooks/use-connection-overview";
import { usePalotNavigation } from "../hooks/use-navigation";
import {
  absoluteServerPath,
  directoryBreadcrumbs,
  resolveDirectoryEntry,
} from "../lib/server-directory-path";
import { cacheSession } from "../lib/session-catalog-query";
import { palot } from "../services/palot";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Field, FieldGroup, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

const recentProjectFoldersAtom = persistedAtom({
  key: "connections.recent-project-folders",
  initialValue: {} as Record<string, string[]>,
  validate: (value): value is Record<string, string[]> =>
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.entries(value).length <= 100 &&
    Object.entries(value).every(
      ([id, paths]) =>
        id.length <= 512 &&
        Array.isArray(paths) &&
        paths.length <= 8 &&
        paths.every(
          (path) => typeof path === "string" && path.length <= 4096 && absoluteServerPath(path),
        ),
    ),
});

/** Mounted only while open: its server choice is independent of task focus. */
export function AddProjectDialog({
  initialProfileID,
  onClose,
}: {
  initialProfileID?: string;
  onClose(): void;
}) {
  const overview = useConnectionOverview();
  const queryClient = useQueryClient();
  const { openSession } = usePalotNavigation();
  const [recent, setRecent] = useAtom(recentProjectFoldersAtom);
  const [profileID, setProfileID] = useState<string | null>(initialProfileID ?? null);
  const selected = overview.connections.find((entry) => entry.profile.id === profileID);
  const enabled = Boolean(profileID && overview.includedProfileIDs.includes(profileID));
  const connectionID =
    enabled && selected?.runtime?.connected ? selected.runtime.connectionID : null;
  const [path, setPath] = useState(() =>
    initialProfileID ? (recent[initialProfileID]?.[0] ?? "") : "",
  );
  const [directory, setDirectory] = useState(path);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operation = useRef(0);
  const owner = useRef({ profileID, connectionID });
  owner.current = { profileID, connectionID };
  useEffect(
    () => () => {
      operation.current++;
    },
    [],
  );

  const listing = useQuery({
    queryKey: ["add-project-directories", connectionID, directory],
    enabled: Boolean(connectionID && directory && absoluteServerPath(directory)),
    queryFn: ({ signal }) => palot.listWorkspaceDirectory({ directory }, signal, connectionID!),
    staleTime: 30_000,
    retry: false,
  });
  const browse = (value: string) => {
    const trimmed = value.trim();
    if (!absoluteServerPath(trimmed)) {
      setError("请输入此服务器上的绝对文件夹路径。");
      return;
    }
    const normalized = directoryBreadcrumbs(trimmed).at(-1)!.path;
    setPath(normalized);
    setDirectory(normalized);
    setError(null);
  };
  const chooseServer = (id: string | null) => {
    operation.current++;
    setProfileID(id);
    const first = id ? (recent[id]?.[0] ?? "") : "";
    setPath(first);
    setDirectory(first);
    setError(null);
  };
  const current = (token: number, profile: string, connection: string) =>
    token === operation.current &&
    owner.current.profileID === profile &&
    owner.current.connectionID === connection;
  const pickLocal = async () => {
    if (!profileID || !connectionID || selected?.profile.kind !== "local") return;
    const token = ++operation.current;
    const profile = profileID;
    const connection = connectionID;
    setBusy(true);
    setError(null);
    try {
      const picked = await palot.pickDirectory(connection);
      if (picked && current(token, profile, connection)) browse(picked);
    } catch (cause) {
      if (current(token, profile, connection))
        setError(cause instanceof Error ? cause.message : "无法选择文件夹。");
    } finally {
      if (token === operation.current) setBusy(false);
    }
  };
  const addProject = async () => {
    if (!profileID || !connectionID || !absoluteServerPath(path.trim()) || busy) return;
    const profile = profileID;
    const connection = connectionID;
    const chosen = directoryBreadcrumbs(path.trim()).at(-1)!.path;
    const token = ++operation.current;
    setBusy(true);
    setError(null);
    try {
      const session = await palot.createSession(chosen, undefined, connection);
      if (!session) throw new Error("服务器未创建任务。");
      cacheSession(queryClient, connection, session);
      setRecent((previous) => ({
        ...previous,
        [profile]: [chosen, ...(previous[profile] ?? []).filter((item) => item !== chosen)].slice(
          0,
          8,
        ),
      }));
      if (!current(token, profile, connection)) return;
      await openSession(session.id, { profileID: profile });
      if (token === operation.current) onClose();
    } catch (cause) {
      if (current(token, profile, connection))
        setError(cause instanceof Error ? cause.message : "无法添加项目。");
    } finally {
      if (token === operation.current) setBusy(false);
    }
  };

  const folders = (listing.data ?? [])
    .filter((entry) => entry.type === "directory")
    .toSorted((a, b) => a.path.localeCompare(b.path));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="@container/add-project max-h-[calc(100dvh-2rem)] grid-cols-[minmax(0,1fr)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>添加项目文件夹</DialogTitle>
          <DialogDescription>
            选择服务器上的文件夹。将在该处新建任务。
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="add-project-server">服务器</FieldLabel>
            <Select value={profileID} onValueChange={chooseServer} disabled={busy}>
              <SelectTrigger id="add-project-server" className="w-full">
                <SelectValue placeholder="选择服务器">{selected?.profile.name}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {overview.connections
                  .filter((entry) => overview.includedProfileIDs.includes(entry.profile.id))
                  .map((entry) => (
                    <SelectItem
                      key={entry.profile.id}
                      value={entry.profile.id}
                      disabled={!entry.runtime?.connected}
                    >
                      {entry.profile.name}
                      {!entry.runtime?.connected ? "（离线）" : ""}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
          {selected && !connectionID && (
            <Alert>
              <AlertDescription>
                此服务器已禁用或离线。请先在"连接"中启用后再添加文件夹。
              </AlertDescription>
            </Alert>
          )}
          {!overview.includedProfileIDs.length && (
            <p className="text-sm text-muted-foreground">
              请先在"连接"中启用一个服务器。
            </p>
          )}
          <Field>
            <FieldLabel htmlFor="add-project-path">文件夹路径</FieldLabel>
            <div className="flex gap-2">
              <Input
                id="add-project-path"
                value={path}
                placeholder="所选服务器上的绝对路径"
                disabled={!connectionID || busy}
                onChange={(event) => setPath(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    browse(path);
                  }
                }}
              />
              <Button
                variant="outline"
                disabled={!connectionID || !path.trim() || busy}
                onClick={() => browse(path)}
              >
                浏览
              </Button>
            </div>
          </Field>
        </FieldGroup>
        {connectionID && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={busy} onClick={() => browse("/")}>
              浏览根目录
            </Button>
            {selected?.profile.kind === "local" &&
              selected.runtime?.capabilities?.localPathActions !== false && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void pickLocal()}
                >
                  选择本地文件夹…
                </Button>
              )}
            {(recent[profileID!] ?? []).map((folder) => (
              <Button
                key={folder}
                variant="ghost"
                size="sm"
                className="max-w-full truncate"
                disabled={busy}
                title={folder}
                onClick={() => browse(folder)}
              >
                {folder}
              </Button>
            ))}
          </div>
        )}
        {connectionID && directory && (
          <div className="min-w-0 rounded-md border">
            <nav
              aria-label="文件夹面包屑"
              className="flex flex-wrap items-center gap-1 border-b p-2"
            >
              {directoryBreadcrumbs(directory).map((crumb, index) => (
                <span key={crumb.path} className="flex min-w-0 items-center gap-1">
                  {index > 0 && (
                    <ChevronRight className="size-3 text-muted-foreground" aria-hidden="true" />
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="max-w-full truncate"
                    disabled={busy}
                    aria-label={`浏览 ${crumb.path}`}
                    onClick={() => browse(crumb.path)}
                  >
                    {crumb.label}
                  </Button>
                </span>
              ))}
            </nav>
            <ScrollArea className="h-48">
              {listing.isPending ? (
                <p
                  role="status"
                  className="flex items-center gap-2 p-3 text-sm text-muted-foreground"
                >
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                  正在加载文件夹…
                </p>
              ) : listing.isError ? (
                <Alert variant="destructive" className="border-0">
                  <AlertDescription>
                    {listing.error.message}
                    <Button variant="ghost" size="sm" onClick={() => void listing.refetch()}>
                      重试
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : folders.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">
                  没有子文件夹。你可以添加当前文件夹。
                </p>
              ) : (
                <ul className="p-1">
                  {folders.map((entry) => (
                    <li key={entry.path}>
                      <Button
                        variant="ghost"
                        className="w-full justify-start"
                        disabled={busy}
                        aria-label={`打开文件夹 ${entry.path}`}
                        onClick={() => browse(resolveDirectoryEntry(directory, entry.path))}
                      >
                        <Folder aria-hidden="true" />
                        <span className="truncate">
                          {entry.path
                            .replace(/[\\/]$/, "")
                            .split(/[\\/]/)
                            .at(-1)}
                        </span>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </ScrollArea>
          </div>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={!connectionID || !absoluteServerPath(path.trim()) || busy}
            onClick={() => void addProject()}
          >
            {busy ? "正在打开…" : "添加项目"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
