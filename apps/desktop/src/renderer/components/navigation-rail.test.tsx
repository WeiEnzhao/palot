import { createStore } from "jotai";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { navigationOpenAtom, sidebarModeAtom } from "../atoms/ui";
import { renderWithRouter } from "../test-utils/render-with-router";
import { NavigationRail } from "./navigation-rail";

beforeEach(() => {
  window.localStorage.clear();
  Element.prototype.getAnimations = vi.fn(() => []);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("NavigationRail", () => {
  it("opens the tools section of Settings from the rail", async () => {
    const store = createStore();
    const { router } = renderWithRouter(<NavigationRail />, store, "/usage");
    const tools = document.querySelector<HTMLElement>(
      '[data-navigation-rail] button[aria-label="工具"]',
    );
    if (!tools) throw new Error("图标轨里没有「工具」按钮");

    await userEvent.click(tools);

    await waitFor(() => expect(router.state.location.pathname).toBe("/settings/tools"));
    // 「工具」亮着时，底部通用「设置」不该跟着亮成第二个选中项。
    const gear = document.querySelector<HTMLElement>(
      '[data-navigation-rail] button[aria-label="设置"]',
    );
    expect(gear?.getAttribute("aria-current")).not.toBe("page");
  });

  it("returns from a full-page destination to the workspace when a column view is chosen", async () => {
    const store = createStore();
    store.set(sidebarModeAtom, "inbox");
    const { router } = renderWithRouter(<NavigationRail />, store, "/usage");

    // 全屏页面上点侧栏视图：光拨开关不够，必须真的把人带回工作区。
    await userEvent.click(screen.getByRole("button", { name: "显示项目" }));

    expect(store.get(sidebarModeAtom)).toBe("project");
    expect(store.get(navigationOpenAtom)).toBe(true);
    await waitFor(() => expect(router.state.location.pathname).toBe("/new"));
  });

  it("returns from Settings to the workspace when a column view is chosen", async () => {
    const store = createStore();
    store.set(sidebarModeAtom, "inbox");
    const { router } = renderWithRouter(<NavigationRail />, store, "/settings/general");

    expect(screen.getByRole("button", { name: "设置" }).getAttribute("aria-current")).toBe(
      "page",
    );
    // Outside the workspace no column is visible, so neither view reads as pressed.
    expect(screen.getByRole("button", { name: "显示收件箱" }).getAttribute("aria-pressed")).toBe(
      "false",
    );

    await userEvent.click(screen.getByRole("button", { name: "显示项目" }));

    expect(store.get(sidebarModeAtom)).toBe("project");
    expect(store.get(navigationOpenAtom)).toBe(true);
    await waitFor(() => expect(router.state.location.pathname).toBe("/new"));
    expect(screen.getByRole("button", { name: "显示项目" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(
      screen.getByRole("button", { name: "设置" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("opens a hidden task column and toggles the active view's column", async () => {
    const store = createStore();
    store.set(sidebarModeAtom, "inbox");
    const changes: boolean[] = [];
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <NavigationRail
          navigationOpen={open}
          onNavigationOpenChange={(next) => {
            changes.push(next);
            setOpen(next);
          }}
        />
      );
    }
    renderWithRouter(<Harness />, store, "/new");

    // A hidden column reads as no view selected; choosing one opens it in that view.
    expect(screen.getByRole("button", { name: "显示收件箱" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    await userEvent.click(screen.getByRole("button", { name: "显示项目" }));
    expect(store.get(sidebarModeAtom)).toBe("project");
    expect(changes).toEqual([true]);
    expect(screen.getByRole("button", { name: "显示项目" }).getAttribute("aria-pressed")).toBe(
      "true",
    );

    // Another view switches content without closing the column.
    await userEvent.click(screen.getByRole("button", { name: "显示收件箱" }));
    expect(store.get(sidebarModeAtom)).toBe("inbox");
    expect(changes).toEqual([true]);

    // The active view closes the column again.
    await userEvent.click(screen.getByRole("button", { name: "显示收件箱" }));
    expect(changes).toEqual([true, false]);
    expect(screen.getByRole("button", { name: "显示收件箱" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });
});
