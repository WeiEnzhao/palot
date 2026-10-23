/**
 * 服务端错误文案本地化。
 *
 * 转写说明：模型/服务端返回的 error 是一段英文原文（例如
 * `Model unavailable: opencode/minimax-m3.1-flash-free`、
 * `This model is not available in your country`），它会原样出现在「响应失败」
 * 卡片里。这一类文案不属于我们自己的界面字符串，所以不在组件里硬写，而是集中在
 * 这里按「已知模式 → 中文模板」匹配。
 *
 * 原则：
 * 1. 只翻译能确定含义的固定句式；型号名、URL、ID 一律原样保留。
 * 2. 匹配不上就原样返回 —— 宁可露出英文，也不要把用户看不懂的报错改写成错的。
 * 3. 模板里用捕获组回填标识符，避免把 `opencode/xxx` 这类名字翻掉。
 */

interface ErrorTextRule {
  readonly pattern: RegExp;
  readonly render: (match: RegExpMatchArray) => string;
}

const RULES: readonly ErrorTextRule[] = [
  // Model unavailable: <provider/model>
  {
    pattern: /^model\s+unavailable\s*:?\s*(.*)$/i,
    render: (m) => {
      const model = m[1]?.trim();
      return model ? `模型不可用：${model}` : "模型不可用";
    },
  },
  // This model is not available in your country
  {
    pattern: /not\s+available\s+in\s+your\s+(country|region)/i,
    render: () => "该模型在你所在的国家或地区不可用",
  },
  {
    pattern: /^no\s+such\s+model\b/i,
    render: (m) => `模型不存在：${m.input?.trim() ?? ""}`.replace(/\s+$/, ""),
  },
  {
    pattern: /^rate\s+limit(ed)?\b/i,
    render: () => "请求被限速，请稍后再试",
  },
  {
    pattern: /^too\s+many\s+requests\b/i,
    render: () => "请求过于频繁，请稍后再试",
  },
  {
    pattern: /^unauthorized\b|^401\b/i,
    render: () => "未授权：请检查账号或密钥",
  },
  {
    pattern: /^forbidden\b|^403\b/i,
    render: () => "没有访问权限",
  },
  {
    pattern: /^insufficient\s+(quota|balance|credit)/i,
    render: () => "额度不足",
  },
  {
    pattern: /^context\s+(length|window)\b|exceeds?\s+the\s+context/i,
    render: () => "上下文长度超出模型上限",
  },
  {
    pattern: /^service\s+unavailable\b|^503\b|^overloaded\b/i,
    render: () => "服务暂时不可用，请稍后再试",
  },
  {
    pattern: /\btimed?\s*out\b|^timeout\b/i,
    render: () => "请求超时",
  },
  {
    pattern: /^(network|connection)\s+(error|failed|lost)\b/i,
    render: () => "网络连接失败",
  },
  {
    pattern: /^invalid\s+api\s+key\b/i,
    render: () => "API 密钥无效",
  },
];

/** 把服务端错误原文转成中文；识别不了的原样返回（绝不丢信息）。 */
export function localizeErrorText(text: string | null | undefined): string | undefined {
  const raw = text?.trim();
  if (!raw) return undefined;
  for (const rule of RULES) {
    const match = raw.match(rule.pattern);
    if (match) return rule.render(match);
  }
  return raw;
}
