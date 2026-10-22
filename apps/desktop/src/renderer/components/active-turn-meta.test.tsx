import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TranscriptTurn } from "../lib/turn-projection";
import { ActiveTurnMeta, activeTurnLabel } from "./thread";

function turn(input: Partial<TranscriptTurn>): TranscriptTurn {
  return {
    id: "turn",
    user: null,
    users: [],
    activity: [],
    blockingRequests: [],
    final: null,
    postFinal: [],
    tokensPerSecond: null,
    status: "working",
    startedAt: 1,
    finalStartedAt: null,
    workCompletedAt: null,
    completedAt: null,
    canCollapse: false,
    shouldAutoCollapse: false,
    ...input,
  };
}

describe("ActiveTurnMeta", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows and updates the active turn duration", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T12:00:05.000Z"));

    render(<ActiveTurnMeta startedAt={Date.now() - 5_000} />);

    expect(screen.getByRole("status", { name: "工作中，已用时 5 秒" })).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(61_000);
    });
    expect(screen.getByRole("status", { name: "工作中，已用时 1 分 06 秒" })).toBeTruthy();
  });

  it("distinguishes execution cleanup after the final response", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T12:00:05.000Z"));

    render(<ActiveTurnMeta startedAt={Date.now() - 5_000} label="收尾中" />);

    expect(screen.getByRole("status", { name: "收尾中，已用时 5 秒" })).toBeTruthy();
  });

  it("does not call streaming preamble text final before tool activity appears", () => {
    const message = {
      id: "assistant",
      type: "assistant" as const,
      createdAt: 2,
      completedAt: null,
      text: "I will inspect that.",
      agent: null,
      model: null,
      tokens: null,
      finish: null,
      content: [],
      data: null,
    };
    const final = { message, part: { type: "text" as const, text: message.text }, index: 0 };

    expect(activeTurnLabel(turn({ final }))).toBe("工作中");
    expect(
      activeTurnLabel(
        turn({
          final,
          activity: [
            {
              id: "tools",
              kind: "tools",
              title: "Inspected files",
              status: "completed",
              entries: [],
            },
          ],
        }),
      ),
    ).toBe("收尾中");
  });
});
