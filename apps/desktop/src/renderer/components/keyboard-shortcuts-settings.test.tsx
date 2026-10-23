import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  formatShortcut,
  matchesShortcut,
  resetShortcutBindings,
  setShortcutBinding,
  shortcutKeys,
  useShortcutKeys,
} from "../lib/keyboard-shortcuts";
import { KeyboardShortcutsSettings } from "./keyboard-shortcuts-settings";

/** Stands in for any shortcut label elsewhere in the app, such as a tooltip or menu hint. */
function NewTaskHint() {
  const keys = useShortcutKeys("task.new");
  return <span data-testid="new-task-hint">{keys.length ? formatShortcut(keys) : "none"}</span>;
}

function renderSettings() {
  render(
    <>
      <KeyboardShortcutsSettings />
      <NewTaskHint />
    </>,
  );
  return userEvent.setup();
}

function ctrl(key: string) {
  return new KeyboardEvent("keydown", { key: key.toLowerCase(), ctrlKey: true });
}

function row(id: string) {
  return document.querySelector<HTMLElement>(`[data-shortcut-id="${id}"]`)!;
}

describe("KeyboardShortcutsSettings", () => {
  beforeEach(() => {
    document.documentElement.dataset.platform = "linux";
  });
  afterEach(() => {
    cleanup();
    resetShortcutBindings();
    delete document.documentElement.dataset.platform;
  });

  it("filters the reference by label and keeps matches under their group", async () => {
    const user = renderSettings();
    expect(screen.getByRole("heading", { name: "任务视图" })).toBeTruthy();

    await user.type(
      screen.getByRole("searchbox", { name: "筛选键盘快捷键" }),
      "循环",
    );

    expect(screen.getAllByRole("heading").map((heading) => heading.textContent)).toEqual([
      "编辑器",
    ]);
    expect(screen.getByText("循环智能体")).toBeTruthy();
    expect(screen.getByText("向后循环智能体")).toBeTruthy();
    expect(screen.queryByText("在任务中查找")).toBeNull();

    await user.clear(screen.getByRole("searchbox", { name: "筛选键盘快捷键" }));
    await user.type(
      screen.getByRole("searchbox", { name: "筛选键盘快捷键" }),
      "no such shortcut",
    );
    expect(screen.getByText(/No shortcuts match/)).toBeTruthy();
  });

  it("lists Find in changes as an editable shortcut", () => {
    renderSettings();
    expect(within(row("changes.find")).getByText("在更改中查找")).toBeTruthy();
    expect(
      within(row("changes.find")).getByRole("button", {
        name: /Change shortcut for 在更改中查找/,
      }),
    ).toBeTruthy();
  });

  it("records a new binding that the matcher and other labels follow", async () => {
    const user = renderSettings();
    await user.click(screen.getByRole("button", { name: /Change shortcut for 新建任务/ }));
    expect(within(row("task.new")).getByText("Press keys…")).toBeTruthy();

    await user.keyboard("{Control>}j{/Control}");

    expect(matchesShortcut(ctrl("j"), shortcutKeys("task.new"))).toBe(true);
    expect(matchesShortcut(ctrl("n"), shortcutKeys("task.new"))).toBe(false);
    expect(screen.getByTestId("new-task-hint").textContent).toBe("Ctrl+J");
    expect(
      screen.getByRole("button", { name: "Change shortcut for 新建任务, currently Ctrl+J" }),
    ).toBeTruthy();
  });

  it("cancels with Escape, clears with Backspace, and rejects bare keys", async () => {
    const user = renderSettings();
    const change = () => screen.getByRole("button", { name: /Change shortcut for 新建任务/ });

    await user.click(change());
    await user.keyboard("j");
    expect(within(row("task.new")).getByRole("alert").textContent).toMatch(/Ctrl/);
    await user.keyboard("{Escape}");
    expect(shortcutKeys("task.new")).toEqual(["Mod", "N"]);
    expect(within(row("task.new")).queryByText("Press keys…")).toBeNull();

    await user.click(change());
    await user.keyboard("{Backspace}");
    expect(shortcutKeys("task.new")).toEqual([]);
    expect(screen.getByTestId("new-task-hint").textContent).toBe("none");
    expect(change().getAttribute("aria-label")).toBe(
      "Change shortcut for 新建任务, currently 未设置",
    );

    // The palette is the way into every command, so it cannot be cleared.
    await user.click(screen.getByRole("button", { name: /Change shortcut for 搜索任务和命令/ }));
    await user.keyboard("{Backspace}");
    expect(within(row("palette.open")).getByRole("alert").textContent).toMatch(/needs a shortcut/);
    expect(shortcutKeys("palette.open")).toEqual(["Mod", "K"]);
  });

  it("offers to replace or cancel a conflicting binding", async () => {
    const user = renderSettings();
    const recordNewTask = async () => {
      await user.click(screen.getByRole("button", { name: /Change shortcut for 新建任务/ }));
      await user.keyboard("{Control>}b{/Control}");
    };

    await recordNewTask();
    const alert = within(row("task.new")).getByRole("alert");
    expect(alert.textContent).toContain("Ctrl+B is already used by 显示或隐藏导航");
    await user.click(within(alert).getByRole("button", { name: "Cancel" }));
    expect(shortcutKeys("task.new")).toEqual(["Mod", "N"]);
    expect(shortcutKeys("navigation.toggle")).toEqual(["Mod", "B"]);

    await recordNewTask();
    await user.click(
      within(within(row("task.new")).getByRole("alert")).getByRole("button", { name: "Replace" }),
    );
    expect(shortcutKeys("task.new")).toEqual(["Mod", "B"]);
    expect(shortcutKeys("navigation.toggle")).toEqual([]);
  });

  it("resets one row or restores every default", async () => {
    setShortcutBinding("task.new", ["Mod", "J"]);
    setShortcutBinding("settings.open", ["Mod", "Shift", "P"]);
    const user = renderSettings();

    await user.click(screen.getByRole("button", { name: "重置 新建任务 为 Ctrl+N" }));
    expect(shortcutKeys("task.new")).toEqual(["Mod", "N"]);
    expect(screen.queryByRole("button", { name: "重置 新建任务 为 Ctrl+N" })).toBeNull();
    expect(shortcutKeys("settings.open")).toEqual(["Mod", "Shift", "P"]);

    await user.click(screen.getByRole("button", { name: "Restore defaults" }));
    expect(shortcutKeys("settings.open")).toEqual(["Mod", ","]);
    expect(
      (screen.getByRole("button", { name: "Restore defaults" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("keeps built-in composer keys locked", () => {
    renderSettings();
    expect(within(row("composer.send")).queryByRole("button")).toBeNull();
    expect(within(row("composer.send")).getByText("Part of typing in the composer")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Change shortcut for 发送消息/ })).toBeNull();
  });
});
