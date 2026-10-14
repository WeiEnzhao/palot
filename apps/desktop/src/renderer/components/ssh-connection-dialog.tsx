import { useEffect, useRef, useState } from "react";
import type { OpenCodeProfile, OpenCodeProfileSnapshot } from "../../shared";
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

export function SshConnectionDialog({
  profile,
  onClose,
  onSaved,
}: {
  profile?: Extract<OpenCodeProfile, { kind: "ssh" }>;
  onClose(): void;
  onSaved(snapshot: OpenCodeProfileSnapshot): void;
}) {
  const [name, setName] = useState(profile?.name ?? "");
  const [target, setTarget] = useState(profile?.ssh.target ?? "");
  const [port, setPort] = useState(profile?.ssh.port?.toString() ?? "");
  const [identityFile, setIdentityFile] = useState(profile?.ssh.identityFile ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const validPort = !port || (/^\d+$/.test(port) && Number(port) >= 1 && Number(port) <= 65535);
  const save = async () => {
    if (busy || !target.trim() || !validPort) return;
    setBusy(true);
    setError(null);
    const input = {
      kind: "ssh" as const,
      name: name.trim() || target.trim(),
      ssh: {
        target: target.trim(),
        ...(port ? { port: Number(port) } : {}),
        ...(identityFile.trim() ? { identityFile: identityFile.trim() } : {}),
      },
    };
    try {
      await palot.testOpenCodeProfile(input);
      if (!mounted.current) return;
      onSaved(
        profile
          ? await palot.updateOpenCodeProfile({ ...input, id: profile.id })
          : await palot.createOpenCodeProfile(input),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "SSH 连接失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{profile ? "编辑 SSH 连接" : "添加 SSH 连接"}</DialogTitle>
          <DialogDescription>
            使用系统 SSH 配置连接。工具和文件保留在远程计算机上。
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={busy} className="space-y-4">
            <label className="grid gap-2 text-sm">
              名称（可选）
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="开发服务器"
              />
            </label>
            <label className="grid gap-2 text-sm">
              SSH 目标
              <Input
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                placeholder="config-alias 或 user@host"
                autoCapitalize="none"
                autoCorrect="off"
                required
              />
            </label>
            <label className="grid gap-2 text-sm">
              端口（可选）
              <Input
                value={port}
                onChange={(event) => setPort(event.target.value)}
                inputMode="numeric"
                placeholder="使用 SSH 配置"
                aria-invalid={!validPort}
              />
            </label>
            <label className="grid gap-2 text-sm">
              身份文件（可选）
              <Input
                value={identityFile}
                onChange={(event) => setIdentityFile(event.target.value)}
                placeholder="~/.ssh/id_ed25519"
                autoCapitalize="none"
                autoCorrect="off"
              />
            </label>
          </fieldset>
          <p className="text-compact text-muted-foreground">
            Palot 在安装、启动或替换所需的 OpenCode 运行时会询问。关闭 SSH 隧道会使远程服务继续运行。配置文件仅在连接测试成功后才会保存。
          </p>
          {error ? (
            <p role="alert" className="text-compact text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={busy || !target.trim() || !validPort}>
              {busy ? "正在测试连接…" : "测试并保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
