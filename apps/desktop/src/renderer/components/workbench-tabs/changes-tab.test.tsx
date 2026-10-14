import type { FileDiffInfo, OpenCodeClient } from "@opencode/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { OpenCodeRuntimeStatus } from "../../../shared";
import { runtimeAtom } from "../../atoms/workspace";
import { openCodeKeys } from "../../lib/opencode-query";
import type { WorkbenchTab } from "../../lib/workbench-tabs";
import {
  resetOpenCodeClientForTest,
  setOpenCodeClientForTest,
} from "../../services/opencode-client";
import { useTaskViewShortcuts } from "../transcript-find";
import { ChangesTab } from "./changes-tab";

const mocks = vi.hoisted(() => ({
  openTab: vi.fn(),
  diffs: {} as Record<string, unknown>,
}));
vi.mock("../../atoms/workbench", () => ({
  useWorkbenchCommands: () => ({ openTab: mocks.openTab }),
}));
vi.mock("../../hooks/use-location-diffs", () => ({
  useLocationDiffs: () => mocks.diffs,
}));
vi.mock("../../hooks/use-vcs-info", () => ({
  useVcsInfo: () => ({ data: { currentBranch: "feature" } }),
  useReviewBase: () => ({
    manual: null,
    setManual: vi.fn(),
    inferred: { data: null, isPending: false, isError: false, error: null, refetch: vi.fn() },
  }),
  useVcsBranches: () => ({ data: [], isSuccess: true }),
}));
vi.mock("../review-comment-editor", () => ({
  useReviewComments: () => ({}),
  ReviewCommentEditor: () => null,
}));
vi.mock("@pierre/trees/react", () => ({
  FileTree: () => null,
  useFileTree: () => ({ model: { resetPaths: vi.fn(), setGitStatus: vi.fn() } }),
}));
vi.mock("@pierre/diffs/react", () => ({
  CodeView: () => <div role="region" aria-label="Diff content" tabIndex={0} />,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetOpenCodeClientForTest();
  mocks.diffs = {};
});

const scope = { profileID: "profile", sessionID: "session" };
const location = { directory: "/repo" };
const runtime = {
  connectionID: "conn",
  profileID: "profile",
  connected: true,
} as OpenCodeRuntimeStatus;

function changesTab(mode: "working" | "branch"): Extract<WorkbenchTab, { kind: "changes" }> {
  return {
    id: "changes",
    kind: "changes",
    pinned: false,
    resource: { ...scope, location, mode, sourceSessionID: "session" },
  } as Extract<WorkbenchTab, { kind: "changes" }>;
}

function loadedDiffs(data: FileDiffInfo[], reviewBase: string | null = "main") {
  return {
    isPending: false,
    isSuccess: true,
    isError: false,
    isFetching: false,
    data,
    refetch: vi.fn(),
    reviewBase: {
      ref: reviewBase,
      manual: null,
      inferred: { data: null, isPending: false, isError: false, error: null, refetch: vi.fn() },
    },
  };
}

function renderWithProviders(children: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const store = createStore();
  store.set(runtimeAtom, runtime);
  const view = render(
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>{children}</Provider>
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

it("switches review scope through a pressed-toggle group", () => {
  mocks.diffs = { isPending: true, reviewBase: { ref: "main" } };
  renderWithProviders(<ChangesTab tab={changesTab("working")} pane="right" scope={scope} />);
  const group = screen.getByRole("group", { name: "审查范围" });
  const working = screen.getByRole("button", { name: "工作区", pressed: true });
  const branch = screen.getByRole("button", { name: "分支", pressed: false });
  expect(group.contains(working) && group.contains(branch)).toBe(true);

  fireEvent.click(branch);
  expect(mocks.openTab).toHaveBeenCalledWith(
    { kind: "changes", location, mode: "branch", sourceSessionID: "session" },
    { pane: "right" },
  );

  // Pressing the current scope again is not a change.
  mocks.openTab.mockClear();
  fireEvent.click(working);
  expect(mocks.openTab).not.toHaveBeenCalled();
});

it("initializes Git for a project without a repository and refreshes VCS state", async () => {
  mocks.diffs = loadedDiffs([]);
  const vcsLocation = { directory: "/repo", project: { id: "p", directory: "/repo" } };
  const get = vi
    .fn()
    .mockResolvedValueOnce({ location: vcsLocation, data: { branch: {} } })
    .mockResolvedValue({ location: vcsLocation, data: { provider: "git", branch: {} } });
  const init = vi.fn().mockResolvedValue(undefined);
  setOpenCodeClientForTest({ vcs: { get, init } } as unknown as OpenCodeClient);
  const { queryClient } = renderWithProviders(
    <ChangesTab tab={changesTab("working")} pane="right" scope={scope} />,
  );
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");

  fireEvent.click(await screen.findByRole("button", { name: "初始化 Git" }));

  await waitFor(() => expect(screen.queryByRole("button", { name: /初始化/ })).toBeNull());
  expect(init).toHaveBeenCalledWith(
    { location: { directory: "/repo" }, provider: "git" },
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(invalidate).toHaveBeenCalledWith({ queryKey: openCodeKeys.vcs("conn") });
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: openCodeKeys.diffsLocation("conn", location),
  });
  expect(get).toHaveBeenCalledTimes(2);
  expect(screen.getByText("无工作区更改")).toBeTruthy();
});

it("shows Initialize Git failures inline and allows a retry", async () => {
  mocks.diffs = loadedDiffs([], null);
  const get = vi.fn().mockResolvedValue({ location, data: { branch: {} } });
  const init = vi.fn().mockRejectedValue(new Error("Project directory does not exist"));
  setOpenCodeClientForTest({ vcs: { get, init } } as unknown as OpenCodeClient);
  renderWithProviders(<ChangesTab tab={changesTab("branch")} pane="right" scope={scope} />);

  fireEvent.click(await screen.findByRole("button", { name: "初始化 Git" }));

  expect((await screen.findByRole("alert")).textContent).toBe(
    "无法初始化 Git：Project directory does not exist",
  );
  expect(screen.getByRole("button", { name: "初始化 Git" }).hasAttribute("disabled")).toBe(
    false,
  );
});

function TranscriptHarness({ onFind }: { onFind(): void }) {
  useTaskViewShortcuts({ onFind, onTurn: () => {} });
  return (
    <div data-palot-task-view="">
      <button type="button">Transcript</button>
    </div>
  );
}

it("finds and steps through diff matches without taking the transcript's Mod+F", async () => {
  mocks.diffs = loadedDiffs([
    {
      file: "app.ts",
      status: "modified",
      additions: 1,
      deletions: 1,
      patch: [
        "--- a/app.ts",
        "+++ b/app.ts",
        "@@ -1,2 +1,2 @@",
        " const widget = 1;",
        "-useWidget(widget);",
        "+render(widget);",
      ].join("\n"),
    },
  ]);
  const transcriptFind = vi.fn();
  renderWithProviders(
    <>
      <TranscriptHarness onFind={transcriptFind} />
      <section data-workbench-pane="right">
        <ChangesTab tab={changesTab("working")} pane="right" scope={scope} />
      </section>
    </>,
  );
  const findKey = { key: "f", code: "KeyF", ctrlKey: true };

  // Mod+F in the transcript stays with Find in task.
  expect(fireEvent.keyDown(screen.getByRole("button", { name: "Transcript" }), findKey)).toBe(
    false,
  );
  expect(transcriptFind).toHaveBeenCalledOnce();
  expect(screen.queryByRole("textbox", { name: "在 diff 中查找" })).toBeNull();

  // Mod+F inside the Changes tab opens Find in diff instead.
  expect(fireEvent.keyDown(screen.getByRole("region", { name: "Diff content" }), findKey)).toBe(
    false,
  );
  expect(transcriptFind).toHaveBeenCalledOnce();
  const input = screen.getByRole("textbox", { name: "在 diff 中查找" });
  const status = () => screen.getByRole("status").textContent;

  await act(async () => {
    fireEvent.change(input, { target: { value: "widget" } });
  });
  await waitFor(() => expect(status()).toBe("第 1 项，共 4 项"));
  fireEvent.keyDown(input, { key: "Enter" });
  expect(status()).toBe("第 2 项，共 4 项");
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  expect(status()).toBe("第 4 项，共 4 项");

  await act(async () => {
    fireEvent.change(input, { target: { value: "missing" } });
  });
  await waitFor(() => expect(status()).toBe("无结果"));

  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByRole("search", { name: "在 diff 中查找" })).toBeNull();
});
