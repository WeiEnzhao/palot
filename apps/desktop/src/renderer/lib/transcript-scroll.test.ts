import { describe, expect, it, vi } from "vitest";
import {
  cancelTranscriptScrollFrame,
  anchorScrollCompensation,
  easedBottomFollow,
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

describe("eased bottom follow", () => {
  const runToSettle = (start: number, target: number, ratio = 2, frames = 200) => {
    let current = start;
    const steps: number[] = [];
    for (let i = 0; i < frames; i++) {
      const frame = easedBottomFollow({ current, target, devicePixelRatio: ratio });
      if (!frame) return { current, steps, settled: true };
      current = frame.scrollTop;
      steps.push(current);
      if (frame.settled) return { current, steps, settled: true };
    }
    return { current, steps, settled: false };
  };

  it("does nothing when already at the bottom", () => {
    expect(easedBottomFollow({ current: 900, target: 900, devicePixelRatio: 2 })).toBeNull();
    expect(easedBottomFollow({ current: 899.8, target: 900, devicePixelRatio: 2 })).toBeNull();
  });

  it("spreads a block-sized growth over many frames instead of one jump", () => {
    // 一次数据块把内容顶高 108px：一帧直接落位就是「文字啪地跳一下」。
    const step = easedBottomFollow({ current: 1000, target: 1108, devicePixelRatio: 2 });
    expect(step?.scrollTop).toBeGreaterThan(1000);
    expect(step?.scrollTop).toBeLessThan(1030);
    const { steps, settled } = runToSettle(1000, 1108);
    expect(settled).toBe(true);
    expect(steps.length).toBeGreaterThan(8);
  });

  it("never overshoots the target while easing", () => {
    let current = 0;
    for (let i = 0; i < 100; i++) {
      const frame = easedBottomFollow({ current, target: 600, devicePixelRatio: 2 });
      if (!frame) break;
      expect(frame.scrollTop).toBeLessThanOrEqual(600);
      current = frame.scrollTop;
    }
    // 允许 1px 以内的残差：浏览器最大滚动位置本身就比 scrollHeight - clientHeight
    // 小零点几像素，追这个残差会让跟随循环停不下来。
    expect(Math.abs(current - 600)).toBeLessThanOrEqual(1);
  });

  it("eases backwards when the content shrinks", () => {
    const step = easedBottomFollow({ current: 1100, target: 1000, devicePixelRatio: 2 });
    expect(step?.scrollTop).toBeLessThan(1100);
    expect(step?.scrollTop).toBeGreaterThan(1000);
    expect(1100 - runToSettle(1100, 1000).current).toBeGreaterThan(0);
    expect(Math.abs(runToSettle(1100, 1000).current - 1000)).toBeLessThanOrEqual(1);
  });

  it("treats a sub-pixel residual as settled instead of chasing it", () => {
    // 浏览器真实的最大滚动位置常常比 scrollHeight - clientHeight 小零点几像素，
    // 若把这种残差当成「还没到底」，跟随循环会每帧重写位置、把整屏文字反复重绘。
    expect(easedBottomFollow({ current: 100, target: 100.74, devicePixelRatio: 3 })).toBeNull();
    expect(easedBottomFollow({ current: 100, target: 101, devicePixelRatio: 3 })).toBeNull();
    expect(easedBottomFollow({ current: 100, target: 101.5, devicePixelRatio: 3 })).not.toBeNull();
  });

  it("keeps moving when the remaining distance is under the minimum step", () => {
    const frame = easedBottomFollow({ current: 100, target: 103, devicePixelRatio: 3 });
    expect(frame?.scrollTop).toBe(101);
    expect(frame?.settled).toBe(false);
  });

  it("stays on the device pixel grid", () => {
    const frame = easedBottomFollow({ current: 2118.33, target: 2400, devicePixelRatio: 2.4 });
    expect(frame).not.toBeNull();
    const grid = (frame!.scrollTop * 2.4) % 1;
    expect(Math.min(grid, 1 - grid)).toBeLessThan(1e-6);
  });
});

describe("anchor compensation", () => {
  it("cancels growth that happened above the visible text", () => {
    // 上方一行长高 16px：可见文字被推下去 16px，补 16px 让它原地不动。
    expect(anchorScrollCompensation({ scrollTop: 500, previousAnchorTop: 2080, anchorTop: 2096, devicePixelRatio: 2 })).toBe(516);
  });

  it("cancels shrink as well, in both directions", () => {
    expect(anchorScrollCompensation({ scrollTop: 500, previousAnchorTop: 2096, anchorTop: 2080, devicePixelRatio: 2 })).toBe(484);
  });

  it("ignores sub-pixel churn (rounded offsetTop would otherwise jitter every frame)", () => {
    expect(anchorScrollCompensation({ scrollTop: 500, previousAnchorTop: 2080.2, anchorTop: 2080.4, devicePixelRatio: 2.4 })).toBeNull();
    expect(anchorScrollCompensation({ scrollTop: 500, previousAnchorTop: 2080, anchorTop: 2080, devicePixelRatio: 2 })).toBeNull();
  });

  it("lands the corrected offset on the device pixel grid", () => {
    const next = anchorScrollCompensation({ scrollTop: 2118.33, previousAnchorTop: 100, anchorTop: 116.7, devicePixelRatio: 2.4 });
    expect(next).not.toBeNull();
    const grid = (next! * 2.4) % 1;
    expect(Math.min(grid, 1 - grid)).toBeLessThan(1e-6);
  });
});
