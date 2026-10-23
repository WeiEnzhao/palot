import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeLoginStatus } from "../../shared/opencode-login-contract";
import { palot } from "../services/palot";
import { OpenCodeLoginAutostartSettings } from "./open-code-login-autostart-settings";

const status: OpenCodeLoginStatus = {
  manager: "systemd",
  supported: true,
  enabled: false,
  owned: false,
  running: false,
  pid: null,
  binaryPath: null,
  configPath: "/home/test/.config/systemd/user/opencode.service",
  reason: null,
};
const installation = {
  id: "opaque-cli-id",
  path: "/home/test/.bun/bin/opencode2",
  version: "2.0.2",
  compatible: true,
};

beforeEach(() => {
  vi.spyOn(palot, "getOpenCodeLoginStatus").mockResolvedValue(status);
  vi.spyOn(palot, "inspectOpenCodeInstallations").mockResolvedValue({
    preference: "installed",
    selectedID: installation.id,
    installations: [installation],
  });
  vi.spyOn(palot, "updateOpenCodeLogin").mockResolvedValue({
    ...status,
    enabled: true,
    owned: true,
    binaryPath: installation.path,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("OpenCodeLoginAutostartSettings", () => {
  it("reads only status on mount and confirms the exact installed path and version before enabling", async () => {
    const user = userEvent.setup();
    const onBusyChange = vi.fn();
    render(<OpenCodeLoginAutostartSettings onBusyChange={onBusyChange} />);
    await screen.findByText("Disabled");
    expect(palot.getOpenCodeLoginStatus).toHaveBeenCalledOnce();
    expect(palot.inspectOpenCodeInstallations).not.toHaveBeenCalled();
    expect(palot.updateOpenCodeLogin).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "启用登录自启动" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(installation.path)).toBeTruthy();
    expect(within(dialog).getByText(`OpenCode ${installation.version}`)).toBeTruthy();
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(palot.updateOpenCodeLogin).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "启用登录自启动" }));
    await user.click(screen.getByRole("button", { name: "确认启用" }));
    expect(palot.updateOpenCodeLogin).toHaveBeenCalledExactlyOnceWith({
      enabled: true,
      installationID: installation.id,
      version: installation.version,
    });
    expect(await screen.findByRole("status")).toHaveProperty(
      "textContent",
      "登录启动已为后续登录启用。运行中的服务不受影响。",
    );
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });

  it("disables future login startup without stopping the running service or inspecting CLIs", async () => {
    vi.mocked(palot.getOpenCodeLoginStatus).mockResolvedValue({
      ...status,
      enabled: true,
      owned: true,
      running: true,
      pid: 42,
      binaryPath: installation.path,
    });
    vi.mocked(palot.updateOpenCodeLogin).mockResolvedValue({
      ...status,
      owned: true,
      running: true,
      pid: 42,
    });
    const restart = vi.spyOn(palot, "restartLocalOpenCodeService");
    const connect = vi.spyOn(palot, "connectOpenCode");
    const user = userEvent.setup();
    render(<OpenCodeLoginAutostartSettings />);
    await user.click(await screen.findByRole("button", { name: "禁用登录自启动" }));
    expect(palot.updateOpenCodeLogin).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "确认禁用" }));
    expect(palot.updateOpenCodeLogin).toHaveBeenCalledExactlyOnceWith({ enabled: false });
    expect(await screen.findByRole("status")).toHaveProperty(
      "textContent",
      "登录启动已为后续登录禁用。任何运行中的服务继续运行。",
    );
    expect(screen.getByText(/Running \(process 42\)/)).toBeTruthy();
    expect(palot.inspectOpenCodeInstallations).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it.each([
    {
      ...status,
      supported: false,
      manager: null,
      reason: "A systemd user session is required. Sign in, then refresh status.",
    },
    {
      ...status,
      supported: false,
      reason:
        "An unrecognized startup configuration exists. Palot will not replace it. Review it in your user service manager, then refresh status.",
    },
    { ...status, enabled: true, reason: null },
  ] satisfies OpenCodeLoginStatus[])(
    "blocks unsupported managers and foreign startup configurations",
    async (result) => {
      vi.mocked(palot.getOpenCodeLoginStatus).mockResolvedValue(result);
      render(<OpenCodeLoginAutostartSettings />);
      await screen.findByRole("alert");
      expect(
        (
          screen.getByRole("button", {
            name: /^(启用登录自启动|禁用登录自启动)$/,
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
      expect(
        (screen.getByRole("button", { name: "刷新状态" }) as HTMLButtonElement).disabled,
      ).toBe(false);
      expect(palot.updateOpenCodeLogin).not.toHaveBeenCalled();
    },
  );

  it("offers a safe refresh after a read error without displaying raw process output", async () => {
    vi.mocked(palot.getOpenCodeLoginStatus).mockRejectedValueOnce(
      new Error("password=private process output"),
    );
    const user = userEvent.setup();
    render(<OpenCodeLoginAutostartSettings />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Check that your user service manager is available",
    );
    expect(screen.queryByText(/private process output/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "刷新状态" }));
    await screen.findByText("Disabled");
    expect(palot.getOpenCodeLoginStatus).toHaveBeenCalledTimes(2);
    expect(palot.inspectOpenCodeInstallations).not.toHaveBeenCalled();
  });

  it("selects only compatible or approved installations and sends the displayed choice", async () => {
    const approved = {
      id: "approved-cli",
      path: "/opt/opencode2",
      launchPath: "/home/test/.local/bin/opencode2",
      version: "2.0.0-beta.100",
      compatible: false,
      approved: true,
    };
    vi.mocked(palot.inspectOpenCodeInstallations).mockResolvedValue({
      preference: "installed",
      selectedID: "incompatible",
      installations: [
        installation,
        approved,
        { ...installation, id: "incompatible", version: "1.0.0", compatible: false },
      ],
    });
    const user = userEvent.setup();
    render(<OpenCodeLoginAutostartSettings />);
    await screen.findByText("Disabled");
    await user.click(screen.getByRole("button", { name: "启用登录自启动" }));
    await user.click(screen.getByRole("combobox", { name: "OpenCode 安装" }));
    expect(screen.queryByRole("option", { name: /1.0.0/ })).toBeNull();
    await user.click(screen.getByRole("option", { name: /2.0.0-beta.100/ }));
    expect(within(screen.getByRole("alertdialog")).getByText(approved.launchPath)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "确认启用" }));
    expect(palot.updateOpenCodeLogin).toHaveBeenCalledExactlyOnceWith({
      enabled: true,
      installationID: approved.id,
      version: approved.version,
    });
  });

  it("requires fresh inspection and confirmation after a stale installation rejection", async () => {
    vi.mocked(palot.updateOpenCodeLogin).mockRejectedValueOnce(
      new Error("Installation changed password=private"),
    );
    const user = userEvent.setup();
    render(<OpenCodeLoginAutostartSettings />);
    await screen.findByText("Disabled");
    await user.click(screen.getByRole("button", { name: "启用登录自启动" }));
    await user.click(screen.getByRole("button", { name: "确认启用" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Refresh status and review the installation again",
    );
    expect(screen.queryByText(/password=private/)).toBeNull();
    expect(
      (screen.getByRole("button", { name: "启用登录自启动" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    vi.mocked(palot.inspectOpenCodeInstallations).mockResolvedValue({
      preference: "installed",
      selectedID: installation.id,
      installations: [{ ...installation, version: "2.0.3" }],
    });
    await user.click(screen.getByRole("button", { name: "刷新状态" }));
    await user.click(screen.getByRole("button", { name: "启用登录自启动" }));
    expect(screen.getByText("OpenCode 2.0.3")).toBeTruthy();
    expect(palot.updateOpenCodeLogin).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "确认启用" }));
    expect(palot.updateOpenCodeLogin).toHaveBeenLastCalledWith({
      enabled: true,
      installationID: installation.id,
      version: "2.0.3",
    });
  });

  it("does not claim success when the manager cannot verify an update", async () => {
    vi.mocked(palot.updateOpenCodeLogin).mockResolvedValue({
      ...status,
      supported: false,
      reason: "Cannot inspect the systemd user service. Check your user manager and retry.",
    });
    const user = userEvent.setup();
    render(<OpenCodeLoginAutostartSettings />);
    await screen.findByText("Disabled");
    await user.click(screen.getByRole("button", { name: "启用登录自启动" }));
    await user.click(screen.getByRole("button", { name: "确认启用" }));
    expect(await screen.findByText(/Could not verify the login startup change/)).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("blocks confirmation when no eligible CLI exists and while saving", async () => {
    vi.mocked(palot.inspectOpenCodeInstallations).mockResolvedValueOnce({
      preference: "palot",
      selectedID: null,
      installations: [],
    });
    const user = userEvent.setup();
    const onBusyChange = vi.fn();
    render(<OpenCodeLoginAutostartSettings onBusyChange={onBusyChange} />);
    await screen.findByText("Disabled");
    await user.click(screen.getByRole("button", { name: "启用登录自启动" }));
    expect(screen.getByText(/No compatible or approved installed CLI/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "确认启用" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "取消" }));
    const pending = Promise.withResolvers<OpenCodeLoginStatus>();
    vi.mocked(palot.updateOpenCodeLogin).mockReturnValue(pending.promise);
    await user.click(screen.getByRole("button", { name: "启用登录自启动" }));
    await user.click(screen.getByRole("button", { name: "确认启用" }));
    expect((screen.getByRole("button", { name: "保存中…" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole("button", { name: "取消" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    await act(async () => pending.resolve({ ...status, enabled: true, owned: true }));
    expect(onBusyChange).toHaveBeenLastCalledWith(false);
  });
});
