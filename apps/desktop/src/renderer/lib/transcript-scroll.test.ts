import { describe, expect, it, vi } from "vitest";
import {
  cancelTranscriptScrollFrame,
  anchorScrollCompensation,
  noteGrowthRate,
  smoothBottomFollow,
  SMOOTH_FOLLOW_BIG_STEP_CAP_PX,
  SMOOTH_FOLLOW_MAX_STEP_PX,
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
      }),
    ).toEqual({ locked: true, scrollTop: 580 });
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
    // 1000px 一块（大段代码/表格落地）= 布局级变化：瞬移比 1.4 秒滑行更干净。
    const big = simulate({ growth: [1000], frames: 120, rate: 0 });
    expect(Math.abs(big.target - big.current)).toBeLessThanOrEqual(1);
    // 100px 一块仍按平滑跟随：仍在「滑动」的范畴内。
    const small = simulate({ growth: [100], frames: 120, rate: 0 });
    expect(Math.max(...small.steps.map(Math.abs))).toBeLessThanOrEqual(
      SMOOTH_FOLLOW_BIG_STEP_CAP_PX + 1 / 2.4,
    );
    expect(Math.abs(small.target - small.current)).toBeLessThanOrEqual(1);
  });

  it("keeps velocity continuous across bursts (no restart-from-zero jitter)", () => {
    // 真实流式：一行 16px 每 ~6 帧到一次。旧实现的节奏是「0 → 3.5px/帧 → 0」，
    // 速度在帧与帧之间硬切，肉眼就是「跳一下、停一下」。
    const growth = Array.from({ length: 180 }, (_, i) => (i % 6 === 0 ? 16 : 0));
    const { steps, speeds } = simulate({ growth, frames: 180 });
    const moving = steps.filter((step) => step > 0);
    // 1) 有内容可跟时，绝不出现空转帧（空转 = 下一批重新起步）
    expect(steps.filter((step) => step === 0).length).toBe(0);
    // 2) 帧间速度变化有界：低通 110ms / 16.7ms 一帧 ⇒ 每帧最多变化 ~14%
    for (let i = 1; i < speeds.length; i++) {
      const previous = speeds[i - 1] ?? 0;
      const delta = Math.abs((speeds[i] ?? 0) - previous);
      expect(delta).toBeLessThanOrEqual(Math.max(12, previous * 0.2) + 1e-9);
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
  it("learns the content growth speed and smooths batch spikes", () => {
    const once = noteGrowthRate({
      scrollHeight: 116,
      previousScrollHeight: 100,
      previousAt: 0,
      at: 100,
      ratePerSecond: 0,
    });
    // 100ms 长高 16px = 160px/s，低通后落在这个区间内，不会直接变成 160。
    expect(once).toBeGreaterThan(40);
    expect(once).toBeLessThan(160);
  });

  it("decays when the stream pauses so the view stops drifting", () => {
    const decayed = noteGrowthRate({
      scrollHeight: 100,
      previousScrollHeight: 100,
      previousAt: 0,
      at: 400,
      ratePerSecond: 200,
    });
    expect(decayed).toBeLessThan(120);
    expect(decayed).toBeGreaterThanOrEqual(0);
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
