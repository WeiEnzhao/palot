import type { PalotCommand } from "../../shared";

export const BUILTIN_COMMANDS: readonly PalotCommand[] = [
  {
    name: "btw",
    description: "快速提个旁支问题，不加入对话",
    agent: null,
    model: null,
    subtask: false,
  },
  {
    name: "compact",
    description: "压缩对话历史以释放上下文空间",
    agent: null,
    model: null,
    subtask: false,
  },
  {
    name: "new",
    description: "开始新的对话任务",
    agent: null,
    model: null,
    subtask: false,
  },
  {
    name: "clear",
    description: "开始全新的对话任务",
    agent: null,
    model: null,
    subtask: false,
  },
  {
    name: "model",
    description: "切换模型或打开模型选择器",
    agent: null,
    model: null,
    subtask: false,
  },
  {
    name: "undo",
    description: "撤销上一步对话操作及文件更改",
    agent: null,
    model: null,
    subtask: false,
  },
  {
    name: "revert",
    description: "撤销上一步对话操作及文件更改",
    agent: null,
    model: null,
    subtask: false,
  },
  {
    name: "redo",
    description: "重做一步已暂存的对话操作",
    agent: null,
    model: null,
    subtask: false,
  },
  {
    name: "restore",
    description: "恢复所有当前已暂存的对话更改",
    agent: null,
    model: null,
    subtask: false,
  },
  {
    name: "init",
    description: "在当前项目初始化 OpenCode",
    agent: null,
    model: null,
    subtask: false,
  },
  {
    name: "fork",
    description: "将此任务分叉为新任务",
    agent: null,
    model: null,
    subtask: false,
  },
  {
    name: "export",
    description: "将此任务导出到文件",
    agent: null,
    model: null,
    subtask: false,
  },
  {
    name: "agent",
    description: "切换 Agent 或打开 Agent 选择器",
    agent: null,
    model: null,
    subtask: false,
  },
  {
    name: "mcp",
    description: "打开 MCP 服务器设置",
    agent: null,
    model: null,
    subtask: false,
  },
  {
    name: "open",
    description: "搜索此任务的文件并打开",
    agent: null,
    model: null,
    subtask: false,
  },
] as const;

export function mergeBuiltinCommands(customCommands: PalotCommand[]): PalotCommand[] {
  const customNames = new Set(customCommands.map((c) => c.name.toLowerCase()));
  const availableBuiltins = BUILTIN_COMMANDS.filter((b) => !customNames.has(b.name.toLowerCase()));
  return [...availableBuiltins, ...customCommands];
}

export function isBuiltinCommand(name: string): boolean {
  const normalized = name.toLowerCase();
  return BUILTIN_COMMANDS.some((c) => c.name.toLowerCase() === normalized);
}
