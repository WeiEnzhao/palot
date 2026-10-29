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

/** 向下对齐到设备像素网格。贴底写入只能用它，见 `bottomScrollTarget`。 */
export function floorToDevicePixel(value: number, ratio = globalThis.devicePixelRatio || 1): number {
  if (!Number.isFinite(value)) return 0;
  return Math.floor(value * ratio) / ratio;
}

/**
 * 贴底写入的**唯一**落点：设备像素网格上、且绝不超过真实最大值的那一格。
 *
 * 为什么必须是向下取整：
 * `scrollTop` 的最大合法值就是 `scrollHeight - clientHeight`。四舍五入有一半的帧
 * 会落到网格上但**越过**这个上限，浏览器把值钳回上限 ⇒ 实际偏移又回到小数位
 * ⇒ 整层文字被亚像素重采样 ⇒ 边缘忽清忽糊。也就是说"吸附"在这些帧里根本没生效，
 * 而且被钳回来的位置与相邻帧差半个设备像素 —— 正是「整体文案小幅上下跳动」的来源。
 *
 * 向下取整永远 ≤ 上限：写进去就是写进去，浏览器不会钳、不会回退、不会重采样。
 * 代价是底边最多剩 1 个设备像素的空隙（dpr=2.4 时 0.42 CSS px，且有 paddingEnd
 * 16px 在下面垫着），肉眼不可见。
 *
 * ⚠️ 所有写贴底位置的路径都必须用这个函数取落点。谁自己 `Math.round` 一次，
 * 就会和邻居差一个设备像素、来回跳。
 */
export function bottomScrollTarget(
  metrics: { scrollHeight: number; clientHeight: number },
  ratio = globalThis.devicePixelRatio || 1,
): number {
  return floorToDevicePixel(Math.max(0, metrics.scrollHeight - metrics.clientHeight), ratio);
}

/**
 * 把视口钉在底部，并落在**真实上限**的设备像素下限格上。返回写入的目标值。
 *
 * 🔴 为什么不能直接写 `scrollHeight - clientHeight`：
 * 这两个属性都是**整数**（浏览器各自四舍五入后返回），相减会**高估**真实上限最多
 * 约 1px；而真实上限是小数（内容高度本身是小数）。写超过上限的值，浏览器会悄悄
 * 钳回真实上限 —— 于是"设备像素对齐"从来没真正生效过：
 *
 *   探针实测（dpr=2.4、流式）：我们写 5237.92，读回却是 5237.50，
 *   差整整 0.42px（一个设备像素），且**每帧重复一次**。
 *
 * 位置永远停在真实上限的小数位上 ⇒ 每批内容到达时文字栅格化相位变一次 ⇒
 * 用户看到的就是「整体文案小幅上下跳动、幅度很小、每秒好几次」。
 *
 * 解法：先用一个必然越界的值把浏览器自己的上限"问"出来（被钳位后的读回值就是
 * 精确的真实上限），再对它向下取整。两次写入在同一个 JS 任务里完成，只产生一次
 * 绘制；第二次只在需要下移时发生。
 */
export function pinBottomScroll(
  el: { scrollTop: number; scrollHeight: number; clientHeight: number },
  ratio = globalThis.devicePixelRatio || 1,
): number {
  // scrollHeight + clientHeight 必然大于真实上限 `内容高 - clientHeight`。
  el.scrollTop = el.scrollHeight + el.clientHeight;
  const trueMax = el.scrollTop;
  if (!Number.isFinite(trueMax)) return 0;
  const target = floorToDevicePixel(trueMax, ratio);
  // 无条件再写一次：探针值把位置停在真实上限上（通常是小数），必须落到网格上。
  // 两者相等时这次写入是空操作，不会产生第二帧绘制。
  el.scrollTop = target;
  return target;
}

/**
 * 流式贴底时**要不要再写一次**：内容一变就写，内容没变且已贴底就不写。
 *
 * 这里是「贴底写平」的判定，不是「平滑跟随」。用逐帧探针在真机上对比过两版
 * （2026-10-28，dpr=2.4，同一台机、同一种输出节奏）：
 *
 * | 版本 | 文字在屏幕上的位移帧 | 平均滞后 |
 * |---|---|---|
 * | 写平（本函数） | 0 / 140000 帧 | 0px |
 * | 速率平滑跟随 | 少但滞后长期存在 | **191px** |
 *
 * 写平的意思是：内容长 32px，**同一帧里**就把 scrollTop 加 32px。这样
 * `内容坐标 - scrollTop` 对每个已渲染的字都不变 —— 屏幕上一个像素都不动，
 * 只有新落地的行在原位出现。平滑跟随则相反：它把 32px 摊到几百毫秒里滑，
 * 屏幕上正在读的字持续上移，同时滞后越攒越多，攒够了再追一段 —— 那就是
 * 用户说的「上下跳动」。
 *
 * 写平能干净，前提是写入位置落在设备像素网格上、且不越过浏览器真实上限
 * （见 `pinBottomScroll` / `floorToDevicePixel`）：否则每次补偿留一点亚像素
 * 残差，文字边缘的抗锯齿跟着变 —— 那是另一种「闪」。
 *
 * @param target 当前 `scrollHeight - clientHeight`（整数，比真实上限可能高 ≤1px）
 * @param previousTarget 上一帧的同一个值；null = 首次
 */
export function needsBottomPin(input: {
  target: number;
  scrollTop: number;
  previousTarget: number | null;
  devicePixelRatio?: number;
}): boolean {
  if (input.previousTarget === null) return true;
  if (Math.abs(input.target - input.previousTarget) > 0.001) return true;
  // 死区 = 「整数相减」的高估（≤1px）+「网格取整」的舍入（≤1 设备像素）。落在死区
  // 里就等于已经贴底了，再写只会写回同一个数（每帧重写会白白触发滚动事件）。
  const ratio = input.devicePixelRatio ?? globalThis.devicePixelRatio ?? 1;
  return input.scrollTop < input.target - (1 + 1 / ratio + 0.01);
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
  /** 这一帧应写入的 scrollTop（已对齐设备像素）；null = 本帧不动。 */
  scrollTop: number | null;
  /** 本帧结束后的跟随速度（px/秒），下一帧传回来做速度低通。 */
  speedPxPerSecond: number;
  /** 写入后是否已贴底，可以停表。 */
  settled: boolean;
}

/**
 * 流式跟随 = **速度状态机**，不是「按距离缓动」。
 *
 * 为什么：内容高度是「整行跳」的（一行 16~25px，一秒 3~8 次）。任何「按剩余
 * 距离缓动」的实现都会在每批内容到达时从 0 速起步：一批 = 猛冲 3.5px/帧 →
 * 减速 → 停，一秒重复四五次 —— 肉眼看到的就是「跳」。上一版在滞后超过预算时
 * 还会额外切到追赶分支，速度在 1px/帧 与 3.5px/帧 之间硬切，等于每批都抖一下。
 *
 * 现在：速度本身是状态（`speedPxPerSecond`），每帧只做低通（110ms 时间常数），
 * 一批内容只会让速度「平滑地加速一点」，绝不会 0↔3.5px 硬切；流式期间还保留
 * 一行（16px）的滞后作为缓冲，跟随器任何时候都有余量往前走，不会追到底之后
 * 停住等下一批。
 */
export function smoothBottomFollow(input: {
  current: number;
  target: number;
  /** 平滑后的内容增长速率（px/秒），由 noteGrowthRate 维护 */
  ratePerSecond: number;
  /** 本帧时长（毫秒），用于把速率换算成位移 */
  deltaMs: number;
  /** 上一帧的跟随速度（px/秒），由本函数返回、调用方逐帧传回。 */
  speedPxPerSecond?: number;
  /** 正在流式输出：保留一行滞后做缓冲，速度由内容增长速率驱动。 */
  streaming?: boolean;
  /** 单帧最大推进量（CSS px）。给定上限 = 永远不会出现肉眼可见的跳变。 */
  maxStepPx?: number;
  /** 设备像素比，用于把落位对齐到设备像素网格。 */
  devicePixelRatio?: number;
  settlePx?: number;
  /** 超过这个距离就直接落位、不再逐帧跟随。 */
  snapBeyondPx?: number;
  /** 上一帧的目标值（scrollHeight - clientHeight），用来识别「一整块布局跳变」。 */
  previousTarget?: number;
}): BottomFollowFrame {
  const settle = input.settlePx ?? BOTTOM_FOLLOW_SETTLE_PX;
  const ratio = input.devicePixelRatio ?? globalThis.devicePixelRatio ?? 1;
  const grid = 1 / ratio;
  const dt = Math.min(64, Math.max(4, input.deltaMs));
  const dtSec = dt / 1000;
  const streaming = input.streaming ?? false;
  const rate = Math.max(0, input.ratePerSecond);
  const distance = input.target - input.current;
  const previousSpeed = Math.max(0, input.speedPxPerSecond ?? 0);
  const maxStep = input.maxStepPx ?? SMOOTH_FOLLOW_BIG_STEP_CAP_PX;

  // 距离过大 = 布局刚整体变过（首屏落位、异步补页、窗口从后台恢复）。
  // 这时逐帧滑过去会变成「从对话开头一路滚到结尾」的长镜头 —— 用户看到的是
  // 「打开任务时从最早的消息开始」，而不是直接看结尾。这种距离不是「跟随」，
  // 是「落位」，必须一次写完。
  const snapBeyond = input.snapBeyondPx ?? SMOOTH_FOLLOW_SNAP_BEYOND_PX;
  // 目标在一帧里跳了一大截（>120px）= 布局重新测量（虚拟列表补行、首屏落位、
  // 折叠块展开），不是流式文字。这种跳变逐帧追会变成一段莫名其妙的滑行，
  // 而且它通常发生在「内容已经在屏幕上」之后，滑行是纯干扰 —— 直接落位。
  const targetJump =
    input.previousTarget === undefined ? 0 : input.target - input.previousTarget;
  // 没在流式输出时没有「跟随」可言：内容是一次性出现的，逐帧滑过去 = 「没人说话
  // 画面自己在动」。这时任何没贴底的差距都直接落位（只有残差级别才忽略）。
  //
  // 流式期间只认「距离超 1500px」这一种落位：代码块/表格在一帧里落地也会跳
  // 100~500px，但那时用户正在读屏幕上的字，瞬移会把他甩离阅读位置，平滑滑动
  // （12px/帧）反而更接近「滚动」而不是「跳」。
  // 调用方显式传 snapBeyondPx（含 0）= 到场稳定窗：距离超过它就落位，不滑。
  const layoutGap =
    input.snapBeyondPx !== undefined
      ? snapBeyond
      : streaming
        ? snapBeyond
        : Math.max(0.5, settle);
  const layoutJump = !streaming && targetJump > SMOOTH_FOLLOW_SNAP_GROWTH_PX;
  if (distance > layoutGap || layoutJump) {
    return {
      // 落位同样走「下限格」：这里是整块布局跳变（首屏落位、补页、窗口恢复），
      // 写完就没人再管它了 —— 如果写精确小数，合成器会一直在亚像素位置采样文字；
      // 如果四舍五入，则有一半概率被浏览器钳回上限、同样回到小数位。
      // 只有下限格是「写在网格上、且一定 ≤ 上限、浏览器不会改」的那个值。
      scrollTop: floorToDevicePixel(Math.max(0, input.target), ratio),
      speedPxPerSecond: 0,
      settled: true,
    };
  }

  const write = (step: number, speedForState: number): BottomFollowFrame => {
    let snapped = snapToDevicePixel(input.current + step, ratio);
    // 不足半个设备像素时**至少走一格**：绝不写亚像素，也绝不原地空转
    // （空转一帧，下一批内容就得重新起步，节奏立刻变成一顿一挫）。
    if (Math.abs(snapped - input.current) < 0.5 * grid) {
      snapped = input.current + Math.sign(step) * grid;
    }
    if (step > 0) {
      // ⚠️ 钳制必须用 `floorToDevicePixel`，不能用 `snapToDevicePixel`：
      // 目标值是 `scrollHeight - clientHeight`，本身就是 scrollTop 的上限；四舍五入
      // 会落到上限之上，浏览器钳回来 ⇒ 实际偏移变回小数 ⇒ 亚像素重采样（闪）。
      // 曾经这里 floor、调用方 round，两者差一个设备像素（dpr=2.4 = 0.4167px），
      // 交替执行时位置在两格之间来回跳 —— 现在两边都走"下限格"，写的是同一个数。
      if (snapped > input.target) snapped = floorToDevicePixel(input.target, ratio);
      if (snapped < input.current) snapped = input.current;
    } else {
      if (snapped < input.target) snapped = floorToDevicePixel(input.target, ratio);
      if (snapped > input.current) snapped = input.current;
    }
    return {
      scrollTop: snapped,
      // ⚠️ 存「控制器速度」，不要用「这一帧实际位移 / 帧长」反推：位移会被设备像素
      // 网格放大或压到 0（0.42px/16.7ms = 25px/s），状态里就会凭空出现 0↔25 的
      // 跳变，下一帧的低通起点跟着抖。
      speedPxPerSecond: speedForState,
      settled: Math.abs(input.target - snapped) <= settle,
    };
  };

  // 内容整块缩回（替换消息、渲染回滚）：同样慢慢退，不瞬移。
  if (distance < -settle) {
    const want = Math.max(0, (-distance - settle) * FOLLOW_LAG_GAIN_PER_SEC);
    const speed = lowPassSpeed(previousSpeed, want, dt);
    const step = -Math.min(speed * dtSec, -distance, maxStep);
    if (Math.abs(step) < 0.05) return { scrollTop: null, speedPxPerSecond: speed, settled: false };
    return write(step, speed);
  }
  if (distance <= settle) {
    // 已贴底：速度归零，等下一批内容（流式期间调用方让循环常驻）。
    return { scrollTop: null, speedPxPerSecond: lowPassSpeed(previousSpeed, 0, dt), settled: true };
  }

  // 流式期间滞后目标 = 一行（正好吃掉 paddingEnd 的空白，不会切到正文）；
  // 不流时滞后归零，收尾必须真正贴底。
  const lagTarget = streaming ? FOLLOW_LAG_TARGET_PX : 0;
  // 🔴 目标速度 = **内容增长速率（已低通）为主 + 误差的软修正**。
  //
  // 曾经用 `max(rate, (distance - lag) * 10)`：滞后 60px 就要 600px/s。逐帧实测
  // （2026-10-28，dpr=2.4、32px 一块落地）速度序列是
  //   75 → 453 → 321 → 427 → 365 → 250 → 150 → 153 …
  // 也就是「一有滞后就冲刺、追上了就刹车」，一个回合 100ms 内来回一次 ——
  // 用户看到的正是「上下抖动」。吐字本身是匀速的，速度就该是匀速的：
  // 主项只认速率，误差项把速度压在 ±(40px × 1.5/s) 的窄带里缓慢修正。
  const error = distance - lagTarget;
  const correction = Math.max(-FOLLOW_ERROR_CLAMP_PX, Math.min(FOLLOW_ERROR_CLAMP_PX, error));
  // 只有「真的堆住了」（滞后超过约 4 行）才额外加速，而且封顶：大段代码/表格落地时
  // 必须能追上，但绝不能因为一次滞后就冲到 900px/s 以上。
  const overflow = Math.max(0, error - FOLLOW_CATCHUP_START_PX);
  const ceiling = Math.max(rate * FOLLOW_CATCHUP_RATE_MULTIPLIER, FOLLOW_MAX_SPEED_PX);
  // 两种工况分开：
  // · 正在吐字（rate 高）→ 主驱动 = 速率，误差只做软修正（否则就是"冲刺—刹车"）
  // · 吐字基本停了（rate 低）→ 没有连续运动要保，直接按误差收敛，别磨叽几秒
  const want =
    rate >= FOLLOW_ACTIVE_RATE_PX
      ? Math.min(
          Math.max(0, rate + correction * FOLLOW_ERROR_GAIN_PER_SEC) +
            overflow * FOLLOW_CATCHUP_GAIN_PER_SEC,
          ceiling,
        )
      : Math.min(Math.max(0, rate + correction * FOLLOW_SETTLE_GAIN_PER_SEC), ceiling);
  // 低通之外再限一次「每帧最多涨这么多」（下限 40px/s）：40px/s 让跟随器在 ~8 帧
  // （133ms）内追上正常的吐字速率（约 300px/s），既不会起步太肉、也不会一帧猛冲。
  const smoothed = lowPassSpeed(previousSpeed, want, dt);
  const speed = Math.min(smoothed, previousSpeed + Math.max(40, previousSpeed * 0.25));
  if (speed * dtSec < 0.05 && rate <= 0) {
    return { scrollTop: null, speedPxPerSecond: speed, settled: false };
  }
  const step = Math.min(Math.max(speed * dtSec, grid), distance, maxStep);
  return write(step, speed);
}

/** 速度低通：绝不会一帧之内从 0 跳到 200px/s —— 那正是「猛冲一下」的来源。 */
export function lowPassSpeed(previous: number, target: number, deltaMs: number): number {
  if (!Number.isFinite(target)) return Math.max(0, previous);
  const alpha = 1 - Math.exp(-Math.max(1, deltaMs) / SMOOTH_FOLLOW_SPEED_TAU_MS);
  return Math.max(0, previous + (Math.max(0, target) - previous) * alpha);
}

/** 单帧最大推进量：16px 一行会在 ≥3 帧里滑完，肉眼看到的是滑动而不是跳跃。 */
export const SMOOTH_FOLLOW_MAX_STEP_PX = 3;
/**
 * 单帧步长上限（CSS px）。没有它时 step = 剩余距离 × 0.15 —— 差 1000px 就是
 * 150px/帧（≈9000px/s），屏幕上的文字等于被甩过去，用户看到的就是「跳」。
 * 12px/帧 ≈ 720px/s（120Hz 屏翻倍），是「快速滚动」而不是「瞬移」。
 */
export const SMOOTH_FOLLOW_BIG_STEP_CAP_PX = 12;
/** 流式期间的滞后目标 = 一行：跟随器永远有余量往前走，不会追到底再等下一批。 */
export const FOLLOW_LAG_TARGET_PX = 16;
/** 距离超过这个值就整块落位：跟随只负责「一小段」，不负责「从开头滚到结尾」。
 *  取 1500px（≈2.5 屏）：正常的整块内容（大代码块、表格、图片）仍走平滑跟随，
 *  只有「首屏落位 / 恢复整段布局」这种量级才瞬移。 */
export const SMOOTH_FOLLOW_SNAP_BEYOND_PX = 1500;
/** 单帧目标跳变超过这个值 = 布局重排（不是流式文字），直接落位。 */
export const SMOOTH_FOLLOW_SNAP_GROWTH_PX = 120;
/** 超出滞后目标的部分换算成额外速度的增益（1/秒）。 */
export const FOLLOW_LAG_GAIN_PER_SEC = 10;
/**
 * 滞后误差的**软**修正增益（1/秒）。主驱动是内容增长速率，误差只做微调：
 * 多滞后 40px 才多要 60px/s，而不是 400px/s。增益一大就变成「冲刺—刹车」，
 * 一个回合内速度来回一次 = 肉眼看到的上下抖动。
 */
export const FOLLOW_ERROR_GAIN_PER_SEC = 0.5;
/** 误差修正的钳位（px）：滞后超过它不再加码，避免大滞后又把速度顶起来。 */
export const FOLLOW_ERROR_CLAMP_PX = 40;
/** 超过这个滞后（≈4 行）才允许额外追赶：正常吐字的 16~32px 一块由滞后预算吸收。 */
export const FOLLOW_CATCHUP_START_PX = 72;
/** 追赶段的增益（1/秒）。 */
export const FOLLOW_CATCHUP_GAIN_PER_SEC = 6;
/** 速度上限至少这么高（大块内容落地时仍能追上）。 */
export const FOLLOW_MAX_SPEED_PX = 900;
/** 上限随内容速率上浮的倍数：吐字越快，允许的追赶速度越高。 */
export const FOLLOW_CATCHUP_RATE_MULTIPLIER = 1.5;
/** 判定「正在吐字」的速率门槛（px/s）。低于它按收尾工况处理。 */
export const FOLLOW_ACTIVE_RATE_PX = 60;
/** 收尾工况的误差增益（1/秒）：没有连续运动要保，直接收敛，别磨几秒。 */
export const FOLLOW_SETTLE_GAIN_PER_SEC = 4;
/** 速度低通时间常数（毫秒）：决定「加速」有多柔。 */
export const SMOOTH_FOLLOW_SPEED_TAU_MS = 220;
/** 滞后预算 / 空闲阈值 / 空闲增益（保留给旧调用方与测试引用）。 */
export const SMOOTH_FOLLOW_LAG_BUDGET_PX = 20;
export const SMOOTH_FOLLOW_LAG_TARGET_PX = 16;
export const SMOOTH_FOLLOW_LAG_GAIN = 0.08;
export const SMOOTH_FOLLOW_IDLE_RATE = 24;
export const SMOOTH_FOLLOW_IDLE_GAIN = 0.25;
/** 速率估计的低通时间常数：越小越灵敏，越大越平滑。 */
export const SMOOTH_FOLLOW_RATE_TAU_MS = 900;

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

/** 幂等闸：同一次增长只允许一个写者补一次。
 * 返回 true = 这次增长还没补过，调用方可以写 scrollTop；
 * 返回 false = 已经补过了，调用方让位。
 * - `scrollHeight` 是当前内容总高；`lastCompensatedHeight` 是上次补完时记录的值；
 * - 补完必须立刻用 `recordCompensated` 更新记录，否则下一次同高度还会再补；
 * - 内容缩回（替换消息、折叠块）时 `scrollHeight < lastCompensatedHeight`，放行让新主人重排。 */
export interface GrowthGateState {
  lastCompensatedHeight: number | null;
}

export function checkGrowthGate(
  scrollHeight: number,
  state: GrowthGateState,
): boolean {
  const last = state.lastCompensatedHeight;
  if (last === null) return true;
  // 内容缩回 = 布局重排（不是流式增长），放行让新主人补偿
  if (scrollHeight < last) return true;
  // 同一次增长（高度没变）：已经补过，不让第二个写者再写
  return scrollHeight > last;
}

export function recordCompensated(state: GrowthGateState, scrollHeight: number): void {
  state.lastCompensatedHeight = scrollHeight;
}

export function resetGrowthGate(state: GrowthGateState): void {
  state.lastCompensatedHeight = null;
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
  /** 最近一次用户手势（滚轮/键盘/触摸/滚动条按下）的时刻；null = 最近没有。 */
  userGestureAt?: number | null;
  /** 判定时刻，用来判断 userGestureAt 是否新鲜。 */
  now?: number;
}

/**
 * 贴底跟随是低速爬行：解锁后它已排定的帧仍会写一两笔 scrollTop。这笔写落在
 * 近底区时按「scrollTop ≥ 上次」就会被读回成"用户在往下滑"，把刚解开的锁
 * 又挂回去（2026-10-24 真机 lock 台账：距上滑=1ms、写 moves=+96、锁定仍=1，
 * 用户体感就是滚动区上下闪动）。所以未锁定时的再上锁只认 700ms 内的
 * 真人手势时间戳；程序写（爬行器收尾、补偿、虚拟器修正）一律不予采信。
 */
export const RELOCK_GESTURE_WINDOW_MS = 700;

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
    // 程序写（爬行器收尾帧等）不带手势时间戳：它永远不应把用户刚解开的锁挂回去。
    const stamp = input.userGestureAt ?? null;
    if (stamp === null) return false;
    if ((input.now ?? 0) - stamp > RELOCK_GESTURE_WINDOW_MS) return false;
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

/** 误差小于这个值才允许在超时时收工（约两行文字的高度，肉眼不再觉得"位置不对"）。 */
const PREPEND_ANCHOR_MAX_RESIDUAL_PX = 120;
/** 落地后再守这么多个 settle 窗口：迟到的测量（图片、代码高亮、字体）最狠的前几秒必须还在修。 */
const PREPEND_ANCHOR_GUARD_MULTIPLIER = 4;

/** 加载更早的消息时，重建阅读位置所需的逐帧输入。 */
export interface PrependAnchorFrameInput {
  /** 记锚点时，锚点行顶部相对视口顶部的位置。 */
  anchorViewportTop: number;
  /** 锚点行当前的视口顶部；行不在虚拟窗口里时为 null。 */
  anchorTop: number | null;
  /** 锚点行在内容坐标系中的起点（虚拟器模型给的值，行没挂载也拿得到）。 */
  anchorRowStart: number | null;
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
  // 这一帧想把 scrollTop 放到哪儿（收工判定要用它算残差）
  let desired: number | null = null;

  if (input.anchorRowStart !== null) {
    // 位置按虚拟器模型对齐，而不是按「累计新增高度」推算：
    // 新页的行先按估值占位、随后被真实高度反复修正，用累计差去补偿时
    // 每一步都踩在还没测准的数字上，收敛窗口一超时就只能停在半途（看起来就是
    // 「一上滑加载消息就直接跳到最上边」）。模型给的 start 与行实际的 top 同源，
    // 行在不在挂载窗口里都能算，行高修正时读数跟着模型一起挪，屏幕位置不会漂。
    const target = snapToDevicePixel(input.anchorRowStart - input.anchorViewportTop);
    desired = target;
    if (Math.abs(target - input.scrollTop) > 0.5) {
      scrollTop = target;
      corrected = true;
    }
    stableFrames = Math.abs(target - input.scrollTop) <= 0.5 ? stableFrames + 1 : 0;
  } else if (input.anchorTop !== null) {
    const correction = input.anchorTop - input.viewportTop - input.anchorViewportTop;
    desired = snapToDevicePixel(input.scrollTop + correction);
    if (Math.abs(correction) > 0.5) {
      scrollTop = desired;
      corrected = true;
    }
    stableFrames = Math.abs(correction) <= 0.5 ? stableFrames + 1 : 0;
  } else {
    // 锚点行不在虚拟窗口里，只能按新增高度整体平移。
    const target = input.fallbackScrollTop + Math.max(0, input.scrollHeight - input.fallbackHeight);
    desired = snapToDevicePixel(target);
    if (Math.abs(target - input.scrollTop) > 0.5) {
      scrollTop = desired;
      corrected = true;
    }
    stableFrames = 0;
  }

  const heightChanged = input.scrollHeight !== input.previousScrollHeight;
  if (heightChanged || corrected) stableFrames = 0;

  // 收工前先看还剩多少误差没修掉：新页的行高是「先估值占位、后真实测量」分批落地的，
  // 上面那些行每缩一次，锚点在模型里就往顶挪一次，补偿得跟着重算。以前只按「落地后
  // 4 秒」一刀切收工，误差还差几千像素就撒手 —— 后面几批测量继续缩，没人再修，
  // 视图就被一路顶到顶上：用户看到的是「一上滑加载消息，直接跳到最上边」。
  // 现在误差还在肉眼可见的范围里就不许收工（另设硬上限防止无限挂着）。
  const residualPx = desired === null ? 0 : Math.abs(desired - input.scrollTop);
  const sinceLanding = input.now - landedAt;
  const guardMs = input.settleTimeoutMs * PREPEND_ANCHOR_GUARD_MULTIPLIER;
  const done =
    sinceLanding >= guardMs ||
    stableFrames >= input.stableFrameTarget ||
    (sinceLanding >= input.settleTimeoutMs && residualPx <= PREPEND_ANCHOR_MAX_RESIDUAL_PX);
  return {
    scrollTop,
    previousScrollHeight: input.scrollHeight,
    landedAt,
    stableFrames,
    done,
  };
}
