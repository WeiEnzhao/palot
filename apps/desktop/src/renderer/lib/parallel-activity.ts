import { projectToolExecution } from "./tool-executions";
import type { TranscriptTurn } from "./turn-projection";
import { isTool } from "./view-models";

/** 命名进行中回合里的并发工具动作，如「读取 3 个文件」。0 或 1 个工具时返回 null。 */
export function parallelActivityLabel(turn: TranscriptTurn): string | null {
  const kinds: string[] = [];
  for (const group of turn.activity) {
    for (const entry of group.entries) {
      if (!isTool(entry.part)) continue;
      const view = projectToolExecution(entry.part, entry.index);
      if (view.status === "running" || view.status === "pending") kinds.push(view.kind);
    }
  }
  const count = kinds.length;
  if (count < 2) return null;
  const only = (kind: string) => kinds.every((candidate) => candidate === kind);
  if (only("read")) return `读取 ${count} 个文件`;
  if (only("subagent")) return `运行 ${count} 个子代理`;
  if (only("shell")) return `执行 ${count} 个命令`;
  return `执行 ${count} 个工具`;
}
