import { Provider, createStore } from "jotai";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeClient } from "@opencode/client";
import type { PalotApi, PalotFileAttachment } from "../../shared";
import { openCodeReconciler } from "../lib/open-code-reconciler";
import { createRendererQueryClient } from "../lib/query-client";
import type { PendingRequestView } from "../lib/view-models";
import { resetOpenCodeClientForTest, setOpenCodeClientForTest } from "../services/opencode-client";
import { ComposerQueue } from "./composer-queue";

function pending(
  id: string,
  detail: string,
  delivery: "queue" | "steer" = "queue",
): PendingRequestView {
  return {
    id,
    type: "input",
    title: "Pending input",
    detail,
    resources: [],
    savePatterns: [],
    questions: [],
    fields: [],
    delivery,
  };
}

const file = (name: string): PalotFileAttachment => ({
  uri: `file:///workspace/${name}`,
  name,
  mime: "text/plain",
  size: 1,
});

function inbox() {
  const update = vi.fn().mockResolvedValue(undefined);
  const cancel = vi.fn().mockResolvedValue(undefined);
  (window as unknown as { palot?: PalotApi }).palot = { runtimeStatus: vi.fn() } as never;
  setOpenCodeClientForTest({ session: { inbox: { update, cancel } } } as unknown as OpenCodeClient);
  return { update, cancel };
}

function renderQueue(element: ReactElement, interrupted = false) {
  const queryClient = createRendererQueryClient();
  if (interrupted) {
    openCodeReconciler(queryClient).replaceActivity("disconnected", {
      activeIDs: new Set(),
      execution: new Map([["ses_1", { status: "interrupted", startedAt: 1, completedAt: 2 }]]),
      statuses: new Map(),
    });
  }
  return render(
    <QueryClientProvider client={queryClient}>
      <Provider store={createStore()}>{element}</Provider>
    </QueryClientProvider>,
  );
}

function row(label: string) {
  return screen.getByRole("region", { name: `待发送消息操作：${label}` });
}

afterEach(() => {
  cleanup();
  resetOpenCodeClientForTest();
  delete (window as unknown as { palot?: PalotApi }).palot;
});

describe("ComposerQueue", () => {
  it("shows one-line previews, attachment counts, and queue states", () => {
    inbox();
    renderQueue(
      <ComposerQueue
        sessionID="ses_1"
        working
        requests={[
          pending("a", "Run tests\nafter this turn"),
          pending("b", " "),
          pending("c", "Adjust the approach", "steer"),
        ]}
        filesByID={
          new Map([
            ["a", [file("log.txt"), file("diff.patch")]],
            ["b", [file("only.png")]],
          ])
        }
      />,
    );
    // Three inputs collapse to a count; opening the list reveals each row.
    expect(screen.queryByRole("region", { name: /^待发送消息操作/ })).toBeNull();
    act(() => screen.getByRole("button", { name: "3 个待发送" }).click());

    const first = row("Run tests after this turn");
    expect(within(first).getByText("排队中 · 1")).toBeTruthy();
    expect(within(first).getByLabelText("2 个附件")).toBeTruthy();
    expect(within(row("only.png")).getByText("排队中 · 2")).toBeTruthy();
    expect(within(row("Adjust the approach")).getByText("待引导")).toBeTruthy();
    expect(
      within(row("Adjust the approach")).getByRole("button", { name: "在当前回合后运行" }),
    ).toBeTruthy();
    expect(screen.queryByRole("group", { name: "已暂停队列" })).toBeNull();
  });

  it("collapses more than two inputs to a keyboard-operable count", async () => {
    const user = userEvent.setup();
    inbox();
    renderQueue(
      <ComposerQueue
        sessionID="ses_1"
        working
        requests={[pending("a", "One"), pending("b", "Two"), pending("c", "Three")]}
      />,
    );
    const toggle = screen.getByRole("button", { name: "3 个排队中" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("One")).toBeNull();

    toggle.focus();
    await user.keyboard("{Enter}");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Three")).toBeTruthy();
    await user.keyboard("{Enter}");
    expect(screen.queryByText("One")).toBeNull();
  });

  it("steers a queued input now and reports it as steered", async () => {
    const user = userEvent.setup();
    const { update } = inbox();
    const sent = Promise.withResolvers<void>();
    update.mockReturnValueOnce(sent.promise);
    const onSteered = vi.fn();
    renderQueue(
      <ComposerQueue
        sessionID="ses_1"
        working
        requests={[pending("a", "Ship it")]}
        onSteered={onSteered}
      />,
    );

    await user.click(within(row("Ship it")).getByRole("button", { name: "引导下一个" }));
    expect(update).toHaveBeenCalledExactlyOnceWith({
      sessionID: "ses_1",
      inboxID: "a",
      delivery: "steer",
    });
    expect(within(row("Ship it")).getByText("发送中")).toBeTruthy();
    await act(async () => sent.resolve());
    expect(onSteered).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
    // OpenCode's inbox, not the click, moves the row out of the queue.
    expect(within(row("Ship it")).getByText("排队中")).toBeTruthy();
  });

  it("marks a failed action and retries the same action", async () => {
    const user = userEvent.setup();
    const { update } = inbox();
    update.mockRejectedValueOnce(new Error("Inbox conflict"));
    renderQueue(<ComposerQueue sessionID="ses_1" working requests={[pending("a", "Ship it")]} />);

    await user.click(within(row("Ship it")).getByRole("button", { name: "引导下一个" }));
    const failed = row("Ship it");
    await waitFor(() => expect(within(failed).getByText("失败")).toBeTruthy());
    expect(within(failed).getByText(/Inbox conflict/)).toBeTruthy();

    await user.click(within(failed).getByRole("button", { name: "重试" }));
    await waitFor(() => expect(within(row("Ship it")).getByText("排队中")).toBeTruthy());
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenLastCalledWith({
      sessionID: "ses_1",
      inboxID: "a",
      delivery: "steer",
    });
  });

  it("edits through the composer and deletes through OpenCode", async () => {
    const user = userEvent.setup();
    const { cancel } = inbox();
    const onEdit = vi.fn().mockResolvedValue(undefined);
    renderQueue(
      <ComposerQueue
        sessionID="ses_1"
        working
        requests={[pending("a", "Ship it"), pending("b", "Then document it")]}
        onEdit={onEdit}
      />,
    );

    await user.click(within(row("Ship it")).getByRole("button", { name: "取消并编辑" }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }));
    await user.click(
      within(row("Then document it")).getByRole("button", { name: "取消待发送的消息" }),
    );
    expect(cancel).toHaveBeenCalledExactlyOnceWith({ sessionID: "ses_1", inboxID: "b" });
  });

  it("pauses a stopped queue until Resume sends the next input", async () => {
    const user = userEvent.setup();
    const { update } = inbox();
    renderQueue(
      <ComposerQueue
        sessionID="ses_1"
        working={false}
        requests={[pending("a", "First"), pending("b", "Second")]}
      />,
      true,
    );

    const paused = screen.getByRole("group", { name: "已暂停队列" });
    expect(
      await within(paused).findByText("队列已暂停：你停止了任务"),
    ).toBeTruthy();
    expect(within(row("First")).getByRole("button", { name: "立即发送" })).toBeTruthy();
    expect(update).not.toHaveBeenCalled();

    await user.click(within(paused).getByRole("button", { name: "恢复" }));
    expect(update).toHaveBeenCalledExactlyOnceWith({
      sessionID: "ses_1",
      inboxID: "a",
      delivery: "steer",
    });
  });

  it("resumes a parked steer by requesting the same OpenCode wake", async () => {
    const user = userEvent.setup();
    const { update } = inbox();
    renderQueue(
      <ComposerQueue sessionID="ses_1" working={false} requests={[pending("a", "Now", "steer")]} />,
    );
    await user.click(screen.getByRole("button", { name: "恢复" }));
    expect(update.mock.calls.map(([input]) => input.delivery)).toEqual(["queue", "steer"]);
  });

  it("clears a paused queue only after confirmation", async () => {
    const user = userEvent.setup();
    const { cancel } = inbox();
    cancel.mockImplementation(async ({ inboxID }: { inboxID: string }) => {
      if (inboxID === "b") throw new Error("Already delivered");
    });
    renderQueue(
      <ComposerQueue
        sessionID="ses_1"
        working={false}
        requests={[pending("a", "First"), pending("b", "Second")]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "清空队列" }));
    expect(cancel).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "清空队列" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "清空队列" }));
    await user.click(screen.getByRole("button", { name: "确认清空队列" }));
    expect(cancel.mock.calls.map(([input]) => input.inboxID)).toEqual(["a", "b"]);
    // The refused cancellation stays visible with a retry.
    await waitFor(() => expect(within(row("Second")).getByText("失败")).toBeTruthy());
    expect(within(row("Second")).getByRole("button", { name: "重试" })).toBeTruthy();
  });

  it("reorders items by drag and changes the resume target", async () => {
    const user = userEvent.setup();
    const { update } = inbox();
    renderQueue(
      <ComposerQueue
        sessionID="ses_1"
        working={false}
        requests={[
          pending("a", "First"),
          pending("b", "Second"),
          pending("c", "Third"),
        ]}
      />,
      true,
    );

    // 展开列表（3 条默认折叠）
    act(() => screen.getByRole("button", { name: "3 个排队中" }).click());

    // 验证初始顺序
    const rows = screen.getAllByRole("region", { name: /^待发送消息操作/ });
    expect(rows.map((r) => r.getAttribute("data-palot-request-id"))).toEqual(["a", "b", "c"]);

    // 模拟拖拽：把 "c" 拖到 "a" 的位置（事件直接落在行容器上，行本身带 draggable）
    const rowC = row("Third");
    const rowA = row("First");

    // 触发拖拽事件序列
    act(() => {
      fireEvent.dragStart(rowC, { dataTransfer: new DataTransfer() });
      fireEvent.dragOver(rowA, { dataTransfer: new DataTransfer() });
      fireEvent.drop(rowA, { dataTransfer: new DataTransfer() });
      fireEvent.dragEnd(rowC, { dataTransfer: new DataTransfer() });
    });

    // 验证顺序变为 c, a, b
    const reorderedRows = screen.getAllByRole("region", { name: /^待发送消息操作/ });
    expect(reorderedRows.map((r) => r.getAttribute("data-palot-request-id"))).toEqual([
      "c",
      "a",
      "b",
    ]);

    // 点击恢复，应该取用新顺序的第一条（c）
    await user.click(screen.getByRole("button", { name: "恢复" }));
    expect(update).toHaveBeenCalledExactlyOnceWith({
      sessionID: "ses_1",
      inboxID: "c",
      delivery: "steer",
    });
  });
});
