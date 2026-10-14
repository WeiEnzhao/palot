import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, expect, it, vi } from "vitest";
import type { PullRequestDetail } from "../../../../shared/source-control-contract";
import { PullRequestCodeTab } from "./pull-request-code-tab";
import {
  installCodeTabApi,
  prFile,
  pullRequestDetail,
  reviewThread,
  selectLines,
} from "./test-support";

vi.mock("@pierre/diffs/react", async () => ({
  CodeView: (await import("./test-support")).FakeCodeView,
}));
vi.mock("../../markdown-content", () => ({
  MarkdownContent: ({ value }: { value: string }) => <div>{value}</div>,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderTab(pullRequest: PullRequestDetail = pullRequestDetail()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Provider store={createStore()}>
        <PullRequestCodeTab pullRequest={pullRequest} />
      </Provider>
    </QueryClientProvider>,
  );
}

const diffSection = (path: string) => screen.getByRole("region", { name: `Diff ${path}` });

it("marks files viewed from the list, counts them, folds them, and hides them on request", async () => {
  const api = installCodeTabApi({
    files: [
      prFile("src/a.ts"),
      prFile("src/b.ts", { viewed: "viewed" }),
      prFile("src/c.ts", { viewed: "dismissed" }),
    ],
  });
  renderTab();

  expect(await screen.findByText("1 / 3 已查看")).toBeTruthy();
  // A file viewed before GitHub saw it change again says so and counts as unviewed.
  expect(within(diffSection("src/c.ts")).getByText("自上次查看以来已变更")).toBeTruthy();
  expect(diffSection("src/b.ts").dataset.collapsed).toBe("true");
  expect(diffSection("src/a.ts").dataset.collapsed).toBe("false");

  const list = screen.getByRole("list", { name: "已更改的文件" });
  fireEvent.click(within(list).getByRole("checkbox", { name: "已查看 src/a.ts" }));

  await waitFor(() => expect(screen.getByText("2 / 3 已查看")).toBeTruthy());
  expect(api.setPullRequestFileViewed).toHaveBeenCalledWith({
    host: "github.com",
    repository: "acme/web",
    number: 7,
    path: "src/a.ts",
    viewed: true,
  });
  expect(diffSection("src/a.ts").dataset.collapsed).toBe("true");

  fireEvent.click(screen.getByRole("button", { name: "隐藏已查看", pressed: false }));
  expect(screen.queryByRole("region", { name: "Diff src/a.ts" })).toBeNull();
  expect(screen.queryByRole("region", { name: "Diff src/b.ts" })).toBeNull();
  expect(diffSection("src/c.ts")).toBeTruthy();
  expect(within(list).queryByRole("checkbox", { name: "已查看 src/a.ts" })).toBeNull();
});

it("explains files GitHub sent no patch for and links to the PR's files on GitHub", async () => {
  installCodeTabApi({
    files: [prFile("assets/logo.png", { patch: null, status: "added" }), prFile("src/a.ts")],
  });
  renderTab();

  const section = await screen.findByRole("region", { name: "Diff assets/logo.png" });
  expect(within(section).getByText("此处无法查看 diff")).toBeTruthy();
  expect(within(section).getByRole("link", { name: "在 GitHub 上打开" }).getAttribute("href")).toBe(
    "https://github.com/acme/web/pull/7/files",
  );
});

it("turns a selected line into a pending comment shown on its line and in the tray", async () => {
  installCodeTabApi({ files: [prFile("src/a.ts")] });
  renderTab();
  await screen.findByRole("region", { name: "Diff src/a.ts" });

  selectLines("src/a.ts", { start: 2, end: 2, side: "additions", endSide: "additions" });
  const editor = screen.getByRole("form", { name: "对 src/a.ts 的评论" });
  fireEvent.change(within(editor).getByRole("textbox", { name: "行评论" }), {
    target: { value: "Rename this" },
  });
  fireEvent.click(within(editor).getByRole("button", { name: "添加评论" }));

  expect(screen.queryByRole("form", { name: "对 src/a.ts 的评论" })).toBeNull();
  const pending = within(diffSection("src/a.ts")).getByRole("article", { name: "待审评论" });
  expect(within(pending).getByText("Rename this")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "1 条待审评论" }));
  const tray = await screen.findByRole("list", { name: "待审评论" });
  expect(within(tray).getByText("src/a.ts · line 2")).toBeTruthy();
  fireEvent.click(within(tray).getByRole("button", { name: "移除评论 src/a.ts line 2" }));
  await waitFor(() =>
    expect(
      within(diffSection("src/a.ts")).queryByRole("article", { name: "待审评论" }),
    ).toBeNull(),
  );
});

it("submits the review with mapped comments and the head commit, then clears the tray", async () => {
  const api = installCodeTabApi({ files: [prFile("src/a.ts")] });
  renderTab();
  await screen.findByRole("region", { name: "Diff src/a.ts" });

  // An old-side range: GitHub wants the last line, the first line, and LEFT.
  selectLines("src/a.ts", { start: 3, end: 2, side: "deletions", endSide: "deletions" });
  fireEvent.change(screen.getByRole("textbox", { name: "行评论" }), {
    target: { value: "Why remove these?" },
  });
  fireEvent.click(screen.getByRole("button", { name: "添加评论" }));

  fireEvent.click(screen.getByRole("button", { name: /^评审/ }));
  const form = await screen.findByRole("form", { name: "提交评审" });
  fireEvent.change(within(form).getByRole("textbox", { name: "评审摘要" }), {
    target: { value: "A few questions" },
  });
  fireEvent.click(within(form).getByRole("button", { name: "评论" }));

  await waitFor(() => expect(api.submitPullRequestReview).toHaveBeenCalledTimes(1));
  expect(api.submitPullRequestReview).toHaveBeenCalledWith({
    host: "github.com",
    repository: "acme/web",
    number: 7,
    event: "comment",
    body: "A few questions",
    comments: [
      { path: "src/a.ts", line: 3, startLine: 2, side: "LEFT", body: "Why remove these?" },
    ],
    commitOid: "head123",
  });
  await waitFor(() => expect(screen.queryByRole("button", { name: /待审评论/ })).toBeNull());
  expect(
    within(diffSection("src/a.ts")).queryByRole("article", { name: "待审评论" }),
  ).toBeNull();
});

it("keeps the pending review and shows GitHub's message when submitting fails", async () => {
  installCodeTabApi(
    { files: [prFile("src/a.ts")] },
    {
      submitPullRequestReview: async () => ({
        ok: false,
        error: { code: "github-unavailable", message: "GitHub is unavailable." },
      }),
    },
  );
  renderTab();
  await screen.findByRole("region", { name: "Diff src/a.ts" });
  selectLines("src/a.ts", { start: 2, end: 2, side: "additions", endSide: "additions" });
  fireEvent.change(screen.getByRole("textbox", { name: "行评论" }), {
    target: { value: "Nit" },
  });
  fireEvent.click(screen.getByRole("button", { name: "添加评论" }));

  fireEvent.click(screen.getByRole("button", { name: /^评审/ }));
  const form = await screen.findByRole("form", { name: "提交评审" });
  fireEvent.click(within(form).getByRole("button", { name: "评论" }));

  expect((await within(form).findByRole("alert")).textContent).toBe("GitHub is unavailable.");
  expect(screen.getByRole("button", { name: "1 条待审评论" })).toBeTruthy();
});

it("lets authors only comment, and asks for a summary before requesting changes", async () => {
  installCodeTabApi({ files: [prFile("src/a.ts")] });
  const view = renderTab(
    pullRequestDetail({
      viewer: {
        login: "octocat",
        canMerge: true,
        canUpdate: true,
        isAuthor: true,
        reviewState: null,
      },
    }),
  );
  await screen.findByRole("region", { name: "Diff src/a.ts" });
  fireEvent.click(screen.getByRole("button", { name: /^评审/ }));
  let form = await screen.findByRole("form", { name: "提交评审" });
  expect(within(form).getByRole("button", { name: "批准" }).hasAttribute("disabled")).toBe(true);
  view.unmount();

  installCodeTabApi({ files: [prFile("src/a.ts")] });
  renderTab();
  await screen.findByRole("region", { name: "Diff src/a.ts" });
  fireEvent.click(screen.getByRole("button", { name: /^评审/ }));
  form = await screen.findByRole("form", { name: "提交评审" });
  const requestChanges = within(form).getByRole("button", { name: "请求更改" });
  expect(within(form).getByRole("button", { name: "批准" }).hasAttribute("disabled")).toBe(
    false,
  );
  expect(requestChanges.hasAttribute("disabled")).toBe(true);
  fireEvent.change(within(form).getByRole("textbox", { name: "评审摘要" }), {
    target: { value: "Please split this" },
  });
  expect(requestChanges.hasAttribute("disabled")).toBe(false);
});

it("shows current review threads on their lines and dims resolved ones", async () => {
  installCodeTabApi({
    files: [prFile("src/a.ts")],
    timeline: [
      reviewThread("t1", { body: "Should this be async?", author: "alice" }),
      reviewThread("t2", { body: "Fixed", author: "bob", line: 1, isResolved: true }),
      reviewThread("t3", { body: "Old remark", author: "carol", isOutdated: true }),
      // Not drawn by any hunk on that side, so it has no row to sit on.
      reviewThread("t4", { body: "Far away", author: "dave", line: 40 }),
    ],
  });
  renderTab();

  const section = await screen.findByRole("region", { name: "Diff src/a.ts" });
  const thread = await within(section).findByRole("article", { name: "评审线程，来自 alice" });
  expect(within(thread).getByText("Should this be async?")).toBeTruthy();
  const resolved = within(section).getByRole("article", { name: "评审线程，来自 bob，已解决" });
  expect(resolved.className).toContain("opacity-60");
  expect(within(section).queryByText("Old remark")).toBeNull();
  expect(within(section).queryByText("Far away")).toBeNull();
});
