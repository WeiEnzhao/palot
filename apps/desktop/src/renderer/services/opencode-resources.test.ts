import { afterEach, expect, it, vi } from "vitest";
import { loadPromptIndex, listWorkspaceDirectory, readWorkspaceFile } from "./opencode-resources";

const list = vi.hoisted(() => vi.fn());
const fileRead = vi.hoisted(() => vi.fn());
const fileList = vi.hoisted(() => vi.fn());
vi.mock("./opencode-client", () => ({
  openCodeClient: () => ({ message: { list }, file: { read: fileRead, list: fileList } }),
}));
afterEach(() => vi.resetAllMocks());

it("keeps the user filter on pages and end-cursor probes", async () => {
  const users = Array.from({ length: 100 }, (_, index) => ({
    id: `user-${index}`,
    type: "user",
    text: "Prompt",
    time: { created: index },
  }));
  list.mockResolvedValueOnce({ data: users, cursor: { next: "older-users" } });
  list.mockResolvedValueOnce({ data: [users[0]], cursor: {} });
  list.mockResolvedValueOnce({ data: [users[0]], cursor: { next: "empty" } });
  const first = await loadPromptIndex("session", null);
  expect(first.cursor.next).toBe("older-users");
  const last = await loadPromptIndex("session", first.cursor.next!);
  expect(last.cursor.next).toBeNull();
  expect(list.mock.calls.map(([input]) => input)).toEqual([
    { sessionID: "session", type: "user", limit: 100, order: "desc" },
    { sessionID: "session", type: "user", limit: 1, cursor: "older-users" },
    { sessionID: "session", type: "user", limit: 100, cursor: "older-users" },
  ]);
});

it("does not advertise an empty filtered next page", async () => {
  list.mockResolvedValueOnce({
    data: Array.from({ length: 100 }, () => ({})),
    cursor: { next: "end" },
  });
  list.mockResolvedValueOnce({ data: [], cursor: {} });
  expect((await loadPromptIndex("session", null)).cursor.next).toBeNull();
});

// 服务端对逃出 location.directory 的绝对路径直接 500（Path escapes the location），
// 客户端改传能包住目标的 location（2026-10-24 win 连接预览 D:/project/tasks/... 实锤）。
it("re-roots the location when an absolute read path escapes the session directory", async () => {
  fileRead.mockResolvedValueOnce(new Uint8Array());
  await readWorkspaceFile({
    directory: "C:/Users/weien/.local/share/opencode/worktree/swift-river",
    path: "D:/project/tasks/model-inventory-2026-10-24.md",
  });
  expect(fileRead.mock.calls[0]![0]).toEqual({
    location: { directory: "D:/project/tasks" },
    path: "D:/project/tasks/model-inventory-2026-10-24.md",
  });
});

it("keeps the session location for reads inside the session directory", async () => {
  fileRead.mockResolvedValueOnce(new Uint8Array());
  await readWorkspaceFile({
    directory: "D:/project",
    workspaceID: "w1",
    path: "D:/project/tasks/a.md",
  });
  expect(fileRead.mock.calls[0]![0]).toEqual({
    location: { directory: "D:/project", workspace: "w1" },
    path: "D:/project/tasks/a.md",
  });
});

it("re-roots list requests to an absolute directory outside the session", async () => {
  fileList.mockResolvedValueOnce({ data: [] });
  await listWorkspaceDirectory({ directory: "C:/Users/weien", path: "D:/project/tasks" });
  expect(fileList.mock.calls[0]![0]).toEqual({
    location: { directory: "D:/project/tasks" },
    path: "D:/project/tasks",
  });
});
