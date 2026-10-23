import { useQueryClient } from "@tanstack/react-query";
import { useStore } from "jotai";
import { useState } from "react";
import {
  PROJECT_SCRIPT_LIMITS,
  type ProjectScriptRun,
} from "../../shared/project-scripts-contract";
import { runtimeAtom } from "../atoms/workspace";
import { useProjectScriptRuns } from "../hooks/use-project-scripts";
import { openCodeReconciler } from "../lib/open-code-reconciler";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { CopyField } from "./ui/copy-field";
import { toast } from "./ui/toast";

const STATUS_LABELS: Record<ProjectScriptRun["status"], string> = {
  passed: "已通过",
  failed: "已失败",
  "timed-out": "已超时",
  error: "无法运行",
};

/**
 * A quiet toast per finished project script (“已运行「test」，状态：passed”), with
 * View output opening the captured output. Palot never prompts the agent with it.
 */
export function ProjectScriptNotices() {
  const store = useStore();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<ProjectScriptRun | null>(null);
  useProjectScriptRuns((run) => {
    const runtime = store.get(runtimeAtom);
    const title =
      runtime?.profileID === run.profileID
        ? openCodeReconciler(queryClient)
            .session(runtime.connectionID, run.sessionID)
            ?.title?.trim()
        : undefined;
    toast.add({
      type: run.status === "passed" ? "success" : "warning",
      title: `已运行「${run.scriptName}」，状态：${STATUS_LABELS[run.status]}`,
      description: run.error ?? (title || undefined),
      actionProps: { children: "查看输出", onClick: () => setOpen(run) },
    });
  });
  return <ProjectScriptOutputDialog run={open} onClose={() => setOpen(null)} />;
}

export function ProjectScriptOutputDialog({
  run,
  onClose,
}: {
  run: ProjectScriptRun | null;
  onClose(): void;
}) {
  return (
    <Dialog open={run !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[80vh] grid-rows-[auto_auto_minmax(0,1fr)] sm:max-w-2xl">
        {run ? (
          <>
            <DialogHeader>
              <DialogTitle>
                {run.scriptName} {STATUS_LABELS[run.status]}
              </DialogTitle>
              <DialogDescription>{runSummary(run)}</DialogDescription>
            </DialogHeader>
            <div className="grid min-w-0 gap-2">
              <CopyField label="命令" value={run.command} />
              {run.directory ? <CopyField label="目录" value={run.directory} /> : null}
            </div>
            <pre
              aria-label="脚本输出"
              tabIndex={0}
              className="palot-native-scrollbar min-h-24 overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-code-compact whitespace-pre-wrap text-foreground"
            >
              {run.outputTruncated
                ? `… earlier output omitted (last ${PROJECT_SCRIPT_LIMITS.outputCharacters.toLocaleString()} characters)\n`
                : null}
              {run.output || (run.error ?? "无输出。")}
            </pre>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function runSummary(run: ProjectScriptRun): string {
  const seconds = Math.max(0, (run.finishedAt - run.startedAt) / 1_000);
  const parts = [
    run.exitCode !== null
      ? `退出码 ${run.exitCode}`
      : run.signal
        ? `被 ${run.signal} 终止`
        : null,
    run.status === "error" ? null : `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} 秒`,
    run.error,
  ].filter(Boolean);
  return parts.join(" · ");
}
