import {
  Activity,
  Bell,
  BrainCircuit,
  Cable,
  FileCog,
  Gauge,
  Palette,
  Server,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";
import type { ComponentType } from "react";

export type SettingsCategory =
  | "project"
  | "general"
  | "connections"
  | "appearance"
  | "notifications"
  | "models"
  | "providers"
  | "tools"
  | "agents"
  | "permissions"
  | "config"
  | "diagnostics"
  | "about";

export interface SettingsNavItem {
  id: SettingsCategory;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  keywords: string;
  group: "Palot" | "OpenCode" | "System";
}

export const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  {
    id: "project",
    label: "项目",
    description: "项目详情与主检出",
    icon: FileCog,
    keywords: "project name icon color canonical directory checkout worktree startup command",
    group: "OpenCode",
  },
  {
    id: "general",
    label: "通用",
    description: "新任务与时间线行为",
    icon: Gauge,
    keywords:
      "default task worktree approval timeline tools compact links icons favicon duckduckgo privacy website",
    group: "Palot",
  },
  {
    id: "appearance",
    label: "外观",
    description: "主题与界面密度",
    icon: Palette,
    keywords: "theme dark light system colors interface",
    group: "Palot",
  },
  {
    id: "notifications",
    label: "通知",
    description: "系统任务提醒",
    icon: Bell,
    keywords: "notifications alerts macos completion permission question tray",
    group: "Palot",
  },
  {
    id: "connections",
    label: "连接",
    description: "OpenCode 配置与网络访问",
    icon: Server,
    keywords: "server remote local pair connection url web tailscale service",
    group: "OpenCode",
  },
  {
    id: "models",
    label: "模型",
    description: "项目默认与目录",
    icon: Sparkles,
    keywords: "model provider context output default variant",
    group: "OpenCode",
  },
  {
    id: "providers",
    label: "提供者",
    description: "提供者凭据与模型",
    icon: Cable,
    keywords: "provider api key oauth environment credential integration",
    group: "OpenCode",
  },
  {
    id: "tools",
    label: "工具",
    description: "MCP、技能、命令、插件",
    icon: Wrench,
    keywords: "mcp skill command plugin reference tool server",
    group: "OpenCode",
  },
  {
    id: "agents",
    label: "智能体",
    description: "可用的主智能体与子智能体",
    icon: BrainCircuit,
    keywords: "agent build plan explore general subagent permissions",
    group: "OpenCode",
  },
  {
    id: "permissions",
    label: "权限",
    description: "已保存的项目审批",
    icon: ShieldCheck,
    keywords: "permissions allow always approval shell edit remove",
    group: "OpenCode",
  },
  {
    id: "config",
    label: "配置",
    description: "已发现的 OpenCode 源",
    icon: FileCog,
    keywords: "config json jsonc source formatter lsp snapshots compaction warming",
    group: "OpenCode",
  },
  {
    id: "diagnostics",
    label: "诊断",
    description: "实时性能与运行时信号",
    icon: Activity,
    keywords: "diagnostics performance cpu memory gpu frames react scan renderer processes",
    group: "System",
  },
  {
    id: "about",
    label: "关于",
    description: "Palot 与 OpenCode 服务",
    icon: Server,
    keywords: "version pid binary service restart runtime",
    group: "System",
  },
];
