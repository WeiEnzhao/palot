import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextUsage } from "../lib/context-usage";
import { ContextMeter, type ContextMeterProps } from "./context-meter";

function usage(percentage: number, overrides: Partial<ContextUsage> = {}): ContextUsage {
  const total = percentage * 10_000;
  return {
    total,
    limit: 1_000_000,
    percentage,
    breakdown: { cached: total - 10_000, uncached: 8_000, output: 2_000 },
    messageID: "step",
    model: { id: "model", providerID: "provider" },
    updatedAt: Date.now(),
    compacted: false,
    ...overrides,
  };
}

function renderMeter(props: Partial<ContextMeterProps> = {}) {
  const onCompact = vi.fn();
  const onOpenDetails = vi.fn();
  render(
    <ContextMeter
      usage={usage(45)}
      sessionTokens={{
        input: 2,
        output: 3_000,
        reasoning: 0,
        cache: { read: 2_400_000, write: 0 },
      }}
      cost={1.2345}
      lastCompactedAt={null}
      compacting={false}
      compactDisabledReason={null}
      onCompact={onCompact}
      onOpenDetails={onOpenDetails}
      {...props}
    />,
  );
  return { onCompact, onOpenDetails };
}

beforeEach(() => {
  Element.prototype.getAnimations = vi.fn(() => []);
});

afterEach(cleanup);

describe("ContextMeter", () => {
  it.each([
    [45, "normal", "上下文窗口：已用 45%（剩余 55%）"],
    [70, "warning", "上下文窗口：已用 70%"],
    [93, "critical", "上下文窗口：已用 93%"],
  ])("names the ring and colors it by threshold at %i%%", (percentage, status, name) => {
    renderMeter({ usage: usage(percentage) });
    expect(screen.getByRole("button", { name }).getAttribute("data-status")).toBe(status);
  });

  it.each([
    ["a paid model before usage", { usage: null, cost: 0 }, "0·$0.00"],
    ["a paid model", { cost: 4.55 }, "450k·$4.55"],
    ["a free model", { cost: 0, freeModel: true }, "450k"],
    ["earlier paid spend on a free model", { cost: 1.25, freeModel: true }, "450k·$1.25"],
    ["unknown cost", { cost: null }, "450k"],
  ] satisfies [string, Partial<ContextMeterProps>, string][])(
    "shows compact tokens and cost beside the ring for %s",
    (_, props, text) => {
      renderMeter(props);
      const trigger = screen.getByRole("button", { name: /^上下文窗口/ });
      expect(trigger.textContent).toBe(text);
    },
  );

  it("opens a summary with the window, cost, and total processed on press", async () => {
    renderMeter({ lastCompactedAt: Date.now() - 2 * 3_600_000 });
    await userEvent.click(screen.getByRole("button", { name: /^上下文窗口/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("上下文窗口：已用 45%（剩余 55%）")).toBeTruthy();
    expect(within(dialog).getByText("已使用 450k / 1M tokens")).toBeTruthy();
    expect(within(dialog).getByRole("meter", { name: "上下文用量" })).toBeTruthy();
    expect(within(dialog).getByText("$1.23")).toBeTruthy();
    expect(within(dialog).getByText("2.4M tokens")).toBeTruthy();
    expect(within(dialog).getByText("2小时前")).toBeTruthy();
  });

  it("compacts and opens details from the popover", async () => {
    const { onCompact, onOpenDetails } = renderMeter();
    await userEvent.click(screen.getByRole("button", { name: /^上下文窗口/ }));
    await userEvent.click(await screen.findByRole("button", { name: "立即压缩" }));
    expect(onCompact).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole("button", { name: /^上下文窗口/ }));
    await userEvent.click(await screen.findByRole("button", { name: "上下文详情" }));
    expect(onOpenDetails).toHaveBeenCalledOnce();
  });

  it("disables Compact now with the reason while work is running", async () => {
    const { onCompact } = renderMeter({
      compactDisabledReason: "等当前回复结束后再试。",
    });
    await userEvent.click(screen.getByRole("button", { name: /^上下文窗口/ }));
    const compact = await screen.findByRole("button", { name: "立即压缩" });
    expect((compact as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("等当前回复结束后再试。")).toBeTruthy();
    expect(compact.getAttribute("aria-describedby")).toBeTruthy();
    expect(onCompact).not.toHaveBeenCalled();
  });

  it("says the window is pending after a compaction", async () => {
    renderMeter({ usage: usage(80, { compacted: true }) });
    const trigger = screen.getByRole("button", { name: "上下文窗口：已压缩" });
    expect(trigger.getAttribute("data-status")).toBe("unavailable");
    await userEvent.click(trigger);
    expect(
      await screen.findByText("已压缩上下文。用量将在下一次回复后更新。"),
    ).toBeTruthy();
  });
});
