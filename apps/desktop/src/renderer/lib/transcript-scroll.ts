export const TRANSCRIPT_BOTTOM_THRESHOLD = 40;

/**
 * Rounds a scroll offset to whole device pixels. Text painted at a fractional
 * offset is rasterized at subpixel positions, so the glyphs visibly swim each
 * time the fraction changes — the transcript "抖" while a reply streams.
 */
export function snapToDevicePixel(value: number, ratio = globalThis.devicePixelRatio || 1): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * ratio) / ratio;
}

/** Direction of a browser scroll key, excluding controls that own keyboard input. */
export function transcriptKeyboardScrollDelta(event: {
  key: string;
  target: EventTarget | null;
  defaultPrevented: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): number {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return 0;
  const target = event.target instanceof Element ? event.target : null;
  if (
    target?.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="listbox"], [role="combobox"], [role="slider"], [role="spinbutton"], [role="tree"], [role="menu"], [role="tablist"], [role="grid"]',
    )
  )
    return 0;
  if (event.key === " " && target?.closest('button, [role="button"]')) return 0;
  if (["ArrowUp", "PageUp", "Home"].includes(event.key)) return -1;
  if (["ArrowDown", "PageDown", "End"].includes(event.key)) return 1;
  return event.key === " " ? (event.shiftKey ? -1 : 1) : 0;
}

export interface TranscriptScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/** 缓动到底时允许的残差（CSS px）。浏览器真实可滚动的最大值常常比
 * `scrollHeight - clientHeight` 小零点几像素，阈值取 0.5 会让跟随停在
 * “差一点点”的状态里反复重写，所以要留出 1px 的余量。 */
/** 上方内容长高会把可见文字整体推下去，补回同样的滚动量即可让它原地不动。
 * 返回修正后的 scrollTop；不需要修正时返回 null。
 * - `previousAnchorTop` / `anchorTop` 用分数坐标（offsetTop 是整数，dpr=2.4 下会
 *   在相邻帧之间来回取整，照着补就是 0.2~1px 的高频抖动）。
 * - 阈值取 0.5px：更小的位移肉眼不可见，补了只是徒增重绘。 */
export function anchorScrollCompensation(input: {
  scrollTop: number;
  previousAnchorTop: number;
  anchorTop: number;
  thresholdPx?: number;
}): number | null {
  const shift = input.anchorTop - input.previousAnchorTop;
  const threshold = input.thresholdPx ?? 0.5;
  if (Math.abs(shift) <= threshold) return null;
  // 必须写「精确的小数」：内容坐标本身就是小数（dpr=2.4 时 16px 的布局增量
  // 对应 15.83px 的滚动量），一旦按设备像素取整就会留下 0.17px 残差 —— 每次
  // 增长留一点，累积成 1px 的来回，文字边缘的子像素抗锯齿跟着变，看起来就是
  // 「闪」。不取整时可见位置严格不动。
  return input.scrollTop + shift;
}

export const BOTTOM_FOLLOW_SETTLE_PX = 1;

/** 用户要求减少动效时，底边跟随直接落位，不再逐帧滑过去。 */
export function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export interface BottomFollowFrame {
  /** 这一帧应写入的 scrollTop（已对齐设备像素）。 */
  scrollTop: number;
  /** 写入后是否已贴底，可以停表。 */
  settled: boolean;
}

/**
 * 流式回复的底边跟随为什么需要缓动：服务端一次数据块过来，markdown 是**整块**
 * 挂上去的，滚动高度会一步长 50~200px。一帧就直接跳到新的底部，屏幕上已有的
 * 文字就是「啪」地跳一下 —— 用户说的「文字还是会跳动」正是这个。
 *
 * 这里按剩余距离的比例逐帧靠近（首帧最多 maxStep），100px 的增长摊成十几帧、
 * 约 250ms 的连续上移，眼睛看到的是滑动而不是跳跃。目标每帧重取，边流边跟。
 */
/** 匀速跟随：把「内容长高的平均速率」低通成一个速度，每帧按这个速度推进，
 * 残差只做很小的比例修正，并硬性限制单帧步长。
 *
 * 为什么不是「按剩余距离缓动」：内容是一批一批到的（终端输出一行 16px、正文
 * 一块 10px），缓动每次都要从零速重新起步 —— 每批都是「猛冲 5px → 衰减到
 * 0.8px → 停」，一秒三次，眼睛看到的就是闪。匀速跟随的速度跨批次延续，
 * 视觉上是持续滑动；`maxStepPx` 让「一帧跳一大截」在物理上不可能发生。 */
export function smoothBottomFollow(input: {
  current: number;
  target: number;
  /** 平滑后的内容增长速率（px/秒），由 noteGrowthRate 维护 */
  ratePerSecond: number;
  /** 本帧时长（毫秒），用于把速率换算成位移 */
  deltaMs: number;
  /** 单帧最大推进量（CSS px）。给定上限 = 永远不会出现肉眼可见的跳变。 */
  maxStepPx?: number;
  /** 允许保留的滞后量（CSS px），用来吸收批次尖峰。 */
  lagBudgetPx?: number;
  /** 稳定状态下的目标滞后（CSS px）。 */
  lagTargetPx?: number;
  settlePx?: number;
}): BottomFollowFrame | null {
  const settle = input.settlePx ?? BOTTOM_FOLLOW_SETTLE_PX;
  const distance = input.target - input.current;
  if (Math.abs(distance) <= settle) return null;

  const dt = Math.min(64, Math.max(4, input.deltaMs)) / 1000;
  // 上限随「还差多少」放大：差一行时严格按 3px/帧滑（肉眼是滑动不是跳动），
  // 差一大块时允许更快，否则大段内容要好几秒才追平。
  const maxStep =
    input.maxStepPx ?? Math.max(SMOOTH_FOLLOW_MAX_STEP_PX, Math.abs(distance) * 0.15);
  const lagBudget = input.lagBudgetPx ?? SMOOTH_FOLLOW_LAG_BUDGET_PX;
  const lagTarget = input.lagTargetPx ?? SMOOTH_FOLLOW_LAG_TARGET_PX;
  const rate = Math.max(0, input.ratePerSecond);
  // 主项：按「内容到来的平均速率」匀速前进 —— 这就是连续滑动的来源。
  // 副项：把滞后缓慢拉回半个行高。这一项必须很小，大了就退化成「猛冲」，小了
  // 则速度估计的误差会把滞后耗干（滞后归零 ⇒ 空转帧 ⇒ 滑一下停一下）。
  let step = rate * dt + (distance - lagTarget) * SMOOTH_FOLLOW_LAG_GAIN;
  // 滞后超过预算（默认一行）才额外去追，避免大段内容要好几秒才追平。
  if (distance > lagBudget) step = Math.max(step, Math.min(distance - lagBudget, maxStep));
  // 流停了（速率掉下来）就收尾，别把最后一行永远留在视口外。
  if (rate < SMOOTH_FOLLOW_IDLE_RATE) step = Math.max(step, distance * SMOOTH_FOLLOW_IDLE_GAIN);
  if (distance < 0) step = Math.min(-settle * 0.5, step);
  step = Math.sign(step) * Math.min(Math.abs(step), maxStep);
  // 永不越过目标：越过就等于往回拉，看起来正是抖动。
  step = distance > 0 ? Math.min(step, distance) : Math.max(step, distance);
  if (Math.abs(step) < 0.05) return null;
  const next = input.current + step;
  return { scrollTop: next, settled: Math.abs(input.target - next) <= settle };
}

/** 单帧最大推进量：16px 一行会在 ≥6 帧里滑完，肉眼看到的是滑动而不是跳跃。 */
export const SMOOTH_FOLLOW_MAX_STEP_PX = 3;
/** 允许保留的滞后（CSS px）：约一行。靠这点缓冲把「一批内容一次到达」摊成匀速滑动。 */
export const SMOOTH_FOLLOW_LAG_BUDGET_PX = 20;
/** 稳定状态下的目标滞后 = 半行。留一点缓冲，运动的节奏就由跟随器决定而不是被批次牵着走。 */
export const SMOOTH_FOLLOW_LAG_TARGET_PX = 10;
/** 把滞后拉回目标值的增益。必须小（≤0.1），否则又变回「按剩余距离猛冲」。 */
export const SMOOTH_FOLLOW_LAG_GAIN = 0.08;
/** 速率低于这个值就认为流停了，开始收尾追平。 */
export const SMOOTH_FOLLOW_IDLE_RATE = 24;
/** 收尾阶段每帧消掉的残差比例。 */
export const SMOOTH_FOLLOW_IDLE_GAIN = 0.25;
/** 速率估计的低通时间常数：越小越灵敏，越大越平滑。 */
export const SMOOTH_FOLLOW_RATE_TAU_MS = 160;

/** 用内容高度增量估计「每秒长高多少」，并做低通。
 * 只在真实增长时更新；不增长时缓慢衰减，避免突然停流后还在往前冲。 */
export function noteGrowthRate(input: {
  scrollHeight: number;
  previousScrollHeight: number | null;
  previousAt: number | null;
  at: number;
  ratePerSecond: number;
}): number {
  const previous = input.previousScrollHeight;
  const previousAt = input.previousAt;
  if (previous === null || previousAt === null) return input.ratePerSecond;
  const deltaMs = input.at - previousAt;
  if (deltaMs < 6) return input.ratePerSecond;
  const grown = input.scrollHeight - previous;
  if (grown <= 0) {
    // 没有新增内容：速率按时间常数衰减，不要保留旧的冲锋速度。
    const decay = Math.exp(-deltaMs / (SMOOTH_FOLLOW_RATE_TAU_MS * 2));
    return input.ratePerSecond * decay;
  }
  const instant = (grown / Math.max(deltaMs, 8)) * 1000;
  const alpha = 1 - Math.exp(-deltaMs / SMOOTH_FOLLOW_RATE_TAU_MS);
  const next = input.ratePerSecond + (instant - input.ratePerSecond) * alpha;
  return Math.min(next, 6_000);
}

export type TranscriptScrollIntent = "up" | "scrollbar" | "anchor" | null;

export interface TranscriptScrollFrame {
  current: number | null;
}

export function scheduleTranscriptScrollFrame(
  frame: TranscriptScrollFrame,
  callback: () => void,
): void {
  if (frame.current !== null) return;
  frame.current = requestAnimationFrame(() => {
    frame.current = null;
    callback();
  });
}

export function cancelTranscriptScrollFrame(frame: TranscriptScrollFrame): void {
  if (frame.current === null) return;
  cancelAnimationFrame(frame.current);
  frame.current = null;
}

export function transcriptDistanceFromBottom(metrics: TranscriptScrollMetrics): number {
  return Math.max(0, metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight);
}

/**
 * Offset that re-pins the live edge, or `null` when the viewport should stay put.
 *
 * A streaming reply grows after the commit that produced it, so the browser can
 * paint one frame with the transcript lifted and only then run the bottom
 * follow — the text slides up and snaps back, once per burst. Re-reading the
 * geometry every frame and correcting before paint removes that lifted frame.
 * Large distances are real layout changes (a replaced message), not streaming
 * growth, and are left to the follow so the page does not drag the reader down.
 */
export function pinnedTranscriptScrollTop(
  metrics: TranscriptScrollMetrics,
  options: { maxDistance?: number } = {},
): number | null {
  const distance = transcriptDistanceFromBottom(metrics);
  if (distance <= 0.5) return null;
  const maxDistance = options.maxDistance ?? Number.POSITIVE_INFINITY;
  if (distance > maxDistance) return null;
  return snapToDevicePixel(Math.max(0, metrics.scrollHeight - metrics.clientHeight));
}

export function transcriptScrollTargetConsumesDelta(
  metrics: TranscriptScrollMetrics,
  delta: number,
): boolean {
  if (delta < 0) return metrics.scrollTop > 1;
  if (delta > 0) return transcriptDistanceFromBottom(metrics) > 1;
  return false;
}

export interface TranscriptBottomLockInput {
  current: boolean;
  metrics: TranscriptScrollMetrics;
  previousScrollTop: number | null;
  intent: TranscriptScrollIntent;
  threshold?: number;
}

/** Read geometry only when a scroll event can change the reader's bottom lock. */
export function readTranscriptScrollUpdate(
  input: TranscriptBottomLockInput,
): { locked: boolean; scrollTop: number } | null {
  // Programmatic bottom-follow/layout scrolls cannot unlock without user intent.
  // Reading even scrollTop here can force style/layout after intervening DOM writes.
  // Bottom-follow records its actual offset; scrollbar gestures capture their own start.
  if (input.current && input.intent === null) return null;
  return { locked: nextTranscriptBottomLock(input), scrollTop: input.metrics.scrollTop };
}

export function nextTranscriptBottomLock(input: TranscriptBottomLockInput): boolean {
  const threshold = input.threshold ?? TRANSCRIPT_BOTTOM_THRESHOLD;
  if (input.intent === "anchor" || input.intent === "up") return false;
  if (
    input.intent === "scrollbar" &&
    input.previousScrollTop !== null &&
    input.metrics.scrollTop < input.previousScrollTop
  ) {
    return false;
  }
  if (transcriptDistanceFromBottom(input.metrics) <= threshold) {
    if (input.current || input.previousScrollTop === null) return true;
    return input.metrics.scrollTop >= input.previousScrollTop;
  }
  return input.current;
}

export function normalizeTranscriptWheelDelta(input: {
  deltaY: number;
  deltaMode: number;
  viewportHeight: number;
}): number {
  if (input.deltaMode === 1) return input.deltaY * 40;
  if (input.deltaMode === 2) return input.deltaY * input.viewportHeight;
  return input.deltaY;
}

/** 加载更早的消息时，重建阅读位置所需的逐帧输入。 */
export interface PrependAnchorFrameInput {
  /** 记锚点时，锚点行顶部相对视口顶部的位置。 */
  anchorViewportTop: number;
  /** 锚点行当前的视口顶部；行不在虚拟窗口里时为 null。 */
  anchorTop: number | null;
  viewportTop: number;
  scrollTop: number;
  scrollHeight: number;
  /** 记锚点时的滚动高度与 scrollTop，用于锚点行不可见时的整体平移。 */
  fallbackHeight: number;
  fallbackScrollTop: number;
  /** 新一页是否已经落地（行数变多，或滚动高度变大）。 */
  landed: boolean;
  /** 上一帧的滚动高度，用来判断行高是否还在变。 */
  previousScrollHeight: number;
  stableFrames: number;
  /** 新一页落地的那一刻；还没落地为 null。 */
  landedAt: number | null;
  waitStartedAt: number;
  now: number;
  waitTimeoutMs: number;
  settleTimeoutMs: number;
  stableFrameTarget: number;
}

export interface PrependAnchorFrameResult {
  /** 这一帧应该写入的 scrollTop；null 表示不用动。 */
  scrollTop: number | null;
  previousScrollHeight: number;
  landedAt: number | null;
  stableFrames: number;
  /** 锚点使命结束（已稳定，或等超时）。 */
  done: boolean;
}

/**
 * 逐帧决定「加载更早消息」之后怎么保住阅读位置。
 *
 * 关键点：新一页还没落地时**不能**提前收工 —— 内容晚到一步就没人补偿，
 * 视图会整体上移，用户看到的是「滑上去加载，结果跳回对话开头」。
 * 同理，落地后要等行高也稳下来（图片、字体、高亮都是后到的），不然
 * 补偿过的位置会被后到的测量再次顶走。
 */
export function prependAnchorFrame(input: PrependAnchorFrameInput): PrependAnchorFrameResult {
  if (!input.landed) {
    return {
      scrollTop: null,
      previousScrollHeight: input.scrollHeight,
      landedAt: null,
      stableFrames: input.stableFrames,
      done: input.now - input.waitStartedAt >= input.waitTimeoutMs,
    };
  }
  const landedAt = input.landedAt ?? input.now;
  let scrollTop: number | null = null;
  let stableFrames = input.stableFrames;
  let corrected = false;

  if (input.anchorTop !== null) {
    const correction = input.anchorTop - input.viewportTop - input.anchorViewportTop;
    if (Math.abs(correction) > 0.5) {
      scrollTop = snapToDevicePixel(input.scrollTop + correction);
      corrected = true;
    }
    stableFrames = Math.abs(correction) <= 0.5 ? stableFrames + 1 : 0;
  } else {
    // 锚点行不在虚拟窗口里，只能按新增高度整体平移。
    const target = input.fallbackScrollTop + Math.max(0, input.scrollHeight - input.fallbackHeight);
    if (Math.abs(target - input.scrollTop) > 0.5) {
      scrollTop = snapToDevicePixel(target);
      corrected = true;
    }
    stableFrames = 0;
  }

  const heightChanged = input.scrollHeight !== input.previousScrollHeight;
  if (heightChanged || corrected) stableFrames = 0;

  const timedOut = input.now - landedAt >= input.settleTimeoutMs;
  return {
    scrollTop,
    previousScrollHeight: input.scrollHeight,
    landedAt,
    stableFrames,
    done: stableFrames >= input.stableFrameTarget || timedOut,
  };
}
