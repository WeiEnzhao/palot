import { Provider, createStore } from "jotai";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runtimeAtom } from "../atoms/workspace";
import { palot } from "../services/palot";
import { OpenCodeConnectionAlert } from "./opencode-connection-alert";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("OpenCodeConnectionAlert", () => {
  it("only starts an eligible local service after confirmation", async () => {
    vi.useFakeTimers();
    const store = createStore();
    const runtime = {
      connectionID: "local",
      profileID: "local-default",
      contractVersion: "test",
      phase: "error" as const,
      connected: false,
      binaryPath: null,
      version: null,
      pid: null,
      managed: false,
      lastConnectedAt: null,
      error: "Unavailable",
      versionMismatch: null,
      canStartLocalService: true,
    };
    store.set(runtimeAtom, runtime);
    const connect = vi.spyOn(palot, "connectOpenCode").mockResolvedValue(runtime);
    render(
      <Provider store={store}>
        <OpenCodeConnectionAlert />
      </Provider>,
    );
    act(() => vi.advanceTimersByTime(1200));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "重试" })));
    expect(connect).toHaveBeenLastCalledWith(undefined);
    connect.mockClear();
    act(() => store.set(runtimeAtom, { ...runtime, phase: "reconnecting" }));
    expect(screen.getByRole("button", { name: "启动 OpenCode" }).hasAttribute("disabled")).toBe(
      false,
    );
    fireEvent.click(screen.getByRole("button", { name: "启动 OpenCode" }));
    expect(screen.getByText(/这可能会重启无响应的共享服务/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(connect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "启动 OpenCode" }));
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "启动或恢复" })),
    );
    expect(connect).toHaveBeenCalledExactlyOnceWith({ startLocalService: true });
    act(() =>
      store.set(runtimeAtom, { ...runtime, profileID: "remote", canStartLocalService: false }),
    );
    expect(screen.queryByRole("button", { name: "启动 OpenCode" })).toBeNull();
  });
  it("shows persistent connection state beside the composer after a short grace period", () => {
    vi.useFakeTimers();
    const store = createStore();
    store.set(runtimeAtom, {
      connectionID: "connection-1",
      profileID: "local-default",
      contractVersion: "0.0.0-beta-19425",
      phase: "reconnecting",
      connected: false,
      binaryPath: "/usr/local/bin/opencode2",
      version: "0.0.0-beta-19425",
      pid: 42,
      managed: true,
      lastConnectedAt: 1,
      error: "Connection refused",
      versionMismatch: null,
    });

    render(
      <Provider store={store}>
        <OpenCodeConnectionAlert />
      </Provider>,
    );

    expect(screen.queryByText("正在重新连接 OpenCode")).toBeNull();
    act(() => vi.advanceTimersByTime(1_200));
    expect(screen.getByText("正在重新连接 OpenCode")).toBeTruthy();
    expect(
      screen.getByText("发送暂时不可用。您的对话是安全的。"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "详情" }));
    expect(screen.getByRole("dialog", { name: "OpenCode 连接详情" })).toBeTruthy();
    expect(screen.getByText("Connection refused")).toBeTruthy();
  });

  it("stays hidden while OpenCode is connected", () => {
    const store = createStore();
    store.set(runtimeAtom, {
      connectionID: "connection-1",
      profileID: "local-default",
      contractVersion: "0.0.0-beta-19425",
      phase: "connected",
      connected: true,
      binaryPath: "/usr/local/bin/opencode2",
      version: "0.0.0-beta-19425",
      pid: 42,
      managed: true,
      lastConnectedAt: 1,
      error: null,
      versionMismatch: null,
    });

    render(
      <Provider store={store}>
        <OpenCodeConnectionAlert />
      </Provider>,
    );

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("starts a new grace period after reconnecting", () => {
    vi.useFakeTimers();
    const store = createStore();
    const disconnected = {
      connectionID: "connection-1",
      profileID: "local-default",
      contractVersion: "0.0.0-beta-19425",
      phase: "reconnecting" as const,
      connected: false,
      binaryPath: "/usr/local/bin/opencode2",
      version: "0.0.0-beta-19425",
      pid: 42,
      managed: true,
      lastConnectedAt: 1,
      error: "Connection refused",
      versionMismatch: null,
    };
    store.set(runtimeAtom, disconnected);

    render(
      <Provider store={store}>
        <OpenCodeConnectionAlert />
      </Provider>,
    );

    act(() => vi.advanceTimersByTime(1_200));
    expect(screen.getByRole("status")).toBeTruthy();

    act(() => store.set(runtimeAtom, { ...disconnected, phase: "connected", connected: true }));
    expect(screen.queryByRole("status")).toBeNull();

    act(() => store.set(runtimeAtom, disconnected));
    expect(screen.queryByRole("status")).toBeNull();
    act(() => vi.advanceTimersByTime(1_199));
    expect(screen.queryByRole("status")).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("status")).toBeTruthy();
  });
});
