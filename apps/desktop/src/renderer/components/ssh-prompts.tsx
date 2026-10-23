import { useEffect, useState } from "react";
import type { SshConnectionState } from "../../shared/ssh-contract";
import { palot } from "../services/palot";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { toast } from "./ui/toast";

const stageLabels: Record<string, string> = {
  connecting: "Connecting over SSH…",
  checking: "Checking remote OpenCode…",
  setup: "Waiting for setup approval…",
  downloading: "Downloading the matching runtime…",
  uploading: "Installing the remote runtime…",
  starting: "Starting remote OpenCode…",
  forwarding: "Opening the local tunnel…",
  "checking-health": "Verifying the connection…",
};

export function SshPrompts() {
  const [state, setState] = useState<SshConnectionState | null>(null);
  useEffect(() => {
    let active = true;
    let received = false;
    const unsubscribe = palot.onSshConnectionState((value) => {
      received = true;
      if (active) setState(value);
    });
    void palot
      .getSshConnectionState()
      .then((value) => {
        if (active && !received) setState(value);
      })
      .catch((error: unknown) => {
        if (active && !received) showError(error);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return state ? (
    <SshOperation key={`${state.operationID}:${state.prompt?.id ?? "progress"}`} state={state} />
  ) : null;
}

function SshOperation({ state }: { state: SshConnectionState }) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const request = state.prompt?.request;
  const secret = request?.kind === "authentication" && !request.confirm;
  const cancel = async () => {
    setAnswer("");
    setBusy(true);
    try {
      await palot.cancelSshConnection(state.operationID);
    } catch (error) {
      showError(error);
      setBusy(false);
    }
  };
  const respond = async () => {
    if (!state.prompt || busy) return;
    const value = secret ? answer : "yes";
    setAnswer("");
    setBusy(true);
    try {
      await palot.respondSshPrompt({
        operationID: state.operationID,
        promptID: state.prompt.id,
        value,
      });
    } catch (error) {
      showError(error);
      setBusy(false);
    }
  };
  const action = request?.kind === "setup" ? request.action : null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) void cancel();
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {action
              ? `${action === "install" ? "安装" : action === "start" ? "启动" : "替换"}远程 OpenCode？`
              : "SSH 连接"}
          </DialogTitle>
          <DialogDescription className="wrap-anywhere">{state.target}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void respond();
          }}
        >
          {request?.kind === "setup" ? (
            <div className="space-y-2 text-sm">
              <p>本机需要 OpenCode {request.version} 才能使用 Palot。</p>
              {request.currentVersion ? <p>当前版本：{request.currentVersion}。</p> : null}
              <p>
                {action === "replace"
                  ? "替换远程运行环境可能会中断其他客户端和正在运行的任务。"
                  : action === "install"
                    ? "将在远程计算机上下载并安装所需的运行环境。"
                    : "将启动远程 OpenCode 后台服务。"}
              </p>
              <p className="text-compact text-muted-foreground">
                隧道关闭后服务仍会继续运行。请仅在您控制该计算机时继续。
              </p>
            </div>
          ) : request?.kind === "authentication" ? (
            <div className="space-y-2">
              <p className="whitespace-pre-wrap text-sm wrap-anywhere">{request.text}</p>
              {secret ? (
                <label className="grid gap-2 text-sm">
                  SSH 应答
                  <Input
                    type="password"
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value)}
                    autoComplete="off"
                    disabled={busy}
                  />
                </label>
              ) : null}
            </div>
          ) : (
            <p role="status" className="text-sm text-muted-foreground">
              {stageLabels[state.stage] ?? state.stage}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => void cancel()}>
              取消连接
            </Button>
            {request ? (
              <Button type="submit" disabled={busy || (secret && !answer)}>
                {action ? `允许${action}` : secret ? "继续" : "确认"}
              </Button>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function showError(error: unknown) {
  toast.add({ type: "error", title: error instanceof Error ? error.message : "SSH 操作失败" });
}
