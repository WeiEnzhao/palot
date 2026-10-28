import { createStore } from "jotai";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus, PalotSession } from "../../shared";
import { inboxShelvesAtom, sidebarModeAtom, sidebarProjectOrderAtom } from "../atoms/ui";
import { overviewProjectFilterAtom, overviewProjectSectionsAtom } from "../atoms/connections";
import { runtimeAtom } from "../atoms/workspace";
import type { useConnectionOverview } from "../hooks/use-connection-overview";
import { projectSessionInbox } from "../lib/session-inbox";
import { renderWithRouter } from "../test-utils/render-with-router";
import { MultiConnectionSidebar } from "./multi-connection-sidebar";
import { palot } from "../services/palot";
import { SidebarProvider } from "./ui/sidebar";
import { installSourceControl, pullRequestLink } from "./pull-requests/test-fixtures";

const mocks = vi.hoisted(() => ({
  overview: vi.fn(),
  openSession: vi.fn().mockResolvedValue(undefined),
  preloadSession: vi.fn(),
  openNewTask: vi.fn().mockResolvedValue(undefined),
  vcs: vi.fn(() => new Map()),
}));
vi.mock("../hooks/use-connection-overview", () => ({ useConnectionOverview: mocks.overview }));
vi.mock("../hooks/use-navigation", () => ({ usePalotNavigation: () => mocks }));
vi.mock("../hooks/use-vcs-info", () => ({
  useOwnedVcsInfoMap: mocks.vcs,
  ownedVcsLocationKey: (value: unknown) => JSON.stringify(value),
}));

type Overview = ReturnType<typeof useConnectionOverview>;
function connection(id: string, count = 1): Overview["connections"][number] {
  const project = {
    id: "same-project",
    name: "Same project",
    canonical: "/repo",
    sandboxes: [],
    vcs: null,
    updatedAt: 1,
  };
  const sessions: PalotSession[] = Array.from({ length: count }, (_, i) => ({
    id: i === 0 ? "same-session" : `session-${i}`,
    parentID: null,
    projectID: project.id,
    title: i === 0 ? "Same task" : `Task ${i}`,
    agent: null,
    model: null,
    location: { directory: "/repo" },
    createdAt: 1,
    updatedAt: count - i,
    archivedAt: null,
    cost: null,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }));
  return {
    profile: {
      id,
      kind: "remote",
      name: "Same server",
      urls: [`https://${id}.example`],
      credentialID: null,
      allowPlainHttp: false,
      lastSuccessfulUrl: null,
      lastConnectedAt: null,
    },
    runtime: {
      profileID: id,
      connectionID: `connection-${id}`,
      connected: true,
      phase: "connected",
    } as OpenCodeRuntimeStatus,
    phase: "ready",
    error: null,
    lastSyncedAt: 1,
    projects: [project],
    sessions,
    inbox: projectSessionInbox({
      sessions,
      projects: [project],
      requests: new Map(),
      activeIDs: new Set(),
      runningSinceBySession: new Map(),
      triage: { profileID: id, bootstrapThrough: null, sessions: [] },
      now: 1,
    }),
    hasMore: true,
    loadingMore: false,
    triageReady: true,
    attentionState: "ready",
  };
}
let overview: Overview;
beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  Element.prototype.getAnimations = vi.fn(() => []);
  overview = {
    connections: [connection("alpha"), connection("beta")],
    includedProfileIDs: ["alpha", "beta"],
    visibleProfileIDs: null,
    setIncludedProfileIDs: vi.fn(),
    setVisibleProfileIDs: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn().mockResolvedValue(undefined),
    loadMore: vi.fn().mockResolvedValue(undefined),
    loadProject: vi.fn().mockResolvedValue(undefined),
    dispatch: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    archive: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue(undefined),
    searching: false,
  };
  mocks.overview.mockImplementation(() => overview);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function renderSidebar(mode: "inbox" | "project" = "inbox", store = createStore()) {
  store.set(sidebarModeAtom, mode);
  store.set(runtimeAtom, overview.connections[0]!.runtime);
  return renderWithRouter(
    <SidebarProvider>
      <MultiConnectionSidebar />
    </SidebarProvider>,
    store,
  );
}

describe("MultiConnectionSidebar", () => {
  it.each(["inbox", "project"] as const)(
    "keeps offline connection errors out of the %s task list without hiding cached tasks",
    (mode) => {
      const owner = overview.connections[1]!;
      owner.runtime = { ...owner.runtime!, connected: false };
      owner.phase = "error";
      owner.error = "Error invoking remote method 'palot:opencode:profile-connect'";
      renderSidebar(mode);
      expect(screen.queryByText(owner.error)).toBeNull();
      expect(screen.queryByRole("status")).toBeNull();
      expect(
        screen.getByRole("button", { name: "Same task · Same server · beta.example" }),
      ).toBeTruthy();
    },
  );

  it.each(["syncing", "error", "ready"] as const)(
    "only shows an all-clear when attention is ready (%s)",
    async (state) => {
      overview.connections = [connection("alpha", 0), connection("beta", 0)];
      for (const entry of overview.connections) entry.hasMore = false;
      overview.connections[1]!.attentionState = state;
      renderSidebar();
      if (state === "ready") {
        expect(await screen.findByText("收件箱已清空")).toBeTruthy();
      } else {
        const label = state === "syncing" ? "正在同步请求…" : "请求状态不可用";
        expect((await screen.findAllByText(label)).length).toBeGreaterThan(0);
        expect(screen.queryByText("收件箱已清空")).toBeNull();
      }
    },
  );

  it.each([
    { mode: "inbox" as const, section: "inbox" as const },
    { mode: "inbox" as const, section: "pinned" as const },
    { mode: "inbox" as const, section: "settled" as const },
    { mode: "inbox" as const, section: "snoozed" as const },
    { mode: "project" as const, section: "inbox" as const },
  ])(
    "restores the full menu and drag handle for $mode/$section with background ownership",
    async ({ mode, section }) => {
      const openWindow = vi.spyOn(palot, "openSessionWindow").mockResolvedValue(undefined);
      const owner = overview.connections[1]!;
      const item = owner.inbox.inbox.pop()!;
      owner.inbox[section].push({ ...item, section, pinnedAt: section === "pinned" ? 1 : null });
      const store = createStore();
      store.set(inboxShelvesAtom, { pinned: true, inbox: true, snoozed: true, settled: true });
      renderSidebar(mode, store);
      const row = screen.getByRole("button", { name: "Same task · Same server · beta.example" });
      expect(row.getAttribute("data-session-drag-handle")).toBe("same-session");
      fireEvent.contextMenu(row);
      for (const name of [
        "在新窗口中打开",
        "分叉",
        "从提示词分叉…",
        "安排后续任务",
        "删除任务",
      ]) {
        expect(await screen.findByRole("menuitem", { name })).toBeTruthy();
      }
      await userEvent.click(screen.getByRole("menuitem", { name: "在新窗口中打开" }));
      expect(openWindow).toHaveBeenCalledExactlyOnceWith("same-session", "connection-beta");
      expect(store.get(runtimeAtom)?.profileID).toBe("alpha");
      expect(mocks.openSession).not.toHaveBeenCalled();
      openWindow.mockRestore();
    },
  );

  it("keeps the full menu available but disables offline actions without falling back to local", async () => {
    const openWindow = vi.spyOn(palot, "openSessionWindow").mockResolvedValue(undefined);
    const owner = overview.connections[1]!;
    owner.runtime = { ...owner.runtime!, connected: false };
    owner.phase = "error";
    renderSidebar();
    fireEvent.contextMenu(
      screen.getByRole("button", { name: "Same task · Same server · beta.example" }),
    );
    const open = await screen.findByRole("menuitem", { name: "在新窗口中打开" });
    expect(open.getAttribute("aria-disabled")).toBe("true");
    await userEvent.click(open);
    expect(openWindow).not.toHaveBeenCalled();
    openWindow.mockRestore();
  });

  it("hydrates persisted projects on owner readiness and replacement, not registry rerenders", () => {
    const store = createStore();
    store.set(overviewProjectFilterAtom, JSON.stringify(["beta", "same-project"]));
    const owner = overview.connections[1]!;
    owner.phase = "loading";
    renderSidebar("inbox", store);
    expect(overview.loadProject).not.toHaveBeenCalled();
    // Any subscribed atom write rerenders the sidebar without changing its owner.
    const rerender = () =>
      act(() => {
        const shelves = store.get(inboxShelvesAtom);
        store.set(inboxShelvesAtom, { ...shelves, settled: !shelves.settled });
      });
    owner.phase = "ready";
    rerender();
    expect(overview.loadProject).toHaveBeenCalledExactlyOnceWith("beta", "same-project");
    overview.connections = overview.connections.map((connection) => ({
      ...connection,
      projects: [...connection.projects],
      runtime: connection.runtime ? { ...connection.runtime } : null,
    }));
    rerender();
    expect(overview.loadProject).toHaveBeenCalledTimes(1);
    overview.connections[1]!.runtime = {
      ...overview.connections[1]!.runtime!,
      connectionID: "replacement-beta",
    };
    rerender();
    expect(overview.loadProject).toHaveBeenCalledTimes(2);
    expect(overview.loadProject).toHaveBeenLastCalledWith("beta", "same-project");
    overview.connections[1]!.phase = "error";
    rerender();
    expect(overview.loadProject).toHaveBeenCalledTimes(2);
    overview.connections[1]!.phase = "ready";
    rerender();
    expect(overview.loadProject).toHaveBeenCalledTimes(3);
  });

  it("lets stale or unmonitored persisted projects escape through Clear filters without fetching", async () => {
    const store = createStore();
    store.set(overviewProjectFilterAtom, JSON.stringify(["beta", "same-project"]));
    overview.includedProfileIDs = ["alpha"];
    renderSidebar("inbox", store);
    expect(overview.loadProject).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "筛选任务，1 个生效" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "清除筛选" }));
    expect(store.get(overviewProjectFilterAtom)).toBeNull();
    expect(overview.loadProject).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Same task · Same server · alpha.example" }),
    ).toBeTruthy();
  });

  it("reuses the original toolbar and collapsible sections, with empty shelves hidden", async () => {
    const store = createStore();
    const projects = { [JSON.stringify(["beta", "same-project"])]: false };
    store.set(overviewProjectSectionsAtom, projects);
    renderSidebar("inbox", store);
    for (const name of [
      "筛选任务",
      "收件箱视图设置",
      "添加项目文件夹",
      "收件箱选项",
    ])
      expect(screen.getByRole("button", { name })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^置顶/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^已延后/ })).toBeNull();
    expect(screen.getByRole("button", { name: "收件箱 2" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    await userEvent.click(screen.getByRole("button", { name: "收件箱选项" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "折叠所有分区" }));
    expect(screen.getByRole("button", { name: "收件箱 2" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
    expect(
      screen.queryByRole("button", { name: "Same task · Same server · beta.example" }),
    ).toBeNull();
    expect(store.get(overviewProjectSectionsAtom)).toEqual(projects);
    await userEvent.click(screen.getByRole("button", { name: "收件箱选项" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "展开所有分区" }));
    expect(screen.getByRole("button", { name: "收件箱 2" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(store.get(overviewProjectSectionsAtom)).toEqual(projects);
  });

  it("filters owner-qualified projects, hydrates real IDs and clears visibility without monitoring", async () => {
    overview.visibleProfileIDs = ["beta"];
    renderSidebar();
    await userEvent.click(screen.getByRole("button", { name: /^筛选任务/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "项目" }));
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.click(
      screen.getByRole("option", { name: /Same project · Same server · beta.example/ }),
    );
    expect(overview.loadProject).toHaveBeenCalledWith("beta", "same-project");
    await userEvent.keyboard("{Escape}{Escape}");
    await userEvent.click(screen.getByRole("button", { name: /^筛选任务/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "清除筛选" }));
    expect(overview.setVisibleProfileIDs).toHaveBeenCalledWith(null);
    expect(overview.setIncludedProfileIDs).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "筛选任务，1 个生效" })).toBeTruthy();
  });

  it("renders settled tasks in the original compact shelf, not rich cards", async () => {
    const owner = overview.connections[1]!;
    const item = owner.inbox.inbox.pop()!;
    owner.inbox.settled.push({ ...item, section: "settled" });
    renderSidebar();
    await userEvent.click(screen.getByRole("button", { name: "已结算 1" }));
    const row = screen.getByRole("button", { name: "Same task · Same server · beta.example" });
    expect(row.closest("[data-inbox-compact-row]")).not.toBeNull();
    expect(row.closest("[data-inbox-card]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "取消结算" }));
    expect(overview.dispatch).toHaveBeenCalledWith(
      "beta",
      expect.objectContaining({ type: "inbox", sessionID: "same-session" }),
    );
  });

  it("renders grouped Inbox rows owned by the profile with title-only lines and per-group badges", () => {
    const item = overview.connections[1]!.inbox.inbox[0]!;
    item.attention = true;
    item.attentionCount = 2;
    item.canSettle = false;
    item.session.location.directory = "/remote/checkouts/feature-work";
    renderSidebar();
    const row = screen.getByRole("button", { name: "Same task · Same server · beta.example" });
    // Grouped Inbox rows are plain single-line rows: title only, no duplicate
    // project label, no rich card surface.
    expect(row.closest("[data-inbox-card]")).toBeNull();
    expect(within(row).getByText("Same task")).toBeTruthy();
    expect(within(row).queryByText("Same project")).toBeNull();
    expect(within(row).queryByText("需要输入 · 2")).toBeNull();
    expect(within(row).getByLabelText("需要关注")).toBeTruthy();
    // The project + server badge move up to the group header.
    expect(
      screen.getByRole("img", { name: "Same server · beta.example · 已连接" }),
    ).toBeTruthy();
    const wrapper = row.closest("div")!;
    expect(
      within(wrapper).getByRole("button", {
        name: "Same server · beta.example 上 Same task 的操作",
      }),
    ).toBeTruthy();
  });

  it("keeps grouped-row hover actions explicitly owned by the background profile", () => {
    renderSidebar();
    const wrapper = screen
      .getByRole("button", { name: "Same task · Same server · beta.example" })
      .closest("div")!;
    fireEvent.click(within(wrapper).getByRole("button", { name: "结算任务" }));
    expect(overview.dispatch).toHaveBeenCalledWith(
      "beta",
      expect.objectContaining({ type: "settle", sessionID: "same-session" }),
    );
  });

  it("badges tasks from one links query per local server and skips remote servers", async () => {
    const local = (id: string) => {
      const entry = connection(id);
      entry.profile = { id, kind: "local", name: `Local ${id}` } as typeof entry.profile;
      return entry;
    };
    overview.connections = [local("alpha"), local("beta"), connection("gamma")];
    overview.includedProfileIDs = ["alpha", "beta", "gamma"];
    const listPullRequestLinks = vi.fn(async (input?: { profileID?: string }) => ({
      ok: true as const,
      value:
        input?.profileID === "beta"
          ? [pullRequestLink("same-session", 21, { profileID: "beta" })]
          : [],
    }));
    installSourceControl({ listPullRequestLinks });
    renderSidebar("inbox");
    const badge = await screen.findByRole("img", {
      name: "Pull request #21, open, checks passing",
    });
    const betaRow = screen.getByRole("button", { name: "Same task · Local beta · Local" });
    expect(within(betaRow).getByRole("img", {
      name: "Pull request #21, open, checks passing",
    })).toBeTruthy();
    expect(screen.getAllByRole("img", { name: /^Pull request/ })).toHaveLength(1);
    expect(listPullRequestLinks.mock.calls.map(([input]) => input)).toEqual([
      { profileID: "alpha" },
      { profileID: "beta" },
    ]);
    Reflect.deleteProperty(window, "palot");
  });

  it("omits redundant local badges while retaining explicit row ownership", () => {
    overview.connections[0]!.profile = { id: "alpha", name: "Local", kind: "local" };
    renderSidebar();
    const localRow = screen.getByRole("button", { name: "Same task · Local · Local" });
    expect(within(localRow).queryByRole("img", { name: /Local · Local/ })).toBeNull();
    expect(screen.getByRole("img", { name: "Same server · beta.example · 已连接" })).toBeTruthy();
  });

  it("uses the original snooze choices with the clicked row owner", async () => {
    renderSidebar();
    const wrapper = screen
      .getByRole("button", { name: "Same task · Same server · beta.example" })
      .closest("div")!;
    await userEvent.click(
      within(wrapper).getByRole("button", {
        name: "Same server · beta.example 上 Same task 的操作",
      }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "暂停到" }));
    const choice = await screen.findAllByRole("menuitem", { name: "1 小时后" });
    await userEvent.click(choice.at(-1)!);
    expect(overview.dispatch).toHaveBeenCalledWith(
      "beta",
      expect.objectContaining({
        type: "snooze",
        sessionID: "same-session",
        until: expect.any(Number),
      }),
    );
  });

  it("keeps duplicate sessions distinct and routes actions to the row's owner", async () => {
    renderSidebar();
    const alpha = screen.getByRole("button", { name: "Same task · Same server · alpha.example" });
    const beta = screen.getByRole("button", { name: "Same task · Same server · beta.example" });
    fireEvent.click(alpha);
    fireEvent.click(beta);
    expect(mocks.openSession).toHaveBeenNthCalledWith(1, "same-session", { profileID: "alpha" });
    expect(mocks.openSession).toHaveBeenNthCalledWith(2, "same-session", { profileID: "beta" });
    await userEvent.click(
      screen.getByRole("button", { name: "Same server · beta.example 上 Same task 的操作" }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "置顶" }));
    expect(overview.dispatch).toHaveBeenCalledWith(
      "beta",
      expect.objectContaining({ type: "pin", sessionID: "same-session" }),
    );
  });

  it("does not merge same-named projects and sends new tasks to their profile", () => {
    renderSidebar("project");
    expect(document.querySelector("[data-inbox-card]")).toBeNull();
    expect(document.querySelector("[data-inbox-location]")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Same task · Same server · beta.example" }),
    ).toBeTruthy();
    expect(screen.getAllByText("Same project")).toHaveLength(2);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Same server · beta.example 上 Same project 的新任务",
      }),
    );
    expect(mocks.openNewTask).toHaveBeenCalledWith("same-project", "beta");
  });

  it("persists project collapse independently for duplicate IDs and restores expansion", async () => {
    const store = createStore();
    const view = renderSidebar("project", store);
    const header = (owner: string) =>
      screen.getByRole("button", {
        name: `Same project 1 · Same server · ${owner}.example`,
      });
    const task = (owner: string) =>
      screen.queryByRole("button", {
        name: `Same task · Same server · ${owner}.example`,
      });
    expect(header("alpha").getAttribute("aria-expanded")).toBe("true");
    await userEvent.click(header("alpha"));
    expect(header("alpha").getAttribute("aria-expanded")).toBe("false");
    expect(task("alpha")).toBeNull();
    expect(task("beta")).toBeTruthy();
    view.unmount();
    // Renderer persistence hydrates at module load; remounts retain the app store.
    vi.resetModules();
    const { overviewProjectSectionsAtom: reloadedSections } = await import("../atoms/connections");
    expect(createStore().get(reloadedSections)).toEqual({
      [JSON.stringify(["alpha", "same-project"])]: false,
    });
    renderSidebar("project", store);
    expect(header("alpha").getAttribute("aria-expanded")).toBe("false");
    expect(task("alpha")).toBeNull();
    expect(header("beta").getAttribute("aria-expanded")).toBe("true");
    expect(task("beta")).toBeTruthy();
    await userEvent.click(header("alpha"));
    expect(task("alpha")).toBeTruthy();
    expect(task("beta")).toBeTruthy();
  });

  it("keeps project row actions keyboard reachable while they are quiet at rest", async () => {
    renderSidebar("project");
    const row = screen.getByRole("button", { name: "Same task · Same server · beta.example" });
    // Present before any hover: the quiet actions are hidden with opacity only.
    const settle = within(row.parentElement!).getByRole("button", { name: "结算任务" });
    act(() => row.focus());
    await userEvent.tab();
    expect(document.activeElement).toBe(settle);
    await userEvent.tab();
    // 行内的「暂停」与单连接侧对齐（原来只能开 ⋯ 菜单或右键才能延后）。
    const snooze = within(row.parentElement!).getByRole("button", { name: "暂停任务" });
    expect(document.activeElement).toBe(snooze);
    await userEvent.keyboard("{Enter}");
    await userEvent.click(await screen.findByRole("menuitem", { name: /1 小时后/ }));
    expect(overview.dispatch).toHaveBeenCalledWith(
      "beta",
      expect.objectContaining({ type: "snooze", sessionID: "same-session" }),
    );
    await userEvent.tab();
    const actions = screen.getByRole("button", {
      name: "Same server · beta.example 上 Same task 的操作",
    });
    expect(document.activeElement).toBe(actions);
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByRole("menuitem", { name: "重命名" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(settle);
    expect(overview.dispatch).toHaveBeenCalledWith(
      "beta",
      expect.objectContaining({
        type: "settle",
        sessionID: "same-session",
        through: overview.connections[1]!.inbox.inbox[0]!.activityThrough,
      }),
    );
  });

  it.each([
    ["settled", "取消结算", "inbox"],
    ["snoozed", "唤醒任务", "wake"],
  ] as const)(
    "offers the %s project row's quick action to its owner",
    async (section, name, type) => {
      const owner = overview.connections[1]!;
      const item = owner.inbox.inbox.pop()!;
      owner.inbox[section].push({
        ...item,
        section,
        snoozedUntil: section === "snoozed" ? 9 : null,
      });
      renderSidebar("project");
      const row = screen.getByRole("button", { name: "Same task · Same server · beta.example" });
      expect(within(row.parentElement!).queryByRole("button", { name: "结算任务" })).toBeNull();
      await userEvent.click(within(row.parentElement!).getByRole("button", { name }));
      expect(overview.dispatch).toHaveBeenCalledWith(
        "beta",
        expect.objectContaining({ type, sessionID: "same-session" }),
      );
    },
  );

  it("keeps the project new-task action outside its trigger without changing expansion", async () => {
    renderSidebar("project");
    const trigger = screen.getByRole("button", {
      name: "Same project 1 · Same server · beta.example",
    });
    const action = screen.getByRole("button", {
      name: "Same server · beta.example 上 Same project 的新任务",
    });
    expect(trigger.contains(action)).toBe(false);
    await userEvent.click(action);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    await userEvent.click(trigger);
    await userEvent.click(action);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(mocks.openNewTask).toHaveBeenCalledTimes(2);
    expect(mocks.openNewTask).toHaveBeenLastCalledWith("same-project", "beta");
  });

  it("expands and collapses only visible project sections without changing Inbox shelves", async () => {
    overview.visibleProfileIDs = ["beta"];
    const store = createStore();
    const alphaKey = JSON.stringify(["alpha", "same-project"]);
    const betaKey = JSON.stringify(["beta", "same-project"]);
    store.set(overviewProjectSectionsAtom, { [alphaKey]: false });
    const shelves = store.get(inboxShelvesAtom);
    renderSidebar("project", store);
    const trigger = screen.getByRole("button", {
      name: "Same project 1 · Same server · beta.example",
    });
    await userEvent.click(screen.getByRole("button", { name: "收件箱选项" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "折叠所有分区" }));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(store.get(overviewProjectSectionsAtom)).toEqual({ [alphaKey]: false, [betaKey]: false });
    expect(store.get(inboxShelvesAtom)).toEqual(shelves);
    expect(
      screen.queryByRole("button", { name: "Same task · Same server · beta.example" }),
    ).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "收件箱选项" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "展开所有分区" }));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(store.get(overviewProjectSectionsAtom)).toEqual({ [alphaKey]: false, [betaKey]: true });
    expect(store.get(inboxShelvesAtom)).toEqual(shelves);
    expect(
      screen.getByRole("button", { name: "Same task · Same server · beta.example" }),
    ).toBeTruthy();
  });

  it("does not let collapsed projects consume the global mounted row budget", async () => {
    overview.connections = [connection("alpha", 65), connection("beta", 65)];
    renderSidebar("project");
    const rows = () => screen.getAllByRole("button", { name: /的操作$/ });
    expect(rows()).toHaveLength(40);
    expect(rows().every((row) => row.getAttribute("aria-label")?.includes("alpha.example"))).toBe(
      true,
    );
    const trigger = screen.getByRole("button", {
      name: "Same project 65 · Same server · alpha.example",
    });
    await userEvent.click(trigger);
    expect(rows()).toHaveLength(40);
    expect(rows().every((row) => row.getAttribute("aria-label")?.includes("beta.example"))).toBe(
      true,
    );
    await userEvent.click(trigger);
    expect(rows()).toHaveLength(40);
    expect(rows().every((row) => row.getAttribute("aria-label")?.includes("alpha.example"))).toBe(
      true,
    );
  });

  it("renames and settles a duplicate ID on its explicit owner", async () => {
    renderSidebar();
    const actionName = "Same server · beta.example 上 Same task 的操作";
    await userEvent.click(screen.getByRole("button", { name: actionName }));
    await userEvent.click(screen.getByRole("menuitem", { name: "重命名" }));
    fireEvent.change(screen.getByRole("textbox", { name: "任务标题" }), {
      target: { value: "Renamed remotely" },
    });
    await userEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(overview.rename).toHaveBeenCalledWith("beta", "same-session", "Renamed remotely");
    await userEvent.click(screen.getByRole("button", { name: actionName }));
    await userEvent.click(screen.getByRole("menuitem", { name: "结算" }));
    expect(overview.dispatch).toHaveBeenCalledWith(
      "beta",
      expect.objectContaining({
        type: "settle",
        sessionID: "same-session",
        through: overview.connections[1]!.inbox.inbox[0]!.activityThrough,
      }),
    );
  });

  it("keeps visibility independent from monitoring and honors a subset", async () => {
    overview.visibleProfileIDs = ["beta"];
    renderSidebar();
    expect(
      screen.queryByRole("button", { name: "Same task · Same server · alpha.example" }),
    ).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^筛选任务/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "服务器" }));
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "Same server · alpha.example" }),
    );
    expect(overview.setVisibleProfileIDs).toHaveBeenCalledWith(["beta", "alpha"]);
    expect(overview.setIncludedProfileIDs).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "收件箱选项" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "已启用的服务器" }));
    await userEvent.click(
      await screen.findByRole("menuitemcheckbox", { name: "启用 Same server · beta.example" }),
    );
    expect(overview.setIncludedProfileIDs).toHaveBeenCalledWith(["alpha"]);
  });

  it("disables disconnected mutations but permits retry and task navigation", async () => {
    overview.connections[1]!.runtime = null;
    overview.connections[1]!.phase = "error";
    overview.connections[1]!.error = "Network unavailable";
    renderSidebar();
    await userEvent.click(screen.getByRole("button", { name: "收件箱选项" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "已启用的服务器" }));
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "重试 Same server · beta.example" }),
    );
    expect(overview.connect).toHaveBeenCalledWith("beta");
    await userEvent.click(
      screen.getByRole("button", { name: "Same server · beta.example 上 Same task 的操作" }),
    );
    expect(screen.getByRole("menuitem", { name: "置顶" }).getAttribute("aria-disabled")).toBe(
      "true",
    );
  });

  it("holds task order under the pointer and applies a finished turn on leave", () => {
    const store = createStore();
    const owner = connection("alpha", 2);
    overview.connections = [owner];
    overview.includedProfileIDs = ["alpha"];
    const { container } = renderSidebar("inbox", store);
    const order = () =>
      screen
        .getAllByRole("button", { name: /的操作$/ })
        .map((button) => button.getAttribute("aria-label")?.split(" 上 ")[1]?.replace(" 的操作", ""));
    expect(order()).toEqual(["Same task", "Task 1"]);

    const list = container.querySelector<HTMLElement>('[data-sidebar="content"]')!;
    fireEvent.pointerEnter(list);
    const sessions = owner.sessions.map((session) =>
      session.id === "session-1" ? { ...session, updatedAt: 50, idleAt: 50 } : session,
    );
    overview.connections = [
      {
        ...owner,
        sessions,
        inbox: projectSessionInbox({
          sessions,
          projects: owner.projects,
          requests: new Map(),
          activeIDs: new Set(),
          runningSinceBySession: new Map(),
          triage: { profileID: "alpha", bootstrapThrough: null, sessions: [] },
          now: 1,
        }),
      },
    ];
    act(() =>
      store.set(inboxShelvesAtom, { pinned: true, inbox: true, snoozed: true, settled: true }),
    );
    expect(order()).toEqual(["Same task", "Task 1"]);

    fireEvent.pointerLeave(list);
    expect(order()).toEqual(["Task 1", "Same task"]);
  });

  it("bounds mounted task rows and scopes pagination to each connection", async () => {
    overview.connections = [connection("alpha", 65), connection("beta", 65)];
    renderSidebar();
    expect(
      screen.getAllByRole("button", {
        name: /的操作$/,
      }),
    ).toHaveLength(40);
    fireEvent.click(screen.getByRole("button", { name: "显示更多任务" }));
    expect(
      screen.getAllByRole("button", {
        name: /的操作$/,
      }),
    ).toHaveLength(80);
    await userEvent.click(screen.getByRole("button", { name: "收件箱选项" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "加载更早的任务" }));
    expect(overview.loadMore).toHaveBeenCalledWith("beta");
  });

  it("reorders project groups via drag-and-drop and persists the new order", () => {
    const projectA = {
      id: "project-a",
      name: "Alpha",
      canonical: "/repo-a",
      sandboxes: [],
      vcs: null,
      updatedAt: 1,
    };
    const projectB = {
      id: "project-b",
      name: "Beta",
      canonical: "/repo-b",
      sandboxes: [],
      vcs: null,
      updatedAt: 1,
    };
    const sessionA: PalotSession = {
      id: "session-a",
      parentID: null,
      projectID: projectA.id,
      title: "Task A",
      agent: null,
      model: null,
      location: { directory: "/repo-a" },
      createdAt: 1,
      updatedAt: 1,
      archivedAt: null,
      cost: null,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    };
    const sessionB: PalotSession = {
      id: "session-b",
      parentID: null,
      projectID: projectB.id,
      title: "Task B",
      agent: null,
      model: null,
      location: { directory: "/repo-b" },
      createdAt: 1,
      updatedAt: 1,
      archivedAt: null,
      cost: null,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    };
    const owner: Overview["connections"][number] = {
      profile: {
        id: "gamma",
        kind: "remote",
        name: "Server",
        urls: ["https://gamma.example"],
        credentialID: null,
        allowPlainHttp: false,
        lastSuccessfulUrl: null,
        lastConnectedAt: null,
      },
      runtime: {
        profileID: "gamma",
        connectionID: "connection-gamma",
        connected: true,
        phase: "connected",
      } as OpenCodeRuntimeStatus,
      phase: "ready",
      error: null,
      lastSyncedAt: 1,
      projects: [projectA, projectB],
      sessions: [sessionA, sessionB],
      inbox: projectSessionInbox({
        sessions: [sessionA, sessionB],
        projects: [projectA, projectB],
        requests: new Map(),
        activeIDs: new Set(),
        runningSinceBySession: new Map(),
        triage: { profileID: "gamma", bootstrapThrough: null, sessions: [] },
        now: 1,
      }),
      hasMore: false,
      loadingMore: false,
      triageReady: true,
      attentionState: "ready",
    };
    overview.connections = [owner];
    overview.includedProfileIDs = ["gamma"];
    const store = createStore();
    renderSidebar("project", store);
    const headers = () =>
      document.querySelectorAll<HTMLElement>("[data-project-section]");
    expect(headers()).toHaveLength(2);
    expect(headers()[0]!.getAttribute("data-project-id")).toBe("project-a");
    expect(headers()[1]!.getAttribute("data-project-id")).toBe("project-b");
    const dragSource = screen.getByLabelText("拖动排序：Beta");
    const dropTarget = screen.getByLabelText("拖动排序：Alpha");
    act(() => {
      fireEvent.dragStart(dragSource, { dataTransfer: new DataTransfer() });
      fireEvent.dragOver(dropTarget, { clientY: -1, dataTransfer: new DataTransfer() });
      fireEvent.drop(dropTarget, { clientY: -1, dataTransfer: new DataTransfer() });
      fireEvent.dragEnd(dragSource, { dataTransfer: new DataTransfer() });
    });
    const updated = headers();
    expect(updated[0]!.getAttribute("data-project-id")).toBe("project-b");
    expect(updated[1]!.getAttribute("data-project-id")).toBe("project-a");
    const keyA = JSON.stringify(["gamma", "project-a"]);
    const keyB = JSON.stringify(["gamma", "project-b"]);
    expect(store.get(sidebarProjectOrderAtom)).toEqual([keyB, keyA]);
  });
});
