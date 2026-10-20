import {
  Activity,
  Bell,
  BrainCircuit,
  Cable,
  FileCog,
  Gauge,
  Globe2,
  Keyboard,
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
  | "browser"
  | "connections"
  | "appearance"
  | "notifications"
  | "shortcuts"
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
    description: "项目详情和主检出",
    icon: FileCog,
    keywords: "project name icon color canonical directory checkout worktree startup command",
    group: "OpenCode",
  },
  {
    id: "general",
    label: "通用",
    description: "新任务和时间线行为",
    icon: Gauge,
    keywords:
      "default task worktree approval timeline tools compact links icons favicon duckduckgo privacy website",
    group: "Palot",
  },
  {
    id: "browser",
    label: "浏览器",
    description: "浏览器访问、搜索、链接和地址显示",
    icon: Globe2,
    keywords:
      "experimental browser sites server localhost private network search engine google duckduckgo bing web links local dev links external full url address downloads history site permissions",
    group: "Palot",
  },
  {
    id: "appearance",
    label: "外观",
    description: "主题和界面密度",
    icon: Palette,
    keywords: "theme dark light system colors interface",
    group: "Palot",
  },
  {
    id: "notifications",
    label: "通知",
    description: "原生任务提醒",
    icon: Bell,
    keywords: "notifications alerts macos completion permission question tray",
    group: "Palot",
  },
  {
    id: "shortcuts",
    label: "键盘快捷键",
    description: "所有 Palot 键盘快捷键",
    icon: Keyboard,
    keywords: "keyboard shortcuts keybindings hotkeys keys accelerators",
    group: "Palot",
  },
  {
    id: "connections",
    label: "连接",
    description: "OpenCode 配置和网页访问",
    icon: Server,
    keywords: "server remote local pair connection url web tailscale service",
    group: "OpenCode",
  },
  {
    id: "models",
    label: "模型",
    description: "默认模型以及模型选择器显示哪些模型",
    icon: Sparkles,
    keywords:
      "model default override variant effort context output price cost visibility hide show picker order agent",
    group: "OpenCode",
  },
  {
    id: "providers",
    label: "提供者",
    description: "提供者连接与凭据",
    icon: Cable,
    keywords:
      "provider connect disconnect api key oauth account environment variable env credential integration source policy",
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
    description: "可用的主智能体和子智能体",
    icon: BrainCircuit,
    keywords: "agent build plan explore general subagent permissions",
    group: "OpenCode",
  },
  {
    id: "permissions",
    label: "权限",
    description: "已保存的项目批准",
    icon: ShieldCheck,
    keywords: "permissions allow always approval shell edit remove",
    group: "OpenCode",
  },
  {
    id: "config",
    label: "配置",
    description: "发现的 OpenCode 源",
    icon: FileCog,
    keywords: "config json jsonc source formatter lsp snapshots compaction warming",
    group: "OpenCode",
  },
  {
    id: "diagnostics",
    label: "诊断",
    description: "实时性能和运行时信号",
    icon: Activity,
    keywords: "diagnostics performance cpu memory gpu frames react scan renderer processes",
    group: "System",
  },
  {
    id: "about",
    label: "关于",
    description: "Palot 和 OpenCode 服务",
    icon: Server,
    keywords: "version pid binary service restart runtime",
    group: "System",
  },
];
