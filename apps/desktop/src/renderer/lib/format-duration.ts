/**
 * 中文时长文案。
 *
 * 默认：`45 秒` / `1 分 05 秒` / `1 分`。
 * - `padSeconds`：整分时也带秒（流式进行中的计时，避免每分钟宽度跳一次）。
 * - `hideZeroSeconds`：整分时省略「00 秒」（已完成的耗时，越短越好）。
 */
export function formatDurationCn(
  seconds: number,
  options: { padSeconds?: boolean; hideZeroSeconds?: boolean } = {},
): string {
  const total = Math.max(0, Math.floor(seconds));
  if (total < 60) return `${total} 秒`;
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  if (remainder === 0 && options.hideZeroSeconds) return `${minutes} 分`;
  const tail = options.padSeconds ? String(remainder).padStart(2, "0") : String(remainder);
  return `${minutes} 分 ${tail} 秒`;
}

/** 带小时档：`45 秒` / `1 分 05 秒` / `2 小时 07 分`。 */
export function formatDurationCnWithHours(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  if (total < 60) return `${total} 秒`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} 分 ${String(total % 60).padStart(2, "0")} 秒`;
  return `${Math.floor(minutes / 60)} 小时 ${String(minutes % 60).padStart(2, "0")} 分`;
}
