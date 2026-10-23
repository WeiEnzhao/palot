import { useAtomValue, useSetAtom } from "jotai";
import { RotateCw, WifiOff } from "lucide-react";
import { memo, useEffect, useState } from "react";
import type { OpenCodeConnectInput, OpenCodeRuntimeStatus } from "../../shared";
import { runtimeAtom } from "../atoms/workspace";
import { palot } from "../services/palot";
import { OpenCodeReleaseSetup } from "./open-code-release-settings";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Spinner } from "./ui/spinner";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "./ui/alert-dialog";

export function SharedOpenCodeAction({
  action = "start",
  disabled,
  onConfirm,
}: {
  action?: "start" | "restart" | "replace";
  disabled?: boolean;
  onConfirm(): void;
}) {
  const [open, setOpen] = useState(false);
  const label =
    action === "start"
      ? "启动 OpenCode"
      : action === "restart"
        ? "重启服务"
        : "使用选定的运行时";
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={<Button type="button" variant="outline" size="sm" disabled={disabled} />}
      >
        {label}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {action === "start"
              ? "启动或恢复共享 OpenCode？"
              : action === "restart"
                ? "重启共享 OpenCode？"
                : "替换共享 OpenCode？"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            使用本地 OpenCode 设置中选定的运行时。默认优先使用已安装的 OpenCode；
            明确下载的 Palot 运行时作为回退。选定的运行时可能未经测试。{" "}
            {action === "start"
              ? "这可能会重启无响应的共享服务，并中断其他 OpenCode 客户端及其运行中的任务。"
              : "这将重启共享服务，可能中断其他 OpenCode 客户端及其运行中的任务。"}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            disabled={disabled}
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            {action === "start"
              ? "启动或恢复"
              : action === "restart"
                ? "重启"
                : "替换服务"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const CONNECTION_ALERT_DELAY_MS = 1_200;

export const OpenCodeConnectionAlert = memo(function OpenCodeConnectionAlert() {
  const runtime = useAtomValue(runtimeAtom);

  if (!runtime || runtime.connected) return null;
  return <DisconnectedOpenCodeAlert key={runtime.connectionID} runtime={runtime} />;
});

function DisconnectedOpenCodeAlert({ runtime }: { runtime: OpenCodeRuntimeStatus }) {
  const setRuntime = useSetAtom(runtimeAtom);
  const [visible, setVisible] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), CONNECTION_ALERT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;

  const reconnecting =
    retrying || runtime.phase === "reconnecting" || runtime.phase === "connecting";

  async function reconnect(input?: OpenCodeConnectInput) {
    setRetrying(true);
    try {
      setRuntime(await palot.connectOpenCode(input));
    } catch {
      setRuntime(await palot.runtimeStatus().catch(() => runtime));
    } finally {
      setRetrying(false);
    }
  }

  return (
    <Alert className="mb-2 has-data-[slot=alert-action]:pr-2" role="status">
      {reconnecting ? <Spinner aria-hidden="true" /> : <WifiOff aria-hidden="true" />}
      <AlertTitle>
        {reconnecting ? "正在重新连接 OpenCode" : "OpenCode 不可用"}
      </AlertTitle>
      <AlertDescription>
        发送暂时不可用。您的对话是安全的。
      </AlertDescription>
      <AlertAction className="static col-start-2 row-auto flex flex-wrap items-center gap-1 justify-self-start">
        {runtime.canStartLocalService ? (
          <SharedOpenCodeAction
            disabled={retrying || runtime.phase === "starting"}
            onConfirm={() => void reconnect({ startLocalService: true })}
          />
        ) : null}
        {runtime.source === "shared-service" || runtime.canStartLocalService ? (
          <OpenCodeReleaseSetup />
        ) : null}
        <Dialog>
          <DialogTrigger render={<Button type="button" variant="ghost" size="xs" />}>
            详情
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>OpenCode 连接详情</DialogTitle>
              <DialogDescription>
                用于诊断 Palot 到 OpenCode 连接的技术详情。
              </DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2">
              <dt className="text-muted-foreground">阶段</dt>
              <dd>{runtime.phase}</dd>
              <dt className="text-muted-foreground">版本</dt>
              <dd>{runtime.version ?? "未知"}</dd>
              <dt className="text-muted-foreground">进程</dt>
              <dd>{runtime.pid ?? "未运行"}</dd>
              <dt className="text-muted-foreground">错误</dt>
              <dd className="min-w-0 break-words font-mono">
                {runtime.error ?? "无错误报告"}
              </dd>
            </dl>
          </DialogContent>
        </Dialog>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={reconnecting}
          onClick={() => void reconnect()}
        >
          {retrying ? (
            <Spinner data-icon="inline-start" aria-hidden="true" />
          ) : (
            <RotateCw data-icon="inline-start" aria-hidden="true" />
          )}
          重试
        </Button>
      </AlertAction>
    </Alert>
  );
}
