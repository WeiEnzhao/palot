import { useState } from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionApprovalMode } from "../lib/session-permissions";
import { ApprovalSelector } from "./approval-selector";

vi.mock("../lib/toast-error", () => ({ showErrorToast: vi.fn() }));
afterEach(cleanup);

function setup(
  mode: SessionApprovalMode = "normal",
  onSelect = vi.fn().mockResolvedValue(undefined),
  disabled = false,
) {
  const focus = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <ApprovalSelector
        mode={mode}
        busy={false}
        disabled={disabled}
        open={open}
        onOpenChange={setOpen}
        onSelect={onSelect}
        onSelectionComplete={focus}
      />
    );
  }
  render(<Harness />);
  return { onSelect, focus };
}

describe("ApprovalSelector", () => {
  it("requires confirmation before elevating access, and cancellation leaves rules alone", async () => {
    const { onSelect } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Approvals: 默认" }));
    await userEvent.click(await screen.findByRole("option", { name: /^完全访问/ }));
    const dialog = await screen.findByRole("alertdialog", { name: "启用完全访问？" });
    expect(onSelect).not.toHaveBeenCalled();
    expect(within(dialog).getByText(/计划编辑限制/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("applies Full access only after confirmation and returns focus", async () => {
    const { onSelect, focus } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Approvals: 默认" }));
    await userEvent.click(await screen.findByRole("option", { name: /^完全访问/ }));
    await userEvent.click(await screen.findByRole("button", { name: "启用完全访问" }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledExactlyOnceWith("full"));
    expect(focus).toHaveBeenCalledOnce();
    // The dialog unmounts after its exit motion.
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("shows Custom honestly and can replace it with Defaults", async () => {
    const { onSelect } = setup("custom");
    await userEvent.click(screen.getByRole("button", { name: "Approvals: 自定义" }));
    expect(await screen.findByText(/自定义会话规则已生效/)).toBeTruthy();
    expect(
      screen.getAllByRole("option").map((option) => option.getAttribute("aria-selected")),
    ).toEqual(["false", "false"]);
    await userEvent.click(screen.getByRole("option", { name: /^默认/ }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledExactlyOnceWith("normal"));
  });

  it("keeps failed elevation visible without claiming success", async () => {
    const { onSelect, focus } = setup(
      "normal",
      vi.fn().mockRejectedValue(new Error("Server unavailable")),
    );
    await userEvent.click(screen.getByRole("button", { name: "Approvals: 默认" }));
    await userEvent.click(await screen.findByRole("option", { name: /^完全访问/ }));
    await userEvent.click(await screen.findByRole("button", { name: "启用完全访问" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Server unavailable");
    expect(onSelect).toHaveBeenCalledOnce();
    expect(focus).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByRole("button", { name: "Approvals: 默认" })).toBeTruthy();
  });

  it("disables changes when the connection or composer is unavailable", () => {
    setup("normal", vi.fn(), true);
    expect(
      (screen.getByRole("button", { name: "Approvals: 默认" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
