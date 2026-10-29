import { describe, expect, it, vi } from "vitest";
import {
  cancelTranscriptScrollFrame,
  anchorScrollCompensation,
  bottomScrollTarget,
  floorToDevicePixel,
  pinBottomScroll,
  needsBottomPin,
  noteGrowthRate,
  smoothBottomFollow,
  SMOOTH_FOLLOW_BIG_STEP_CAP_PX,
  FOLLOW_LAG_TARGET_PX,
  SMOOTH_FOLLOW_SNAP_BEYOND_PX,
  nextTranscriptBottomLock,
  normalizeTranscriptWheelDelta,
  pinnedTranscriptScrollTop,
  prependAnchorFrame,
  readTranscriptScrollUpdate,
  scheduleTranscriptScrollFrame,
  snapToDevicePixel,
  transcriptDistanceFromBottom,
  transcriptKeyboardScrollDelta,
  transcriptScrollTargetConsumesDelta,
  checkGrowthGate,
  recordCompensated,
  resetGrowthGate,
} from "./transcript-scroll";

describe("device pixel snapping", () => {
  it("lands the offset on whole device pixels", () => {
    // A fractional offset repaints the transcript text at subpixel positions, so
    // the glyphs swim whenever the fraction changes.
    expect(snapToDevicePixel(5233.03, 2)).toBe(5233);
    expect(snapToDevicePixel(5301.12, 2)).toBe(5301);
    expect(snapToDevicePixel(5301.5, 2)).toBe(5301.5);
  });
  it("keeps the ratio for scaled displays", () => {
    expect(snapToDevicePixel(100.4, 2.5)).toBe(100.4);
    expect(snapToDevicePixel(100.42, 2.5)).toBe(100.4);
  });
  it("passes through invalid offsets safely", () => {
    expect(snapToDevicePixel(Number.NaN, 2)).toBe(0);
    expect(snapToDevicePixel(Number.POSITIVE_INFINITY, 2)).toBe(0);
  });
});

describe("bottom target", () => {
  it("never exceeds the real maximum scroll offset", () => {
    // scrollTop 的上限就是 scrollHeight - clientHeight。任何越过它的值都会被浏览器
    // 钳回上限，实际偏移因此回到小数位 ⇒ 整层文字亚像素重采样 ⇒ 边缘忽清忽糊。
    // 四舍五入有一半的帧会越过，这正是「吸附写了但一半帧没生效」的原因。
    for (const ratio of [1, 1.25, 1.5, 2, 2.4, 3]) {
      for (let scrollHeight = 1000; scrollHeight < 1012; scrollHeight += 0.37) {
        const max = scrollHeight - 400;
        const write = bottomScrollTarget({ scrollHeight, clientHeight: 400 }, ratio);
        expect(write).toBeLessThanOrEqual(max + 1e-9);
        expect(max - write).toBeLessThan(1 / ratio + 1e-9);
      }
    }
  });

  it("stays on the device pixel grid at any ratio", () => {
    for (const ratio of [1, 1.25, 1.5, 2, 2.4, 3]) {
      const write = bottomScrollTarget({ scrollHeight: 1024.3, clientHeight: 400 }, ratio);
      expect(write).toBeCloseTo(floorToDevicePixel(1024.3 - 400, ratio), 10);
      const grid = (write * ratio) % 1;
      expect(Math.min(grid, 1 - grid)).toBeLessThan(1e-6);
    }
  });

  it("is the only value the follower may write at the bottom edge", () => {
    // 跟随器与 grow/exact 必须落在同一个数上：差一格就会在两格之间来回跳，
    // 用户看到的是「整体文案小幅上下跳动、幅度很小」。
    const ratio = 2.4;
    for (let scrollHeight = 1000; scrollHeight < 1030; scrollHeight += 0.41) {
      const bottom = bottomScrollTarget({ scrollHeight, clientHeight: 400 }, ratio);
      const frame = smoothBottomFollow({
        current: scrollHeight - 400 - 6,
        target: scrollHeight - 400,
        ratePerSecond: 400,
        deltaMs: 16.7,
        devicePixelRatio: ratio,
      });
      if (frame.scrollTop === null) continue;
      expect(frame.scrollTop).toBeLessThanOrEqual(bottom + 1e-9);
      const grid = (frame.scrollTop * ratio) % 1;
      expect(Math.min(grid, 1 - grid)).toBeLessThan(1e-6);
    }
  });

  it("proves the rounded scrollHeight overshoots the real limit", () => {
    // scrollHeight / clientHeight 是整数（各自四舍五入），相减必然高估真实上限。
    // 这条用例把偏差钉死：内容高 5985.5、视口 748 ⇒ 真实上限 5237.5，
    // 整数相减得 5238 ⇒ 算出的落点 5237.92 越界，写进去会被浏览器钳回 5237.5。
    const scroller = new FakeScroller(5985.5, 748);
    const naive = bottomScrollTarget(
      { scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight },
      2.4,
    );
    expect(naive).toBeGreaterThan(scroller.trueMax);
  });

  it("pins to the browser's real fractional limit, on the device grid", () => {
    const scroller = new FakeScroller(5985.5, 748);
    const target = pinBottomScroll(scroller, 2.4);
    // 真的写进去了（没有被钳回去）
    expect(scroller.scrollTop).toBeCloseTo(target, 6);
    expect(target).toBeLessThanOrEqual(scroller.trueMax + 1e-9);
    // 离底不超过一个设备像素，且正好落在网格上
    expect(scroller.trueMax - target).toBeLessThan(1 / 2.4 + 1e-9);
    const grid = (target * 2.4) % 1;
    expect(Math.min(grid, 1 - grid)).toBeLessThan(1e-6);
    // 反复调用稳定（每帧重写也不会移动位置）
    expect(pinBottomScroll(scroller, 2.4)).toBeCloseTo(target, 6);
    expect(scroller.scrollTop).toBeCloseTo(target, 6);
  });

  it("keeps the pin on the grid as the content grows", () => {
    const scroller = new FakeScroller(4000, 748);
    let previous = pinBottomScroll(scroller, 2.4);
    for (let height = 4000; height < 4400; height += 16.63) {
      scroller.contentHeight = height;
      const next = pinBottomScroll(scroller, 2.4);
      // 单调不降：贴底跟随期间位置永远不会回退（回退就是肉眼看到的"上下跳"）
      expect(next).toBeGreaterThanOrEqual(previous - 1e-9);
      const grid = (scroller.scrollTop * 2.4) % 1;
      expect(Math.min(grid, 1 - grid)).toBeLessThan(1e-6);
      previous = next;
    }
  });

  it("writes on every content change while streaming, and only then", () => {
    // 流式贴底 = 内容一变就在同一帧补平。少写一帧，那 32px 就变成「文字上跳一下」；
    // 多写（内容没变还每帧重写）则会不停触发滚动事件与重绘。
    let previousTarget: number | null = null;
    const scroller = new FakeScroller(4000, 748);
    let pins = 0;
    let scrollTop = 0;
    const step = () => {
      const target = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const write = needsBottomPin({ target, scrollTop, previousTarget });
      previousTarget = target;
      if (write) {
        scrollTop = pinBottomScroll(scroller, 2.4);
        pins += 1;
      }
      return write;
    };
    expect(step()).toBe(true); // 首次必须写
    // 内容不变：一帧都不该再写
    for (let frame = 0; frame < 30; frame += 1) expect(step()).toBe(false);
    expect(pins).toBe(1);
    // 内容每 16.63px 长一次（dpr=2.4 下真实行高不是整数）：每次都写
    let grew = 0;
    for (let k = 1; k <= 20; k += 1) {
      scroller.contentHeight = 4000 + k * 16.63;
      if (step()) {
        grew += 1;
        // 每次写入都必须贴着真实上限（不越界、不离底）
        expect(scroller.trueMax - scroller.scrollTop).toBeLessThan(1 / 2.4 + 1e-9);
      }
      for (let frame = 0; frame < 3; frame += 1) expect(step()).toBe(false);
    }
    expect(grew).toBe(20);
  });

  it("re-pins after the viewport height changes even without new content", () => {
    // 窗口/输入框变高变矮会改 clientHeight，上限跟着变 —— 这时内容没长也必须重新贴底，
    // 否则视口会停在离底一段的地方（像是被顶走了）。
    const scroller = new FakeScroller(4000, 748);
    const scrollTop = pinBottomScroll(scroller, 2.4);
    const previousTarget = scroller.scrollHeight - scroller.clientHeight;
    scroller.clientHeight = 700;
    const target = scroller.scrollHeight - scroller.clientHeight;
    expect(needsBottomPin({ target, scrollTop, previousTarget })).toBe(true);
  });
});

/** 模拟真实滚动容器：scrollHeight / clientHeight 取整，scrollTop 写入时钳到真实上限。 */
class FakeScroller {
  #top = 0;
  constructor(
    public contentHeight: number,
    public clientHeight: number,
  ) {}
  get scrollHeight(): number {
    return Math.round(this.contentHeight);
  }
  /** 浏览器真正的最大滚动量（小数、精确）。 */
  get trueMax(): number {
    return Math.max(0, this.contentHeight - this.clientHeight);
  }
  get scrollTop(): number {
    return this.#top;
  }
  set scrollTop(value: number) {
    this.#top = Math.min(Math.max(0, value), this.trueMax);
  }
}

describe("transcript keyboard intent", () => {
  const event = {
    key: "PageDown",
    defaultPrevented: false,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
  };
  it("recognizes scroll keys originating from a focused transcript link", () => {
    const target = document.createElement("a");
    expect(transcriptKeyboardScrollDelta({ ...event, target })).toBe(1);
    expect(transcriptKeyboardScrollDelta({ ...event, key: "Home", target })).toBe(-1);
  });
  it("leaves editing and widget keyboard navigation alone", () => {
    const textarea = document.createElement("textarea");
    expect(transcriptKeyboardScrollDelta({ ...event, target: textarea })).toBe(0);
    const listbox = document.createElement("div");
    listbox.setAttribute("role", "listbox");
    const option = document.createElement("div");
    listbox.append(option);
    expect(transcriptKeyboardScrollDelta({ ...event, target: option })).toBe(0);
    expect(
      transcriptKeyboardScrollDelta({
        ...event,
        target: document.createElement("a"),
        defaultPrevented: true,
      }),
    ).toBe(0);
  });
});

describe("transcript bottom lock", () => {
  it("does not read DOM geometry for a bottom-locked scroll without user intent", () => {
    const geometryRead = vi.fn(() => {
      throw new Error("Unexpected synchronous geometry read");
    });
    const metrics = Object.defineProperties(
      {},
      {
        scrollTop: { get: geometryRead },
        scrollHeight: { get: geometryRead },
        clientHeight: { get: geometryRead },
      },
    ) as { scrollTop: number; scrollHeight: number; clientHeight: number };
    expect(
      readTranscriptScrollUpdate({
        current: true,
        metrics,
        previousScrollTop: 600,
        intent: null,
      }),
    ).toBeNull();
    expect(geometryRead).not.toHaveBeenCalled();
  });

  it.each(["up", "anchor", "scrollbar"] as const)(
    "still reads actual scroll position and unlocks for %s intent",
    (intent) => {
      expect(
        readTranscriptScrollUpdate({
          current: true,
          metrics: { scrollTop: 575, scrollHeight: 1_000, clientHeight: 400 },
          previousScrollTop: 600,
          intent,
        }),
      ).toEqual({ locked: false, scrollTop: 575 });
    },
  );

  it("tracks unlocked momentum and re-arms on returning to the live edge", () => {
    const metrics = { scrollTop: 500, scrollHeight: 1_000, clientHeight: 400 };
    expect(
      readTranscriptScrollUpdate({
        current: false,
        metrics,
        previousScrollTop: 570,
        intent: null,
      }),
    ).toEqual({ locked: false, scrollTop: 500 });
    expect(
      readTranscriptScrollUpdate({
        current: false,
        metrics: { ...metrics, scrollTop: 580 },
        previousScrollTop: 500,
        intent: null,
        userGestureAt: 1_000,
        now: 1_400,
      }),
    ).toEqual({ locked: true, scrollTop: 580 });
  });

  it("a programmatic downward write near the bottom does not re-arm the lock", () => {
    expect(
      nextTranscriptBottomLock({
        current: false,
        metrics: { scrollTop: 580, scrollHeight: 1_000, clientHeight: 400 },
        previousScrollTop: 500,
        intent: null,
      }),
    ).toBe(false);
    expect(
      nextTranscriptBottomLock({
        current: false,
        metrics: { scrollTop: 580, scrollHeight: 1_000, clientHeight: 400 },
        previousScrollTop: 500,
        intent: null,
        userGestureAt: 1_000,
        now: 2_400,
      }),
    ).toBe(false);
  });

  it("stays locked when layout growth moves the viewport away without user input", () => {
    expect(
      nextTranscriptBottomLock({
        current: true,
        metrics: { scrollTop: 400, scrollHeight: 1_000, clientHeight: 400 },
        previousScrollTop: 400,
        intent: null,
      }),
    ).toBe(true);
  });

  it("releases after an upward gesture", () => {
    expect(
      nextTranscriptBottomLock({
        current: true,
        metrics: { scrollTop: 575, scrollHeight: 1_000, clientHeight: 400 },
        previousScrollTop: 600,
        intent: "up",
      }),
    ).toBe(false);
  });

  it("stays unlocked while momentum moves farther away", () => {
    expect(
      nextTranscriptBottomLock({
        current: false,
        metrics: { scrollTop: 500, scrollHeight: 1_000, clientHeight: 400 },
        previousScrollTop: 570,
        intent: null,
      }),
    ).toBe(false);
  });

  it("uses scroll direction when the user drags the scrollbar", () => {
    expect(
      nextTranscriptBottomLock({
        current: true,
        metrics: { scrollTop: 500, scrollHeight: 1_000, clientHeight: 400 },
        previousScrollTop: 600,
        intent: "scrollbar",
      }),
    ).toBe(false);
  });

  it("restores the lock when the viewport returns near the bottom", () => {
    expect(
      nextTranscriptBottomLock({
        current: false,
        metrics: { scrollTop: 565, scrollHeight: 1_000, clientHeight: 400 },
        previousScrollTop: 500,
        intent: null,
        userGestureAt: 1_000,
        now: 1_200,
      }),
    ).toBe(true);
  });

  it("does not re-arm while restoring a history anchor", () => {
    expect(
      nextTranscriptBottomLock({
        current: false,
        metrics: { scrollTop: 565, scrollHeight: 1_000, clientHeight: 400 },
        previousScrollTop: 500,
        intent: "anchor",
      }),
    ).toBe(false);
  });

  it("clamps overscroll and normalizes wheel delta modes", () => {
    expect(
      transcriptDistanceFromBottom({ scrollTop: 620, scrollHeight: 1_000, clientHeight: 400 }),
    ).toBe(0);
    expect(normalizeTranscriptWheelDelta({ deltaY: -2, deltaMode: 1, viewportHeight: 600 })).toBe(
      -80,
    );
    expect(normalizeTranscriptWheelDelta({ deltaY: -1, deltaMode: 2, viewportHeight: 600 })).toBe(
      -600,
    );
  });

  it("lets nested scroll panes consume gestures until their boundary", () => {
    const metrics = { scrollTop: 20, scrollHeight: 500, clientHeight: 200 };

    expect(transcriptScrollTargetConsumesDelta(metrics, -40)).toBe(true);
    expect(transcriptScrollTargetConsumesDelta(metrics, 40)).toBe(true);
    expect(transcriptScrollTargetConsumesDelta({ ...metrics, scrollTop: 0 }, -40)).toBe(false);
    expect(transcriptScrollTargetConsumesDelta({ ...metrics, scrollTop: 300 }, 40)).toBe(false);
  });

  it("can schedule again after cleanup cancels a pending frame", () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let id = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callbacks.set(++id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (frameID: number) => callbacks.delete(frameID));
    const frame = { current: null as number | null };
    const callback = vi.fn();

    scheduleTranscriptScrollFrame(frame, callback);
    cancelTranscriptScrollFrame(frame);
    scheduleTranscriptScrollFrame(frame, callback);
    callbacks.get(frame.current ?? -1)?.(0);

    expect(callback).toHaveBeenCalledOnce();
    expect(frame.current).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe("streaming live edge pin", () => {
  it("re-pins growth that the measured follow has not covered yet", () => {
    // The reply grew by 32px after the commit: the browser is about to paint the
    // transcript lifted by those lines, so the pin has to correct before paint.
    expect(
      pinnedTranscriptScrollTop({
        scrollTop: 26529.5,
        scrollHeight: 27172,
        clientHeight: 578,
      }),
    ).toBe(26594);
  });

  it("leaves the viewport alone when it is already flush", () => {
    expect(
      pinnedTranscriptScrollTop({ scrollTop: 26594, scrollHeight: 27172, clientHeight: 578 }),
    ).toBeNull();
    expect(
      pinnedTranscriptScrollTop({ scrollTop: 26593.7, scrollHeight: 27172, clientHeight: 578 }),
    ).toBeNull();
  });

  it("does not drag the reader down a real layout jump", () => {
    // A replaced message can move the bottom by more than a viewport; that is the
    // measured follow's business, not the pin's.
    expect(
      pinnedTranscriptScrollTop(
        { scrollTop: 1000, scrollHeight: 4000, clientHeight: 578 },
        { maxDistance: 578 },
      ),
    ).toBeNull();
    expect(
      pinnedTranscriptScrollTop(
        { scrollTop: 3000, scrollHeight: 4000, clientHeight: 578 },
        { maxDistance: 578 },
      ),
    ).toBe(3422);
  });
});

describe("prependAnchorFrame", () => {
  const base = {
    anchorViewportTop: 0,
    anchorTop: 0,
    anchorRowStart: null,
    viewportTop: 0,
    scrollTop: 5000,
    scrollHeight: 10_000,
    fallbackHeight: 10_000,
    fallbackScrollTop: 5000,
    landed: true,
    previousScrollHeight: 10_000,
    stableFrames: 0,
    landedAt: 1_000,
    waitStartedAt: 0,
    now: 1_016,
    waitTimeoutMs: 4_000,
    settleTimeoutMs: 2_500,
    stableFrameTarget: 8,
  };

  it("keeps waiting while the page has not landed instead of dropping the anchor", () => {
    // Dropping here is what made a late page shift the whole view up: nothing
    // compensates afterwards, so the reader lands near the start of the session.
    const result = prependAnchorFrame({
      ...base,
      landed: false,
      landedAt: null,
      now: 2_000,
    });
    expect(result.done).toBe(false);
    expect(result.scrollTop).toBeNull();
    expect(result.landedAt).toBeNull();
  });

  it("按虚拟器模型对齐锚点行：行高被反复修正时，屏幕位置不漂", () => {
    // 新页落地后行高还会被修正多次。以前按「累计新增高度」补偿，每一步都踩在
    // 还没测准的数字上；收敛窗口一超时就清锚点，半途而废 ⇒ 看起来「一上滑就跳到最上边」。
    const pageLanded = {
      ...base,
      anchorTop: null, // 锚点行已被推出挂载窗口
      anchorViewportTop: 120, // 记锚点时它在视口顶部下方 120px
      scrollTop: 5_000,
      fallbackScrollTop: 5_000,
      fallbackHeight: 6_000,
      previousScrollHeight: 6_000,
      scrollHeight: 7_000,
    };
    // 模型说锚点行现在从内容坐标 6_200 开始 ⇒ 要让它回到视口顶部下方 120px
    const first = prependAnchorFrame({ ...pageLanded, anchorRowStart: 6_200, now: 1_100 });
    expect(first.scrollTop).toBe(6_080);
    expect(first.stableFrames).toBe(0);
    // 后续行高修正把起点推到 6_350：补偿跟着模型走，屏幕位置仍是 120px
    const second = prependAnchorFrame({
      ...pageLanded,
      anchorRowStart: 6_350,
      scrollTop: 6_080,
      previousScrollHeight: 7_000,
      now: 1_116,
    });
    expect(second.scrollTop).toBe(6_230);
    // 收敛：同一帧里 start 与 scrollTop 已经对上，就不再写
    const third = prependAnchorFrame({
      ...pageLanded,
      anchorRowStart: 6_350,
      scrollTop: 6_230,
      previousScrollHeight: 7_000,
      stableFrames: 7,
      now: 1_132,
    });
    expect(third.scrollTop).toBeNull();
    expect(third.stableFrames).toBe(8);
    // 对照：拿不到模型时仍是老的按高度差算法（6_000 + 新增 1_000），证明新分支确实接管了
    const legacy = prependAnchorFrame({ ...pageLanded, anchorRowStart: null, now: 1_100 });
    expect(legacy.scrollTop).toBe(6_000);
  });

  it("gives up only after the wait window", () => {
    const result = prependAnchorFrame({ ...base, landed: false, landedAt: null, now: 4_001 });
    expect(result.done).toBe(true);
  });

  it("compensates the height the new page inserted above the anchor", () => {
    const result = prependAnchorFrame({
      ...base,
      anchorTop: 3000,
      scrollHeight: 13_000,
      previousScrollHeight: 10_000,
    });
    expect(result.scrollTop).toBe(8000);
    expect(result.stableFrames).toBe(0);
    expect(result.done).toBe(false);
  });

  it("keeps the anchor while late measurement still changes row heights", () => {
    const result = prependAnchorFrame({
      ...base,
      anchorViewportTop: 120,
      anchorTop: 120,
      scrollTop: 8000,
      scrollHeight: 13_120,
      previousScrollHeight: 13_000,
      stableFrames: 5,
    });
    expect(result.stableFrames).toBe(0);
    expect(result.done).toBe(false);
  });

  it("finishes once position and height are both stable", () => {
    const result = prependAnchorFrame({ ...base, stableFrames: 7 });
    expect(result.stableFrames).toBe(8);
    expect(result.done).toBe(true);
  });

  it("keeps correcting after the settle timeout while the error is still visible", () => {
    // 新页的行高是分批落地的：上面每缩一次，锚点在模型里就往顶挪一次。
    // 只按「落地后 N 秒」收工会把还差几千像素的位置撒手，用户看到的
    // 就是「一上滑加载消息，直接跳到最上边」。
    const result = prependAnchorFrame({
      ...base,
      anchorTop: null,
      anchorRowStart: 1_000,
      scrollTop: 5_000,
      landedAt: 1_000,
      now: 1_000 + 2_500 + 16,
    });
    expect(result.scrollTop).toBe(1_000);
    expect(result.done).toBe(false);
  });

  it("finishes at the settle timeout once the remaining error is imperceptible", () => {
    const result = prependAnchorFrame({
      ...base,
      anchorTop: null,
      anchorRowStart: 5_010,
      anchorViewportTop: 10,
      scrollTop: 5_000,
      landedAt: 1_000,
      now: 1_000 + 2_500 + 16,
    });
    expect(result.scrollTop).toBeNull();
    expect(result.done).toBe(true);
  });

  it("gives up the guard window even with a large residual so the anchor cannot hang forever", () => {
    const result = prependAnchorFrame({
      ...base,
      anchorTop: null,
      anchorRowStart: 1_000,
      scrollTop: 5_000,
      landedAt: 1_000,
      now: 1_000 + 2_500 * 4 + 16,
    });
    expect(result.done).toBe(true);
  });

  it("shifts by the inserted height when the anchor row is virtualized away", () => {
    const result = prependAnchorFrame({
      ...base,
      anchorTop: null,
      scrollHeight: 13_000,
      previousScrollHeight: 10_000,
    });
    expect(result.scrollTop).toBe(8000);
    expect(result.stableFrames).toBe(0);
  });

  it("stops settling after the settle window", () => {
    const result = prependAnchorFrame({ ...base, now: 3_500 });
    expect(result.done).toBe(true);
  });
});

describe("smooth bottom follow", () => {
  // 模拟真实的 60fps 循环：速度状态逐帧回传，和 thread.tsx 的用法一致。
  const simulate = (opts: {
    growth?: number[];      // 每帧的内容增长（px）
    start?: number;
    frames?: number;
    streaming?: boolean;
    rate?: number;
  }) => {
    const growth = opts.growth ?? [];
    let current = opts.start ?? 0;
    let target = current;
    let speed = 0;
    let time = 0;
    let previousTarget: number | undefined = undefined;
    const steps: number[] = [];
    const speeds: number[] = [];
    for (let i = 0; i < (opts.frames ?? growth.length); i++) {
      target += growth[i] ?? 0;
      time += 16.7;
      const frame = smoothBottomFollow({
        current,
        target,
        previousTarget,
        ratePerSecond: opts.rate ?? 60,
        deltaMs: 16.7,
        speedPxPerSecond: speed,
        streaming: opts.streaming ?? true,
        devicePixelRatio: 2.4,
      });
      previousTarget = target;
      speed = frame.speedPxPerSecond;
      speeds.push(speed);
      if (frame.scrollTop !== null) {
        steps.push(+(frame.scrollTop - current).toFixed(3));
        current = frame.scrollTop;
      } else {
        steps.push(0);
      }
    }
    return { current, target, steps, speeds, speed };
  };

  it("does nothing when already at the bottom", () => {
    const frame = smoothBottomFollow({ current: 900, target: 900, ratePerSecond: 88, deltaMs: 16.7 });
    expect(frame.scrollTop).toBeNull();
    expect(frame.settled).toBe(true);
  });

  it("spreads one 16px line over several frames instead of jumping", () => {
    const { steps } = simulate({ growth: [16], frames: 20 });
    const moved = steps.filter((step) => step > 0);
    expect(Math.max(...moved)).toBeLessThanOrEqual(SMOOTH_FOLLOW_BIG_STEP_CAP_PX + 1e-9);
    expect(moved.length).toBeGreaterThanOrEqual(3);
  });

  it("lands the whole transcript in one frame when the gap is layout-sized", () => {
    // 打开一个 18000px 的任务：跟随器一帧最多 12px ⇒ 要爬 25 秒，用户看到的
    // 是「从最早的消息开始一路往下滚」。这种量级不是跟随，是落位。
    const frame = smoothBottomFollow({
      current: 0,
      target: 18_000,
      ratePerSecond: 0,
      deltaMs: 16.7,
      streaming: false,
    });
    expect(frame.scrollTop).not.toBeNull();
    expect(Math.abs(frame.scrollTop! - 18_000)).toBeLessThanOrEqual(1);
    expect(frame.settled).toBe(true);
  });

  it("still glides for ordinary block growth below the snap threshold", () => {
    const frame = smoothBottomFollow({
      current: 0,
      target: SMOOTH_FOLLOW_SNAP_BEYOND_PX - 200,
      ratePerSecond: 0,
      deltaMs: 16.7,
      streaming: true,
    });
    expect(frame.scrollTop).not.toBeNull();
    expect(frame.scrollTop! - 0).toBeLessThanOrEqual(SMOOTH_FOLLOW_BIG_STEP_CAP_PX + 1 / 2.4);
  });

  it("snaps when the layout jumps by more than a text block while idle", () => {
    // 虚拟列表补测量 / 首屏落位：目标一帧里跳 250px。这时没有内容在到达，
    // 逐帧追 = 屏幕自己在滑，直接落位。
    const frame = smoothBottomFollow({
      current: 4000,
      target: 4250,
      previousTarget: 4000,
      ratePerSecond: 0,
      deltaMs: 16.7,
      streaming: false,
    });
    expect(Math.abs(frame.scrollTop! - 4250)).toBeLessThanOrEqual(0.05);
    expect(frame.settled).toBe(true);
  });

  it("glides instead of teleporting when a block lands mid-stream", () => {
    // 代码块/表格在流式中途落地（一帧 +520px）：用户正在读屏幕上的字，
    // 瞬移会把他甩开，这里必须保持滑动。
    const frame = smoothBottomFollow({
      current: 4000,
      target: 4520,
      previousTarget: 4000,
      ratePerSecond: 150,
      deltaMs: 16.7,
      speedPxPerSecond: 150,
      streaming: true,
    });
    expect(frame.scrollTop! - 4000).toBeLessThanOrEqual(SMOOTH_FOLLOW_BIG_STEP_CAP_PX + 1 / 2.4);
    expect(frame.scrollTop! - 4000).toBeGreaterThan(0);
  });

  it("keeps gliding for one-line growth (the normal streaming case)", () => {
    const frame = smoothBottomFollow({
      current: 4000,
      target: 4016,
      previousTarget: 4000,
      ratePerSecond: 150,
      deltaMs: 16.7,
      speedPxPerSecond: 150,
      streaming: true,
    });
    expect(frame.scrollTop! - 4000).toBeLessThanOrEqual(SMOOTH_FOLLOW_BIG_STEP_CAP_PX + 1 / 2.4);
    expect(frame.scrollTop! - 4000).toBeGreaterThan(0);
  });

  it("lands a 1000px block in one frame, glides a 100px one", () => {
    // 1000px 一块（大段代码/表格落地）在**非流式**下 = 布局级变化：瞬移比滑行更干净。
    const big = simulate({ growth: [1000], frames: 120, rate: 0, streaming: false });
    expect(Math.abs(big.target - big.current)).toBeLessThanOrEqual(1);
    // 100px 一块仍按平滑跟随：仍在「滑动」的范畴内。
    const small = simulate({ growth: [100], frames: 120, rate: 0 });
    expect(Math.max(...small.steps.map(Math.abs))).toBeLessThanOrEqual(
      SMOOTH_FOLLOW_BIG_STEP_CAP_PX + 1 / 2.4,
    );
    // 流式期间**故意**保留一行滞后（FOLLOW_LAG_TARGET_PX）做缓冲：滞后预算之内
    // 速度归零、不再追，所以收敛目标是一行而不是 0。收尾换成非流式才真正贴平。
    expect(Math.abs(small.target - small.current)).toBeLessThanOrEqual(FOLLOW_LAG_TARGET_PX + 1);
  });

  it("still converges after a big block lands mid-stream", () => {
    // 流式期间不允许瞬移（契约见上一条用例的兄弟项），所以 1000px 只能滑过去。
    // 这条用例的合成输入把速率钉死在 60px/s（真实场景吐字一停速率就衰减到 0，
    // 随后由落位分支收尾），因此给足帧数，只验证「一定会收敛到滞后预算内、
    // 且单帧不猛冲」。
    const big = simulate({ growth: [1000], frames: 400, rate: 60 });
    expect(Math.abs(big.target - big.current)).toBeLessThanOrEqual(FOLLOW_LAG_TARGET_PX + 1);
    expect(Math.max(...big.steps.map(Math.abs))).toBeLessThanOrEqual(
      SMOOTH_FOLLOW_BIG_STEP_CAP_PX + 1 / 2.4,
    );
  });

  it("keeps velocity continuous across bursts (no restart-from-zero jitter)", () => {
    // 真实流式：一行 16px 每 ~6 帧到一次。旧实现的节奏是「0 → 3.5px/帧 → 0」，
    // 速度在帧与帧之间硬切，肉眼就是「跳一下、停一下」。
    const growth = Array.from({ length: 180 }, (_, i) => (i % 6 === 0 ? 16 : 0));
    const { steps, speeds } = simulate({ growth, frames: 180 });
    const moving = steps.filter((step) => step > 0);
    // 1) 有内容可跟时，绝不出现空转帧（空转 = 下一批重新起步）
    expect(steps.filter((step) => step === 0).length).toBe(0);
    // 2) 帧间速度变化有界：低通 110ms / 16.7ms 一帧 ⇒ 每帧最多变化 ~14%，
    //    另设 40px/s 的绝对下限 —— 没有它时从 0 起步到「跟得上吐字速率」
    //    （30px/100ms ≈ 300px/s）要 20 帧（330ms），期间内容会持续往底边外堆。
    for (let i = 1; i < speeds.length; i++) {
      const previous = speeds[i - 1] ?? 0;
      const delta = Math.abs((speeds[i] ?? 0) - previous);
      expect(delta).toBeLessThanOrEqual(Math.max(40, previous * 0.25) + 1e-9);
    }
    // 3) 单帧步长依旧封顶，不会出现一帧一大截
    expect(Math.max(...moving)).toBeLessThanOrEqual(SMOOTH_FOLLOW_BIG_STEP_CAP_PX + 1 / 2.4);
  });

  it("never overshoots and settles flush once the stream stops", () => {
    const { current, target, steps } = simulate({ growth: [16, 0, 16, 0], frames: 200, streaming: false, rate: 0 });
    expect(current).toBeLessThanOrEqual(target);
    expect(target - current).toBeLessThanOrEqual(1);
    expect(steps.every((step) => step >= 0)).toBe(true);
  });

  it("moves backwards slowly when the content shrinks", () => {
    const frame = smoothBottomFollow({
      current: 1100,
      target: 1000,
      ratePerSecond: 0,
      deltaMs: 16.7,
      speedPxPerSecond: 120,
    });
    expect(frame.scrollTop).not.toBeNull();
    expect(frame.scrollTop!).toBeLessThan(1100);
    expect(frame.scrollTop!).toBeGreaterThan(1000);
    expect(1100 - frame.scrollTop!).toBeLessThanOrEqual(SMOOTH_FOLLOW_BIG_STEP_CAP_PX + 1e-9);
  });

  it("treats a sub-pixel residual as settled instead of chasing it", () => {
    const frame = smoothBottomFollow({ current: 100, target: 100.7, ratePerSecond: 88, deltaMs: 16.7 });
    expect(frame.scrollTop).toBeNull();
    expect(frame.settled).toBe(true);
  });

  it("lands on the device pixel grid so the compositor never resamples the text", () => {
    // 亚像素落位会让合成器每帧重新采样文字层（边缘忽清忽糊 = 闪）；
    // 对齐设备像素（dpr=2.4 时一格 0.4167px）后是整像素平移，文字始终锐利。
    const frame = smoothBottomFollow({
      current: 2118.33,
      target: 2400,
      ratePerSecond: 200,
      deltaMs: 16.7,
      devicePixelRatio: 2.4,
    });
    expect(frame.scrollTop).not.toBeNull();
    expect(frame.scrollTop!).toBeGreaterThan(2118.33);
    const grid = (frame.scrollTop! * 2.4) % 1;
    expect(Math.min(grid, 1 - grid)).toBeLessThan(1e-6);
  });
});

describe("growth rate estimate", () => {
  it("smooths a burst instead of adopting its instantaneous rate", () => {
    const once = noteGrowthRate({
      scrollHeight: 116,
      previousScrollHeight: 100,
      previousAt: 0,
      at: 100,
      ratePerSecond: 0,
    });
    // 100ms 长高 16px = 瞬时 160px/s。估计值必须只是它的一小截 —— 这个低通
    // 存在的全部意义，就是把「一块 16px 落地」摊成一段速度，而不是照抄瞬时值。
    expect(once).toBeGreaterThan(0);
    expect(once).toBeLessThan(40);
  });

  it("rejects a single 32px batch: one frame must not add a visible speed pulse", () => {
    // 真实工况：每 ~100ms 来一块 16~32px，中间全是 0。逐帧实测（2026-10-28，
    // dpr=2.4）旧时间常数（160ms）会把单帧 16px 读成 ~95px/s 的速度脉冲，叠在
    // 75px/s 的底速上 ⇒ 约 1.6Hz 的「窜一下—回落」，正是用户说的「上下抖」。
    const steady = 75;
    const bumped = noteGrowthRate({
      scrollHeight: 132,
      previousScrollHeight: 100,
      previousAt: 0,
      at: 16,
      ratePerSecond: steady,
    });
    expect(bumped).toBeGreaterThan(steady);
    expect(bumped - steady).toBeLessThan(40);
  });

  it("converges to the sustained rate when frames keep arriving", () => {
    // 「钝」不能变成「一直欠速」：连续吐字时必须收敛到真实速率，
    // 否则跟随会永远追不上、滞后被误差项硬拉，又回到冲刺—刹车。
    let rate = 0;
    for (let frame = 1; frame <= 200; frame += 1) {
      // 4px / 16ms = 250px/s 恒定吐字。
      rate = noteGrowthRate({
        scrollHeight: 100 + frame * 4,
        previousScrollHeight: 100 + (frame - 1) * 4,
        previousAt: (frame - 1) * 16,
        at: frame * 16,
        ratePerSecond: rate,
      });
    }
    expect(rate).toBeGreaterThan(250 * 0.95);
    expect(rate).toBeLessThan(250 * 1.05);
  });

  it("decays when the stream pauses so the view stops drifting", () => {
    // 停流后不能保留冲锋速度。衰减走 2×tau：短暂停顿（400ms）刻意保留大半，
    // 否则每次批间空隙跟随都要刹一次车 —— 那是另一种抖。
    const afterPause = (deltaMs: number) =>
      noteGrowthRate({
        scrollHeight: 100,
        previousScrollHeight: 100,
        previousAt: 0,
        at: deltaMs,
        ratePerSecond: 200,
      });
    expect(afterPause(400)).toBeLessThan(200);
    expect(afterPause(1_800)).toBeLessThan(100);
    expect(afterPause(5_400)).toBeLessThan(20);
    // 单调递减，任何一档都不许反弹。
    expect(afterPause(400)).toBeGreaterThan(afterPause(1_800));
    expect(afterPause(1_800)).toBeGreaterThan(afterPause(5_400));
    expect(afterPause(5_400)).toBeGreaterThanOrEqual(0);
  });

  it("ignores sub-frame bursts and caps runaway speed", () => {
    expect(
      noteGrowthRate({ scrollHeight: 900, previousScrollHeight: 100, previousAt: 0, at: 2, ratePerSecond: 50 }),
    ).toBe(50);
    expect(
      noteGrowthRate({ scrollHeight: 9_000, previousScrollHeight: 100, previousAt: 0, at: 100, ratePerSecond: 0 }),
    ).toBeLessThanOrEqual(6_000);
  });
});

describe("anchor compensation", () => {
  it("cancels growth that happened above the visible text", () => {
    // 上方一行长高 16px：可见文字被推下去 16px，补 16px 让它原地不动。
    expect(anchorScrollCompensation({ scrollTop: 500, previousAnchorTop: 2080, anchorTop: 2096 })).toBe(516);
  });

  it("cancels shrink as well, in both directions", () => {
    expect(anchorScrollCompensation({ scrollTop: 500, previousAnchorTop: 2096, anchorTop: 2080 })).toBe(484);
  });

  it("ignores sub-pixel churn (measurement noise must not move the view)", () => {
    expect(anchorScrollCompensation({ scrollTop: 500, previousAnchorTop: 2080.2, anchorTop: 2080.4 })).toBeNull();
    expect(anchorScrollCompensation({ scrollTop: 500, previousAnchorTop: 2080, anchorTop: 2080 })).toBeNull();
  });

  it("writes the exact fractional offset instead of snapping to the device grid", () => {
    // 这台机器 dpr=2.4：长高 16px 对应 15.83px 的滚动量。取整会留下 0.17px 残差，
    // 每次增长都重绘一次子像素位置 —— 那正是「幅度很小但一直在闪」。
    const next = anchorScrollCompensation({ scrollTop: 2118.33, previousAnchorTop: 100, anchorTop: 116.7 });
    expect(next).toBeCloseTo(2135.03, 6);
  });
});

describe("growth gate (idempotency)", () => {
  it("allows the first write for a new scrollHeight", () => {
    const state = { lastCompensatedHeight: null };
    expect(checkGrowthGate(1000, state)).toBe(true);
  });

  it("blocks the second write for the same scrollHeight", () => {
    const state = { lastCompensatedHeight: null };
    expect(checkGrowthGate(1000, state)).toBe(true);
    recordCompensated(state, 1000);
    expect(checkGrowthGate(1000, state)).toBe(false);
  });

  it("allows a new growth (scrollHeight increased)", () => {
    const state = { lastCompensatedHeight: null };
    recordCompensated(state, 1000);
    expect(checkGrowthGate(1048, state)).toBe(true);
  });

  it("allows shrink (layout reflow, not streaming growth)", () => {
    const state = { lastCompensatedHeight: null };
    recordCompensated(state, 1000);
    expect(checkGrowthGate(950, state)).toBe(true);
  });

  it("resets cleanly", () => {
    const state = { lastCompensatedHeight: null };
    recordCompensated(state, 1000);
    expect(checkGrowthGate(1000, state)).toBe(false);
    resetGrowthGate(state);
    expect(checkGrowthGate(1000, state)).toBe(true);
  });
});
