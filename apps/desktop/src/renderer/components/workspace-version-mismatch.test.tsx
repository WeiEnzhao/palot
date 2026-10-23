import { createStore } from "jotai";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorAtom, phaseAtom, runtimeAtom, workspaceRecoveryAtom } from "../atoms/workspace";
import { renderWithRouter } from "../test-utils/render-with-router";
import { Workspace } from "./workspace";
import { palot } from "../services/palot";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Workspace version mismatch", () => {
  it("requires confirmation before replacing the shared service", async () => {
    const store = createStore();
    const run = vi.fn().mockResolvedValue(undefined);
    store.set(workspaceRecoveryAtom, { run });
    store.set(phaseAtom, "error");
    store.set(errorAtom, "OpenCode versions do not match");
    store.set(runtimeAtom, {
      connectionID: "connection",
      profileID: "local-default",
      source: "shared-service",
      contractVersion: "0.0.0-beta-19425",
      phase: "error",
      connected: false,
      binaryPath: null,
      version: "0.0.0-beta-17794",
      pid: 42,
      managed: false,
      lastConnectedAt: null,
      error: "OpenCode versions do not match",
      versionMismatch: {
        detectedVersion: "0.0.0-beta-17794",
        expectedVersion: "0.0.0-beta-19425",
        canContinue: true,
      },
    });

    const mismatchRuntime = store.get(runtimeAtom)!;
    renderWithRouter(<Workspace content={null} />, store);

    expect(screen.getByRole("heading", { name: "OpenCode 版本不匹配" })).toBeTruthy();
    expect(
      screen.getByText(
        /Palot was tested with OpenCode 0.0.0-beta-19425, but the running service is 0.0.0-beta-17794\./,
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue with existing service" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "使用选定的运行时" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "使用选定的运行时" }));
    expect(screen.getByText(/默认优先使用已安装的 OpenCode/)).toBeTruthy();
    expect(screen.getByText(/可能中断其他 OpenCode 客户端/)).toBeTruthy();
    expect(run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "使用选定的运行时" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "替换服务" })));
    expect(run).toHaveBeenCalledWith({ versionMismatch: "replace" });
    act(() => {
      store.set(phaseAtom, "error");
      store.set(runtimeAtom, { ...mismatchRuntime, source: "network-server" });
    });
    expect(screen.queryByRole("button", { name: "使用选定的运行时" })).toBeNull();
    expect(screen.queryByRole("button", { name: "OpenCode 发布设置" })).toBeNull();
    expect(screen.getByRole("button", { name: "Continue with existing service" })).toBeTruthy();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Continue with existing service" })),
    );
    expect(run).toHaveBeenLastCalledWith({
      versionMismatch: "continue",
      approvedVersion: "0.0.0-beta-17794",
    });
  });

  it("starts through workspace recovery after confirmation and keeps retry read-only", async () => {
    const store = createStore();
    const run = vi.fn().mockResolvedValue(undefined);
    store.set(workspaceRecoveryAtom, { run });
    store.set(phaseAtom, "error");
    store.set(errorAtom, "No shared service is available");
    store.set(runtimeAtom, {
      connectionID: "local",
      profileID: "local-default",
      contractVersion: "test",
      phase: "error",
      connected: false,
      binaryPath: null,
      version: null,
      pid: null,
      managed: false,
      lastConnectedAt: null,
      error: "Unavailable",
      versionMismatch: null,
      canStartLocalService: true,
    });
    vi.spyOn(palot, "runtimeStatus").mockResolvedValue(store.get(runtimeAtom)!);
    const releaseStatus = vi.spyOn(palot, "openCodeReleaseStatus").mockResolvedValue({
      channel: "stable",
      bundledVersion: "2.0.2",
      preparedVersion: null,
      checkedAt: null,
      offer: null,
    });
    const checkRelease = vi.spyOn(palot, "checkOpenCodeRelease");
    const inspectInstallations = vi.spyOn(palot, "inspectOpenCodeInstallations").mockResolvedValue({
      preference: "installed",
      selectedID: null,
      installations: [],
    });
    renderWithRouter(<Workspace content={null} />, store);
    expect(releaseStatus).not.toHaveBeenCalled();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "OpenCode 发布设置" })),
    );
    expect(screen.getByRole("combobox", { name: "首选通道" })).toBeTruthy();
    expect(releaseStatus).toHaveBeenCalled();
    expect(inspectInstallations).toHaveBeenCalledOnce();
    expect(checkRelease).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Try again" })));
    expect(run).toHaveBeenLastCalledWith(undefined);
    run.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "启动 OpenCode" }));
    expect(
      screen.getByRole("alertdialog", { name: "启动或恢复共享 OpenCode？" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "启动 OpenCode" }));
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "启动或恢复" })),
    );
    expect(run).toHaveBeenCalledExactlyOnceWith({ startLocalService: true });
    act(() =>
      store.set(runtimeAtom, {
        ...store.get(runtimeAtom)!,
        profileID: "remote",
        canStartLocalService: false,
      }),
    );
    expect(screen.queryByRole("button", { name: "启动 OpenCode" })).toBeNull();
  });
});
