import type { OpenCodeClient } from "@opencode/client";
import { Provider, createStore } from "jotai";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus, PalotSession } from "../../shared";
import { sessionTriageSnapshotAtom } from "../atoms/inbox";
import { inboxFiltersAtom, inboxViewPreferencesAtom } from "../atoms/ui";
import { runtimeAtom } from "../atoms/workspace";
import { createRendererQueryClient } from "../lib/query-client";
import { openCodeReconciler } from "../lib/open-code-reconciler";
import { openCodeKeys } from "../lib/opencode-query";
import { resetOpenCodeClientForTest, setOpenCodeClientForTest } from "../services/opencode-client";
import { palot } from "../services/palot";
import { renderWithRouter, seedCatalog } from "../test-utils/render-with-router";
import { InboxSidebarContent } from "./inbox-sidebar";
import { installSourceControl, pullRequestLink } from "./pull-requests/test-fixtures";
import { SidebarProvider } from "./ui/sidebar";
import { toast } from "./ui/toast";

const navigation = vi.hoisted(() => ({
  openSession: vi.fn(),
  preloadSession: vi.fn(),
}));
const overview = vi.hoisted(() => ({
  connections: [] as {
    profile: { id: string; name: string; kind: string };
    runtime: OpenCodeRuntimeStatus;
  }[],
  includedProfileIDs: [] as string[],
}));
vi.mock("../hooks/use-connection-overview", () => ({ useConnectionOverview: () => overview }));

vi.mock("../hooks/use-navigation", () => ({
  usePalotNavigation: () => navigation,
}));

const session = (id: string, title: string, updatedAt: number): PalotSession => ({
  id,
  parentID: null,
  projectID: "project-1",
  title,
  agent: null,
  model: null,
  location: { directory: `/repo/${id}` },
  createdAt: updatedAt,
  updatedAt,
  archivedAt: null,
  cost: null,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
});

function markUnread(
  queryClient: ReturnType<typeof createRendererQueryClient>,
  value: PalotSession,
  connectionID = "disconnected",
) {
  openCodeReconciler(queryClient).patchSession(connectionID, value.id, (session) => ({
    ...session,
    time: { created: value.createdAt, updated: value.updatedAt, idle: 10, viewed: 5 },
  }));
}

beforeEach(() => {
  overview.connections = [];
  overview.includedProfileIDs = [];
  window.localStorage.clear();
  Element.prototype.getAnimations = vi.fn(() => []);
  Object.defineProperty(window, "palot", {
    configurable: true,
    value: {
      runtimeStatus: vi.fn(),
      onOpenTargetRequested: vi.fn(() => () => undefined),
      onOpenCodeEvents: vi.fn(() => () => undefined),
      openCodeRequest: vi.fn().mockRejectedValue(new Error("VCS unavailable in this test")),
      showAttentionNotification: vi.fn(),
    },
  });
  navigation.openSession.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetOpenCodeClientForTest();
  Reflect.deleteProperty(window, "palot");
});

describe("InboxSidebarContent", () => {
  it("keeps folder creation on the original connection while a native picker is open", async () => {
    const store = createStore();
    const runtime: OpenCodeRuntimeStatus = {
      connectionID: "connection-original",
      profileID: "profile-original",
      contractVersion: "test",
      phase: "connected",
      connected: true,
      binaryPath: null,
      version: null,
      pid: null,
      managed: false,
      lastConnectedAt: null,
      error: null,
      versionMismatch: null,
    };
    store.set(runtimeAtom, runtime);
    overview.connections = [
      { profile: { id: runtime.profileID, name: "Original", kind: "local" }, runtime },
    ];
    overview.includedProfileIDs = [runtime.profileID];
    let finishPick: (directory: string) => void = () => undefined;
    const pick = vi.spyOn(palot, "pickDirectory").mockImplementation(
      () =>
        new Promise((resolve) => {
          finishPick = resolve;
        }),
    );
    const created = session("created", "Created task", 10);
    const create = vi.spyOn(palot, "createSession").mockResolvedValue(created);
    renderWithRouter(
      <SidebarProvider>
        <InboxSidebarContent />
      </SidebarProvider>,
      store,
    );
    fireEvent.click(screen.getByRole("button", { name: "添加项目文件夹" }));
    fireEvent.click(screen.getByRole("button", { name: "选择本地文件夹…" }));
    expect(pick).toHaveBeenCalledWith("connection-original");
    store.set(runtimeAtom, {
      ...runtime,
      connectionID: "connection-other",
      profileID: "profile-other",
    });
    finishPick("/original/folder");
    await waitFor(() =>
      expect((screen.getByLabelText("文件夹路径") as HTMLInputElement).value).toBe(
        "/original/folder",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "添加项目" }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith("/original/folder", undefined, "connection-original"),
    );
    await waitFor(() =>
      expect(navigation.openSession).toHaveBeenCalledWith("created", {
        profileID: "profile-original",
      }),
    );
  });

  it("clears an optimistic selection when navigation finishes without changing routes", async () => {
    let finishNavigation: (() => void) | undefined;
    navigation.openSession.mockReturnValue(
      new Promise<void>((resolve) => {
        finishNavigation = resolve;
      }),
    );
    const store = createStore();
    const queryClient = createRendererQueryClient();
    const item = session("inbox", "Inbox task", 120);
    seedCatalog(queryClient, {
      projects: [
        {
          id: "project-1",
          canonical: "/repo",
          name: "Palot",
          sandboxes: [],
          vcs: null,
          updatedAt: 1,
        },
      ],
      sessions: [item],
    });
    store.set(sessionTriageSnapshotAtom, {
      profileID: "local-default",
      bootstrapThrough: null,
      sessions: [],
    });

    renderWithRouter(
      <Provider store={store}>
        <SidebarProvider>
          <InboxSidebarContent />
        </SidebarProvider>
      </Provider>,
      store,
      "/new",
      queryClient,
    );

    const button = screen.getByRole("button", { name: /^Open Inbox task,/ });
    fireEvent.click(button);
    await vi.waitFor(() => expect(navigation.openSession).toHaveBeenCalledWith("inbox"));
    expect(button.closest("[data-inbox-card]")?.getAttribute("data-selected")).toBe("true");

    finishNavigation?.();
    await vi.waitFor(() =>
      expect(button.closest("[data-inbox-card]")?.getAttribute("data-selected")).toBeNull(),
    );
  });

  it("badges linked tasks from one pull request links query for the whole list", async () => {
    const store = createStore();
    const queryClient = createRendererQueryClient();
    store.set(runtimeAtom, {
      connectionID: "disconnected",
      profileID: "profile",
      connected: false,
    } as OpenCodeRuntimeStatus);
    seedCatalog(queryClient, {
      projects: [
        {
          id: "project-1",
          canonical: "/repo",
          name: "Palot",
          sandboxes: [],
          vcs: null,
          updatedAt: 1,
        },
      ],
      sessions: [
        session("open", "Open task", 30),
        session("merged", "Merged task", 20),
        session("plain", "Plain task", 10),
      ],
    });
    const { api } = installSourceControl({
      listPullRequestLinks: vi.fn(async () => ({
        ok: true as const,
        value: [
          pullRequestLink("open", 4, {
            watch: { startedAt: 1, commentWakes: 0, readFailures: 0, lastWakeAt: null },
            pullRequest: { checks: "pending" },
          }),
          pullRequestLink("merged", 9, { pullRequest: { state: "merged" } }),
        ],
      })),
    });
    renderWithRouter(
      <SidebarProvider>
        <InboxSidebarContent />
      </SidebarProvider>,
      store,
      "/new",
      queryClient,
    );
    expect(
      await screen.findByRole("img", { name: "Pull request #4, open, checks running, watching" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("img", { name: "Pull request #9, merged, checks passing" }),
    ).toBeTruthy();
    const plain = screen
      .getByRole("button", { name: /^Open Plain task,/ })
      .closest("[data-inbox-card]");
    expect(plain?.querySelector("[data-pull-request-badge]")).toBeNull();
    expect(api.listPullRequestLinks).toHaveBeenCalledTimes(1);
    expect(api.listPullRequestLinks).toHaveBeenCalledWith({ profileID: "profile" });

    fireEvent.click(screen.getByRole("img", { name: /Pull request #4/ }));
    await waitFor(() => expect(navigation.openSession).toHaveBeenCalledWith("open"));
  });

  it("holds the task order while the pointer is over the list", async () => {
    const store = createStore();
    const queryClient = createRendererQueryClient();
    seedCatalog(queryClient, {
      projects: [
        {
          id: "project-1",
          canonical: "/repo",
          name: "Palot",
          sandboxes: [],
          vcs: null,
          updatedAt: 1,
        },
      ],
      sessions: [session("older", "Older task", 10), session("newer", "Newer task", 20)],
    });
    store.set(sessionTriageSnapshotAtom, {
      profileID: "local-default",
      bootstrapThrough: null,
      sessions: [],
    });
    const { container } = renderWithRouter(
      <Provider store={store}>
        <SidebarProvider>
          <InboxSidebarContent />
        </SidebarProvider>
      </Provider>,
      store,
      "/new",
      queryClient,
    );
    const order = () =>
      screen
        .getAllByRole("button", { name: /^Open .* task,/ })
        .map((button) => button.getAttribute("aria-label")?.split(",")[0]);
    expect(order()).toEqual(["Open Newer task", "Open Older task"]);

    const list = container.querySelector<HTMLElement>('[data-sidebar="content"]')!;
    fireEvent.pointerEnter(list);
    openCodeReconciler(queryClient).patchSession("disconnected", "older", (current) => ({
      ...current,
      title: "Finished task",
      time: { ...current.time, updated: 50, idle: 50 },
    }));
    await waitFor(() => expect(order()).toEqual(["Open Newer task", "Open Finished task"]));

    fireEvent.pointerLeave(list);
    await waitFor(() => expect(order()).toEqual(["Open Finished task", "Open Newer task"]));
  });

  it("does not show unread activity for the selected session", async () => {
    navigation.openSession.mockImplementation(() => new Promise(() => {}));
    const store = createStore();
    const queryClient = createRendererQueryClient();
    const item = session("inbox", "Inbox task", 120);
    seedCatalog(queryClient, {
      projects: [
        {
          id: "project-1",
          canonical: "/repo",
          name: "Palot",
          sandboxes: [],
          vcs: null,
          updatedAt: 1,
        },
      ],
      sessions: [item],
    });
    markUnread(queryClient, item);

    renderWithRouter(
      <Provider store={store}>
        <SidebarProvider>
          <InboxSidebarContent />
        </SidebarProvider>
      </Provider>,
      store,
      "/new",
      queryClient,
    );

    const button = screen.getByRole("button", { name: /^Open Inbox task,/ });
    const card = button.closest("[data-inbox-card]");
    expect(card).toBeTruthy();
    fireEvent.click(button);
    await vi.waitFor(() =>
      expect(within(card as HTMLElement).queryByLabelText("未读任务动态")).toBeNull(),
    );
  });

  it("renders collapsible active sections and compact shelves", async () => {
    const store = createStore();
    const queryClient = createRendererQueryClient();
    const pinned = session("pinned", "Pinned task", 10);
    const running = session("inbox", "Inbox task", 120);
    seedCatalog(queryClient, {
      projects: [
        {
          id: "project-1",
          canonical: "/repo",
          name: "Palot",
          sandboxes: [],
          vcs: null,
          updatedAt: 1,
        },
        {
          id: "project-2",
          canonical: "/other",
          name: "Other",
          sandboxes: [],
          vcs: null,
          updatedAt: 1,
        },
      ],
      sessions: [
        pinned,
        running,
        session("snoozed", "Snoozed task", 10),
        session("settled", "Settled task", 10),
      ],
    });
    markUnread(queryClient, pinned);
    markUnread(queryClient, running);
    openCodeReconciler(queryClient).replaceActivity("disconnected", {
      activeIDs: new Set(["inbox"]),
      execution: new Map([
        [
          "inbox",
          {
            status: "running" as const,
            startedAt: Date.now() - 5_000,
            completedAt: null,
          },
        ],
      ]),
      statuses: new Map(),
    });
    store.set(sessionTriageSnapshotAtom, {
      profileID: "local-default",
      bootstrapThrough: { updatedAt: 100, sessionID: "z" },
      sessions: [
        {
          sessionID: "pinned",
          disposition: "inbox",
          settledThrough: null,
          pinnedAt: 110,
          snoozedUntil: null,
          snoozedThrough: null,
          updatedAt: 110,
        },
        {
          sessionID: "snoozed",
          disposition: "inbox",
          settledThrough: null,
          pinnedAt: null,
          snoozedUntil: Date.now() + 60_000,
          snoozedThrough: { updatedAt: 10, sessionID: "snoozed" },
          updatedAt: 100,
        },
        {
          sessionID: "settled",
          disposition: "settled",
          settledThrough: { updatedAt: 100, sessionID: "settled" },
          pinnedAt: null,
          snoozedUntil: null,
          snoozedThrough: null,
          updatedAt: 100,
        },
      ],
    });

    renderWithRouter(
      <Provider store={store}>
        <SidebarProvider>
          <InboxSidebarContent />
        </SidebarProvider>
      </Provider>,
      store,
      "/new",
      queryClient,
    );

    expect(screen.getByRole("button", { name: /^Open Pinned task,/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Open Inbox task,/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "取消置顶任务" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "结算任务" })).toHaveLength(1);
    expect(screen.getByTitle(/Working for/)).toBeTruthy();
    expect(screen.getByText(/^New · /)).toBeTruthy();
    const pinnedCard = screen
      .getByRole("button", { name: /^Open Pinned task,/ })
      .closest<HTMLElement>("[data-inbox-card]")!;
    const runningCard = screen
      .getByRole("button", { name: /^Open Inbox task,/ })
      .closest<HTMLElement>("[data-inbox-card]")!;
    expect(within(pinnedCard).getByLabelText("未读任务动态")).toBeTruthy();
    // Grouped shelves carry the project name on the folder header, not on each card.
    expect(within(pinnedCard).queryByText("Palot")).toBeNull();
    expect(screen.getAllByText("Palot").length).toBeGreaterThan(0);
    expect(within(pinnedCard).getByText("pinned")).toBeTruthy();
    // Grouped rows are single-line: the status glyph sits inline with the title.
    expect(
      within(pinnedCard).getByText("Pinned task").parentElement?.parentElement?.querySelector(
        "[aria-label]",
      ),
    ).not.toBeNull();
    expect(within(runningCard).queryByLabelText("未读任务动态")).toBeNull();
    expect(within(runningCard).getByTitle(/Working for/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "添加项目文件夹" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "收件箱视图设置" }));
    expect(await screen.findByText("排序")).toBeTruthy();
    expect(screen.getByRole("combobox").textContent).toContain("最新");
    expect(screen.getByRole("switch", { name: "未读优先" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "显示已延后" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "显示已结算" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    store.set(inboxViewPreferencesAtom, {
      ordering: "newest",
      unreadFirst: false,
      showSnoozed: true,
      showSettled: false,
    });
    await waitFor(() => expect(screen.queryByRole("button", { name: /已结算/ })).toBeNull());
    store.set(inboxViewPreferencesAtom, {
      ordering: "newest",
      unreadFirst: false,
      showSnoozed: true,
      showSettled: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "筛选任务" }));
    expect(await screen.findByText("添加筛选…")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "项目" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "状态" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    store.set(inboxFiltersAtom, { projectID: null, states: ["running"] });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /^Open Pinned task,/ })).toBeNull(),
    );
    expect(screen.getByRole("button", { name: /^Open Inbox task,/ })).toBeTruthy();
    store.set(inboxFiltersAtom, { projectID: null, states: [] });
    fireEvent.click(screen.getByRole("button", { name: "收件箱选项" }));
    expect(
      await screen.findByRole("menuitem", { name: /所有任务已加载|加载更早的任务/ }),
    ).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "展开所有分区" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "折叠所有分区" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: /^置顶 1$/ }));
    expect(screen.queryByRole("button", { name: /^Open Pinned task,/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^收件箱 1$/ }));
    expect(screen.queryByRole("button", { name: /^Open Inbox task,/ })).toBeNull();
    expect(screen.getByRole("button", { name: /已延后/ }).textContent).toContain("1");
    expect(screen.getByRole("button", { name: /已结算/ }).textContent).toContain("1");
    expect(screen.queryByText("Snoozed task")).toBeNull();
    expect(screen.queryByText("Settled task")).toBeNull();
  });

  it("shows the worktree name when the checkout has a detached HEAD", async () => {
    const getVcs = vi.fn().mockResolvedValue({
      data: { branch: { current: null, default: "main" } },
    });
    setOpenCodeClientForTest({
      vcs: {
        get: getVcs,
      },
    } as unknown as OpenCodeClient);
    const store = createStore();
    store.set(runtimeAtom, {
      connectionID: "connection-1",
      profileID: "local-default",
      contractVersion: "0.0.0-beta-19425",
      phase: "connected",
      connected: true,
      binaryPath: null,
      version: "0.0.0-beta-19425",
      pid: 1,
      managed: false,
      lastConnectedAt: 1,
      error: null,
      versionMismatch: null,
    });
    const queryClient = createRendererQueryClient();
    seedCatalog(
      queryClient,
      {
        projects: [
          {
            id: "project-1",
            canonical: "/repo",
            name: "Palot",
            sandboxes: [],
            vcs: null,
            updatedAt: 1,
          },
        ],
        sessions: [
          {
            ...session("worktree", "Worktree task", 120),
            location: { directory: "/data/opencode/worktree/projec/quiet-river" },
          },
        ],
      },
      "connection-1",
    );
    store.set(sessionTriageSnapshotAtom, {
      profileID: "local-default",
      bootstrapThrough: null,
      sessions: [],
    });

    renderWithRouter(
      <Provider store={store}>
        <SidebarProvider>
          <InboxSidebarContent />
        </SidebarProvider>
      </Provider>,
      store,
      "/new",
      queryClient,
    );

    await waitFor(() => expect(getVcs).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(
        queryClient.getQueryData(
          openCodeKeys.vcsLocation("connection-1", {
            directory: "/data/opencode/worktree/projec/quiet-river",
          }),
        ),
      ).toEqual({ currentBranch: null, defaultBranch: "main" }),
    );
    const label = await screen.findByTitle("/data/opencode/worktree/projec/quiet-river");
    expect(label.textContent).toBe("quiet-river");
    expect(screen.queryByText("Detached HEAD")).toBeNull();
  });

  it("offers shared context-menu actions for compact shelves", async () => {
    const store = createStore();
    const queryClient = createRendererQueryClient();
    const snoozed = session("snoozed", "Snoozed task", 10);
    const settled = session("settled", "Settled task", 10);
    seedCatalog(queryClient, {
      projects: [
        {
          id: "project-1",
          canonical: "/repo",
          name: "Palot",
          sandboxes: [],
          vcs: null,
          updatedAt: 1,
        },
      ],
      sessions: [snoozed, settled],
    });
    markUnread(queryClient, snoozed);
    markUnread(queryClient, settled);
    store.set(sessionTriageSnapshotAtom, {
      profileID: "local-default",
      bootstrapThrough: { updatedAt: 100, sessionID: "z" },
      sessions: [
        {
          sessionID: "snoozed",
          disposition: "inbox",
          settledThrough: null,
          pinnedAt: null,
          snoozedUntil: Date.now() + 60_000,
          snoozedThrough: { updatedAt: 10, sessionID: "snoozed" },
          updatedAt: 100,
        },
      ],
    });

    renderWithRouter(
      <Provider store={store}>
        <SidebarProvider>
          <InboxSidebarContent />
        </SidebarProvider>
      </Provider>,
      store,
      "/new",
      queryClient,
    );

    fireEvent.click(screen.getByRole("button", { name: /^已延后 1$/ }));
    fireEvent.contextMenu(screen.getByRole("button", { name: /Snoozed task/ }));

    expect(await screen.findByRole("menuitem", { name: "置顶" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "唤醒" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "移到工作树" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "结算" })).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: /^已结算 1$/ }));
    expect(
      within(
        screen
          .getByRole("button", { name: /Settled task/ })
          .closest<HTMLElement>("[data-inbox-compact-row]")!,
      ).queryByLabelText("未读任务动态"),
    ).toBeNull();
    fireEvent.contextMenu(screen.getByRole("button", { name: /Settled task/ }));

    expect(await screen.findByRole("menuitem", { name: "置顶" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "取消结算" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "移到工作树" })).toBeTruthy();
  });
  it.each([
    { shelf: "已延后", title: "Snoozed task", action: "唤醒任务", type: "wake", undo: "snooze" },
    {
      shelf: "已结算",
      title: "Settled task",
      action: "取消结算任务",
      type: "inbox",
      undo: "settle",
    },
  ] as const)(
    "reaches the $shelf shelf's $action by keyboard and offers Undo",
    async ({ shelf, title, action, type, undo }) => {
      const addToast = vi.spyOn(toast, "add");
      const store = createStore();
      const dispatchSessionTriage = vi.fn(async () => store.get(sessionTriageSnapshotAtom)!);
      Object.assign(window.palot, { dispatchSessionTriage });
      store.set(runtimeAtom, {
        connectionID: "disconnected",
        profileID: "local-default",
        contractVersion: "test",
        phase: "connected",
        connected: true,
        binaryPath: null,
        version: null,
        pid: null,
        managed: false,
        lastConnectedAt: 1,
        error: null,
        versionMismatch: null,
      });
      const queryClient = createRendererQueryClient();
      const snoozedUntil = Date.now() + 60_000;
      seedCatalog(queryClient, {
        projects: [
          {
            id: "project-1",
            canonical: "/repo",
            name: "Palot",
            sandboxes: [],
            vcs: null,
            updatedAt: 1,
          },
        ],
        sessions: [session("snoozed", "Snoozed task", 10), session("settled", "Settled task", 10)],
      });
      store.set(sessionTriageSnapshotAtom, {
        profileID: "local-default",
        bootstrapThrough: { updatedAt: 100, sessionID: "z" },
        sessions: [
          {
            sessionID: "snoozed",
            disposition: "inbox",
            settledThrough: null,
            pinnedAt: null,
            snoozedUntil,
            snoozedThrough: { updatedAt: 10, sessionID: "snoozed" },
            updatedAt: 100,
          },
        ],
      });
      renderWithRouter(
        <Provider store={store}>
          <SidebarProvider>
            <InboxSidebarContent />
          </SidebarProvider>
        </Provider>,
        store,
        "/new",
        queryClient,
      );
      fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${shelf} 1$`) }));
      const row = screen
        .getByRole("button", { name: new RegExp(title) })
        .closest<HTMLElement>("[data-inbox-compact-row]")!;
      act(() =>
        within(row)
          .getByRole("button", { name: new RegExp(title) })
          .focus(),
      );
      await userEvent.tab();
      expect(document.activeElement).toBe(within(row).getByRole("button", { name: action }));
      await userEvent.keyboard("{Enter}");
      const id = title === "Snoozed task" ? "snoozed" : "settled";
      await waitFor(() =>
        expect(dispatchSessionTriage).toHaveBeenCalledWith(
          expect.objectContaining({ type, sessionID: id }),
        ),
      );
      await waitFor(() => expect(addToast).toHaveBeenCalled());
      const onClick = addToast.mock.calls.at(-1)![0].actionProps!.onClick as () => void;
      act(() => onClick());
      await waitFor(() =>
        expect(dispatchSessionTriage).toHaveBeenLastCalledWith(
          expect.objectContaining({
            type: undo,
            sessionID: id,
            ...(undo === "snooze" ? { until: snoozedUntil } : {}),
          }),
        ),
      );
    },
  );
});
