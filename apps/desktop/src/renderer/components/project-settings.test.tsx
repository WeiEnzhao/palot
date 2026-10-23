import type { OpenCodeClient, Project } from "@opencode/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRendererQueryClient } from "../lib/query-client";
import { openCodeKeys } from "../lib/opencode-query";
import { runtimeAtom } from "../atoms/workspace";
import { setOpenCodeClientForTest, resetOpenCodeClientForTest } from "../services/opencode-client";
import { mapProject } from "../services/opencode-mappers";
import { ProjectSettings, projectDetailsKey } from "./project-settings";
import type {
  PalotProjectScriptsApi,
  ProjectScript,
  ProjectScriptsAvailability,
} from "../../shared/project-scripts-contract";

const first: Project = {
  id: "first",
  canonical: "/first",
  name: "First",
  sandboxes: [],
  time: { created: 1, updated: 1, active: 1 },
};
const second: Project = { ...first, id: "second", canonical: "/second", name: "Second" };
afterEach(() => {
  cleanup();
  resetOpenCodeClientForTest();
  Reflect.deleteProperty(window, "palot");
});

/** An in-memory stand-in for main's script store. */
function installScripts(availability: ProjectScriptsAvailability = { supported: true }) {
  let scripts: ProjectScript[] = [];
  let next = 0;
  const state = (target: { profileID: string; projectID: string }) => ({
    ...target,
    scripts,
    availability,
  });
  const api = {
    load: vi.fn(async (target) => state(target)),
    save: vi.fn(async ({ script, ...target }) => {
      const saved = {
        ...script,
        id: script.id ?? `script-${++next}`,
        createdAt: 1,
        updatedAt: 1,
      } as ProjectScript;
      scripts = script.id
        ? scripts.map((item) => (item.id === script.id ? saved : item))
        : [...scripts, saved];
      return state(target);
    }),
    remove: vi.fn(async ({ scriptID, ...target }) => {
      scripts = scripts.filter((item) => item.id !== scriptID);
      return state(target);
    }),
    onRunFinished: vi.fn(() => () => undefined),
  } satisfies PalotProjectScriptsApi;
  Object.defineProperty(window, "palot", { configurable: true, value: { projectScripts: api } });
  return api;
}

function setup(update = vi.fn().mockResolvedValue({ ...first, name: "Edited" })) {
  setOpenCodeClientForTest({
    project: { list: vi.fn().mockResolvedValue([first, second]), update },
  } as unknown as OpenCodeClient);
  const client = createRendererQueryClient();
  const store = createStore();
  store.set(runtimeAtom, {
    connectionID: "connection-1",
    profileID: "local-default",
    phase: "connected",
    connected: true,
    contractVersion: "2.0.3",
    version: "2.0.3",
    binaryPath: null,
    pid: null,
    managed: false,
    lastConnectedAt: 1,
    error: null,
    versionMismatch: null,
  });
  const view = (project: Project) => (
    <QueryClientProvider client={client}>
      <Provider store={store}>
        <ProjectSettings project={mapProject(project)} />
      </Provider>
    </QueryClientProvider>
  );
  const rendered = render(view(first));
  return { client, update, switchProject: () => rendered.rerender(view(second)) };
}

describe("Project settings", () => {
  it("keeps an in-flight save scoped to the old project and invalidates old and new locations", async () => {
    const user = userEvent.setup();
    let resolve!: (project: Project) => void;
    const update = vi.fn(
      () =>
        new Promise<Project>((done) => {
          resolve = done;
        }),
    );
    const { client, switchProject } = setup(update);
    const oldKey = openCodeKeys.vcsStatus("connection-1", { directory: "/first" });
    const newKey = openCodeKeys.settingsLocation("connection-1", { directory: "/new" });
    const unrelated = openCodeKeys.vcsStatus("other-server", { directory: "/first" });
    client.setQueryData(oldKey, {});
    client.setQueryData(newKey, {});
    client.setQueryData(unrelated, {});
    const input = await screen.findByLabelText("主检出目录");
    await user.clear(input);
    await user.type(input, "/new");
    await user.click(screen.getByRole("button", { name: "保存项目" }));
    expect((screen.getByRole("button", { name: "正在保存…" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    switchProject();
    await screen.findByDisplayValue("Second");
    await act(async () => {
      resolve({ ...first, canonical: "/new" });
    });
    expect((screen.getByLabelText("主检出目录") as HTMLInputElement).value).toBe(
      "/second",
    );
    expect(screen.queryByText("Project settings saved.")).toBeNull();
    expect(client.getQueryState(oldKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(newKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(unrelated)?.isInvalidated).toBe(false);
    expect(update).toHaveBeenCalledWith(
      { projectID: "first", canonical: "/new" },
      { signal: expect.any(AbortSignal) },
    );
  });

  it("retains failed edits, then saves only the edited field", async () => {
    const user = userEvent.setup();
    const update = vi
      .fn()
      .mockRejectedValueOnce(new Error("Permission denied"))
      .mockResolvedValue({ ...first, name: "Edited" });
    setup(update);
    const input = await screen.findByLabelText("项目名称");
    await user.clear(input);
    await user.type(input, "Edited");
    await user.click(screen.getByRole("button", { name: "保存项目" }));
    expect(await screen.findByText("Permission denied")).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe("Edited");
    await user.click(screen.getByRole("button", { name: "保存项目" }));
    expect(await screen.findByText("Project settings saved.")).toBeTruthy();
    expect(update).toHaveBeenLastCalledWith(
      { projectID: "first", name: "Edited" },
      { signal: expect.any(AbortSignal) },
    );
  });

  it("keeps unsaved input through refresh and discards it when switching projects", async () => {
    const user = userEvent.setup();
    const { client, switchProject, update } = setup();
    const input = await screen.findByLabelText("项目名称");
    await user.clear(input);
    await user.type(input, "Unsaved");
    await client.invalidateQueries({ queryKey: projectDetailsKey("connection-1", "first") });
    expect((input as HTMLInputElement).value).toBe("Unsaved");
    switchProject();
    await waitFor(() =>
      expect((screen.getByLabelText("项目名称") as HTMLInputElement).value).toBe("Second"),
    );
    expect(
      (screen.getByRole("button", { name: "保存项目" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(update).not.toHaveBeenCalled();
  });
  it("adds, edits and removes a project script, showing the exact command", async () => {
    const user = userEvent.setup();
    const api = installScripts();
    setup();
    await user.click(await screen.findByRole("button", { name: "添加脚本" }));
    await user.type(screen.getByLabelText("脚本名称"), "Clean");
    await user.type(screen.getByLabelText("命令"), "cargo clean && rm -rf dist");
    expect(
      screen.getByRole("switch", { name: "当任务结束时" }).getAttribute("aria-checked"),
    ).toBe("true");
    await user.click(screen.getByRole("button", { name: "保存脚本" }));
    expect(api.save).toHaveBeenCalledWith({
      profileID: "local-default",
      projectID: "first",
      script: {
        name: "Clean",
        command: "cargo clean && rm -rf dist",
        runOnSettle: true,
        timeoutSeconds: 600,
      },
    });
    const command = await screen.findByRole("group", { name: "命令" });
    expect(command.textContent).toContain("cargo clean && rm -rf dist");
    expect(screen.getByRole("button", { name: "复制 Clean 命令" })).toBeTruthy();
    expect(screen.getByText("当任务结束时运行 · 10 分钟后停止")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "编辑 Clean" }));
    const timeout = screen.getByLabelText("超时时间（秒）");
    await user.clear(timeout);
    await user.type(timeout, "2");
    expect(
      (screen.getByRole("button", { name: "保存脚本" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.type(timeout, "0");
    await user.click(screen.getByRole("switch", { name: "当任务结束时" }));
    await user.click(screen.getByRole("button", { name: "保存脚本" }));
    expect(api.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        script: expect.objectContaining({ id: "script-1", runOnSettle: false, timeoutSeconds: 20 }),
      }),
    );
    expect(await screen.findByText("Off · no trigger selected")).toBeTruthy();

    // Removing confirms in place.
    await user.click(screen.getByRole("button", { name: "删除 Clean" }));
    expect(api.remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "确认删除 Clean" }));
    await waitFor(() =>
      expect(api.remove).toHaveBeenCalledWith({
        profileID: "local-default",
        projectID: "first",
        scriptID: "script-1",
      }),
    );
    expect(await screen.findByText(/No scripts yet/)).toBeTruthy();
  });

  it("explains why a remote connection cannot run scripts and offers no editor", async () => {
    installScripts({ supported: false, reason: "Scripts run on this computer." });
    setup();
    expect(await screen.findByText("Scripts run on this computer.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "添加脚本" })).toBeNull();
  });
});
