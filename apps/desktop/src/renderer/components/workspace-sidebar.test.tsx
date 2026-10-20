import { createStore } from "jotai";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithRouter } from "../test-utils/render-with-router";
import { SidebarProvider } from "./ui/sidebar";
import { NavigationRail } from "./navigation-rail";
import { WorkspaceSidebar } from "./workspace-sidebar";
import { runtimeAtom } from "../atoms/workspace";
import { includedProfileIDsAtom } from "../atoms/connections";
import { palot } from "../services/palot";

beforeEach(() => {
  window.localStorage.clear();
  Element.prototype.getAnimations = vi.fn(() => []);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WorkspaceSidebar", () => {
  it("keeps one sidebar shell while switching mode-specific content", async () => {
    const store = createStore();
    const onSearchTasks = vi.fn();

    renderWithRouter(
      <SidebarProvider>
        {/* The workspace mounts the rail beside the task column, not inside it. */}
        <NavigationRail navigationOpen onNavigationOpenChange={vi.fn()} />
        <WorkspaceSidebar open onNewSession={vi.fn()} onSearchTasks={onSearchTasks} />
      </SidebarProvider>,
      store,
    );

    const shell = document.querySelector("[data-sidebar-mode]");
    expect(shell).toBeTruthy();
    expect(shell?.querySelector("[data-navigation-rail]")).toBeNull();
    const rail = screen.getByRole("navigation", { name: "Palot" });
    expect(
      within(rail).getByRole("button", { name: "显示收件箱" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(document.querySelector('[aria-label="收件箱导航"]')).toBeTruthy();
    expect(screen.getByRole("button", { name: "筛选任务" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "收件箱选项" })).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.querySelectorAll('[data-slot="sidebar-header"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-slot="sidebar-footer"]')).toHaveLength(1);

    const search = screen.getByRole("button", { name: "搜索任务" });
    await userEvent.click(search);
    expect(onSearchTasks).toHaveBeenCalledExactlyOnceWith(search);

    await userEvent.click(within(rail).getByRole("button", { name: "显示项目" }));

    expect(document.querySelector("[data-sidebar-mode]")).toBe(shell);
    expect(
      within(rail).getByRole("button", { name: "显示项目" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(document.querySelector('[aria-label="任务导航"]')).toBeTruthy();
    expect(document.querySelectorAll('[data-slot="sidebar-header"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-slot="sidebar-footer"]')).toHaveLength(1);

    await userEvent.click(within(rail).getByRole("button", { name: "显示收件箱" }));

    expect(document.querySelector("[data-sidebar-mode]")).toBe(shell);
    expect(screen.getByRole("button", { name: "筛选任务" })).toBeTruthy();
  });

  it("keeps server controls in the Palot menu and destinations on the rail", async () => {
    const listProfiles = vi.spyOn(palot, "listOpenCodeProfiles").mockResolvedValue({
      activeProfileID: "local",
      profiles: [
        { id: "local", kind: "local", name: "Local OpenCode" },
        {
          id: "remote",
          kind: "remote",
          name: "Remote workstation",
          urls: ["https://host"],
          credentialID: null,
          allowPlainHttp: false,
          lastSuccessfulUrl: null,
          lastConnectedAt: null,
        },
      ],
    });
    const store = createStore();
    store.set(includedProfileIDsAtom, ["local"]);
    store.set(runtimeAtom, {
      connectionID: "connection",
      profileID: "profile",
      contractVersion: "test",
      phase: "stopped",
      connected: false,
      binaryPath: null,
      version: "0.0.0-beta-19425",
      pid: 1,
      managed: true,
      lastConnectedAt: 1,
      error: null,
      versionMismatch: null,
    });
    const { router } = renderWithRouter(
      <SidebarProvider>
        <NavigationRail navigationOpen onNavigationOpenChange={vi.fn()} />
        <WorkspaceSidebar open onNewSession={vi.fn()} onSearchTasks={vi.fn()} />
      </SidebarProvider>,
      store,
    );

    await userEvent.click(screen.getByRole("button", { name: "打开 Palot 菜单" }));
    expect(await screen.findByText("OpenCode 0.0.0-beta-19425 · 已断开")).toBeTruthy();
    const serverMenu = screen.getByRole("menuitem", { name: "服务器" });
    expect(listProfiles).not.toHaveBeenCalled();
    serverMenu.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(
      await screen.findByRole("menuitemcheckbox", { name: "Local OpenCode 已启用" }),
    ).toBeTruthy();
    const remote = screen.getByRole("menuitemcheckbox", { name: "Remote workstation 已禁用" });
    const before = router.state.location.href;
    await userEvent.click(remote);
    expect(store.get(includedProfileIDsAtom)).toEqual(["local", "remote"]);
    expect(router.state.location.href).toBe(before);
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Local OpenCode 已启用" }));
    expect(store.get(includedProfileIDsAtom)).toEqual(["remote"]);
    expect(router.state.location.href).toBe(before);
    expect(listProfiles).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{Escape}{Escape}");

    await userEvent.click(screen.getByRole("button", { name: "打开 Palot 菜单" }));
    expect(screen.getByRole("menuitem", { name: "关于" })).toBeTruthy();
    for (const moved of [/^用量/, /^工作树/, /^设置/])
      expect(screen.queryByRole("menuitem", { name: moved })).toBeTruthy();
    await userEvent.keyboard("{Escape}");

    const rail = screen.getByRole("navigation", { name: "Palot" });
    await userEvent.click(within(rail).getByRole("button", { name: "用量" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/usage"));
    expect(within(rail).getByRole("button", { name: "用量" }).getAttribute("aria-current")).toBe(
      "page",
    );

    await userEvent.click(within(rail).getByRole("button", { name: "工作树" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/worktrees"));
  });
});
