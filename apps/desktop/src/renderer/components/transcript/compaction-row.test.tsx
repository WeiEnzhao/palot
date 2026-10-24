import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PalotMessage, PalotMessageContent } from "../../../shared";
import type { TurnActivityGroup } from "../../lib/turn-projection";
import {
  COMPACTION_SLOW_HINT_MS,
  CompactionBoundary,
  CompactionTranscriptContext,
  type CompactionTranscriptActions,
  compactionLabel,
} from "./compaction-row";

function compaction(
  part: Omit<PalotMessageContent, "type">,
  status: TurnActivityGroup["status"],
): TurnActivityGroup {
  const content: PalotMessageContent = { type: "compaction", id: "compaction-1", ...part };
  const message: PalotMessage = {
    id: "compaction-1",
    type: "compaction",
    createdAt: 1,
    completedAt: status === "running" ? null : 2,
    text: null,
    agent: null,
    model: null,
    tokens: null,
    finish: null,
    content: [content],
    data: null,
  };
  return {
    id: "compaction-1",
    kind: "compaction",
    title: "正在压缩上下文",
    status,
    entries: [{ message, part: content, index: 0 }],
    startedAt: message.createdAt,
    ...(message.completedAt !== null ? { completedAt: message.completedAt } : {}),
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CompactionBoundary", () => {
  it("names automatic and manual compaction differently once done", () => {
    const view = render(
      <CompactionBoundary
        group={compaction({ status: "completed", reason: "auto" }, "completed")}
      />,
    );
    expect(screen.getByText(/上下文已自动压缩 · \d{2}:\d{2} · 耗时 0 秒/)).toBeTruthy();
    view.rerender(
      <CompactionBoundary
        group={compaction({ status: "completed", reason: "manual" }, "completed")}
      />,
    );
    expect(screen.getByText(/上下文已压缩 · \d{2}:\d{2} · 耗时 0 秒/)).toBeTruthy();
    expect(screen.queryByText(/上下文已自动压缩/)).toBeNull();
  });

  it("adds a duration hint after ten seconds of compacting", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T12:00:00.000Z"));
    render(
      <CompactionBoundary
        group={compaction(
          { status: "running", reason: "auto", time: { created: Date.now() - 4_000 } },
          "running",
        )}
      />,
    );

    expect(screen.getByText("正在压缩上下文")).toBeTruthy();
    expect(screen.queryByText(/这可能需要几分钟/)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(COMPACTION_SLOW_HINT_MS - 4_001);
    });
    expect(screen.queryByText(/这可能需要几分钟/)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText("· 这可能需要几分钟")).toBeTruthy();
  });

  it("shows the hint immediately when an already long compaction hydrates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T12:00:00.000Z"));
    render(
      <CompactionBoundary
        group={compaction({ status: "running", time: { created: Date.now() - 60_000 } }, "running")}
      />,
    );
    expect(screen.getByText("· 这可能需要几分钟")).toBeTruthy();
  });

  it("folds approximate before and after context tokens into the detail", async () => {
    const user = userEvent.setup();
    const result = render(
      <CompactionBoundary
        group={compaction(
          {
            status: "completed",
            reason: "auto",
            text: "Summary",
            recent: "x".repeat(400),
            tokens: {
              input: 90_000,
              output: 2_000,
              reasoning: 0,
              cache: { read: 30_000, write: 0 },
            },
          },
          "completed",
        )}
      />,
    );
    const boundary = within(result.container);
    const row = result.container.querySelector('[data-palot-compaction="compaction-1"]');
    expect(row?.getAttribute("data-palot-compaction-reason")).toBe("auto");
    expect(boundary.queryByText(/→/)).toBeNull();

    await user.click(boundary.getByRole("button", { name: /上下文已自动压缩 · \d{2}:\d{2} · 耗时 0 秒/ }));

    // Without measured steps around it, the row estimates from the compaction request.
    expect(boundary.getByText("上下文：约 120k → 2.1k 个 token")).toBeTruthy();
  });

  it("prefers the measured context windows around the compaction", async () => {
    const user = userEvent.setup();
    render(
      <CompactionTranscriptContext.Provider
        value={{
          retryableCompactionID: null,
          retry: () => Promise.resolve(),
          windows: new Map([["compaction-1", { before: 152_000, after: 18_400 }]]),
        }}
      >
        <CompactionBoundary
          group={compaction(
            { status: "completed", reason: "manual", text: "Summary" },
            "completed",
          )}
        />
      </CompactionTranscriptContext.Provider>,
    );

    await user.click(screen.getByRole("button", { name: /上下文已压缩 · \d{2}:\d{2} · 耗时 0 秒/ }));
    expect(screen.getByText("上下文：152k → 18k 个 token")).toBeTruthy();
  });

  it("offers retry only for the transcript's retryable failure", async () => {
    const user = userEvent.setup();
    const retry = vi.fn(() => Promise.resolve());
    const group = compaction({ status: "failed", error: "Context is too large" }, "failed");
    const renderWith = (actions: CompactionTranscriptActions | null) => (
      <CompactionTranscriptContext.Provider value={actions}>
        <CompactionBoundary group={group} />
      </CompactionTranscriptContext.Provider>
    );
    const view = render(renderWith(null));
    expect(screen.getByRole("button", { name: "上下文压缩失败" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "重试压缩" })).toBeNull();

    view.rerender(renderWith({ retryableCompactionID: "older", retry }));
    expect(screen.queryByRole("button", { name: "重试压缩" })).toBeNull();

    view.rerender(renderWith({ retryableCompactionID: "compaction-1", retry }));
    await user.click(screen.getByRole("button", { name: "重试压缩" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("shows duration when compaction completes", () => {
    const startedAt = Date.now() - 15_000;
    const completedAt = Date.now();
    const content: PalotMessageContent = {
      type: "compaction",
      id: "compaction-1",
      status: "completed",
      reason: "auto",
    };
    const message: PalotMessage = {
      id: "compaction-1",
      type: "compaction",
      createdAt: startedAt,
      completedAt,
      text: null,
      agent: null,
      model: null,
      tokens: null,
      finish: null,
      content: [content],
      data: null,
    };
    const group: TurnActivityGroup = {
      id: "compaction-1",
      kind: "compaction",
      title: "正在压缩上下文",
      status: "completed",
      entries: [{ message, part: content, index: 0 }],
      startedAt,
      completedAt,
    };
    render(<CompactionBoundary group={group} />);
    expect(screen.getByText(/上下文已自动压缩 · \d{2}:\d{2} · 耗时 15 秒/)).toBeTruthy();
  });

  it("falls back to the part's created time for restored history without group times", () => {
    // 历史消息回放时 group 没有 startedAt/completedAt，用部件创建时间显示钟点。
    const label = compactionLabel(
      { reason: "manual", time: { created: new Date("2026-10-24T06:32:00Z").getTime() } },
      "completed",
      undefined,
      undefined,
    );
    expect(label).toMatch(/^上下文已压缩 · \d{2}:\d{2}$/);
  });
});
