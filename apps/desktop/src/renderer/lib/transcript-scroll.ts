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
