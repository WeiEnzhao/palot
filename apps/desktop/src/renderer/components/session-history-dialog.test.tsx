import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { PalotMessage } from "../../shared";
import { SessionHistoryDialog } from "./session-history-dialog";
import { adjacentPromptID } from "../lib/session-history";

afterEach(cleanup);
it("searches newly loaded prompts without claiming partial history is complete", async () => {
  const user = userEvent.setup();
  const select = vi.fn();
  const load = vi.fn();
  const props = {
    mode: "timeline" as const,
    onClose: vi.fn(),
    onSelect: select,
    hasMore: true,
    loading: false,
    error: false,
    onLoadMore: load,
  };
  const message = (id: string, text: string) =>
    ({ id, text, type: "user", createdAt: 1 }) as PalotMessage;
  const view = render(
    <SessionHistoryDialog {...props} messages={[message("new", "New prompt")]} />,
  );
  await user.type(screen.getByRole("textbox", { name: "搜索提示词" }), "needle");
  expect(
    screen.getByText("没有匹配的已加载提示词。加载更早的历史以搜索更多。"),
  ).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "加载更早的提示词" }));
  expect(load).toHaveBeenCalledOnce();
  view.rerender(
    <SessionHistoryDialog {...props} loading messages={[message("new", "New prompt")]} />,
  );
  expect(screen.getByRole("status").textContent).toBe("正在加载更早的提示词…");
  const older = message("old", "The needle is here");
  view.rerender(
    <SessionHistoryDialog
      {...props}
      hasMore={false}
      messages={[older, message("new", "New prompt")]}
    />,
  );
  await user.click(screen.getByRole("button", { name: /The needle is here/ }));
  expect(select).toHaveBeenCalledWith(older);
});
it("does not wrap turn navigation and resolves IDs after a prepend", () => {
  expect(adjacentPromptID(["b", "c"], "b", "previous")).toBeNull();
  expect(adjacentPromptID(["a", "b", "c"], "b", "previous")).toBe("a");
  expect(adjacentPromptID(["a", "b", "c"], "c", "next")).toBeNull();
});
