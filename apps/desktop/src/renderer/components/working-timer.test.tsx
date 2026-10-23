import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkingTimer } from "./working-timer";
import type { TranscriptTurn } from "../lib/turn-projection";

function makeTurn(overrides: Partial<TranscriptTurn> = {}): TranscriptTurn {
  return {
    id: "turn-1",
    status: "working",
    user: null,
    users: [],
    activity: [],
    blockingRequests: [],
    final: null,
    postFinal: [],
    tokensPerSecond: null,
    startedAt: Date.now() - 65_000, // 1 分 5 秒前
    finalStartedAt: null,
    workCompletedAt: null,
    completedAt: null,
    canCollapse: false,
    shouldAutoCollapse: false,
    ...overrides,
  };
}

describe("WorkingTimer", () => {
  it("visible 为 false 时不渲染", () => {
    const turn = makeTurn();
    const { container } = render(<WorkingTimer turn={turn} visible={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("turn 为 null 时不渲染", () => {
    const { container } = render(<WorkingTimer turn={null} visible={true} />);
    expect(container.firstChild).toBeNull();
  });

  it("turn.status 不是 working 时不渲染", () => {
    const turn = makeTurn({ status: "completed" });
    const { container } = render(<WorkingTimer turn={turn} visible={true} />);
    expect(container.firstChild).toBeNull();
  });

  it("visible 为 true 且 turn.status 为 working 时渲染计时器", () => {
    const turn = makeTurn();
    render(<WorkingTimer turn={turn} visible={true} />);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByText("工作中")).toBeTruthy();
  });

  it("显示正确的时长格式", () => {
    const turn = makeTurn({ startedAt: Date.now() - 125_000 }); // 2 分 5 秒
    render(<WorkingTimer turn={turn} visible={true} />);
    // formatDurationCn 会格式化为 "2 分 5 秒"
    expect(screen.getByText(/2 分/)).toBeTruthy();
  });
});
