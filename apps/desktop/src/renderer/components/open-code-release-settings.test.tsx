import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenCodeReleaseStatus } from "../../shared/opencode-release-contract";
import { runtimeAtom } from "../atoms/workspace";
import { palot } from "../services/palot";
import { OpenCodeReleaseSettings, OpenCodeReleaseSetup } from "./open-code-release-settings";

vi.mock("../services/palot", () => ({
  palot: {
    openCodeReleaseStatus: vi.fn(),
    setOpenCodeReleaseChannel: vi.fn(),
    checkOpenCodeRelease: vi.fn(),
    prepareOpenCodeRelease: vi.fn(),
    resetOpenCodeRelease: vi.fn(),
    connectOpenCode: vi.fn(),
    restartLocalOpenCodeService: vi.fn(),
    inspectOpenCodeInstallations: vi.fn(),
    openCodeInstallationStatus: vi.fn(),
  },
}));

const initial: OpenCodeReleaseStatus = {
  channel: "stable",
  bundledVersion: "2.0.24",
  preparedVersion: null,
  checkedAt: null,
  offer: null,
};
const offered: OpenCodeReleaseStatus = {
  ...initial,
  channel: "beta",
  checkedAt: 1000,
  offer: {
    channel: "beta",
    version: "2.1.0-beta.1",
    tested: false,
    requiresConfirmation: true,
    size: 1024 * 1024,
  },
};

beforeEach(() => {
  vi.mocked(palot.inspectOpenCodeInstallations).mockResolvedValue({
    preference: "installed",
    selectedID: null,
    installations: [],
  });
  vi.mocked(palot.openCodeReleaseStatus).mockResolvedValue(initial);
  vi.mocked(palot.checkOpenCodeRelease).mockResolvedValue(offered);
  vi.mocked(palot.prepareOpenCodeRelease).mockResolvedValue({
    ...offered,
    preparedVersion: "2.1.0-beta.1",
  });
  vi.mocked(palot.resetOpenCodeRelease).mockResolvedValue(initial);
});
afterEach(() => {
  cleanup();
  expect(palot.connectOpenCode).not.toHaveBeenCalled();
  expect(palot.restartLocalOpenCodeService).not.toHaveBeenCalled();
  vi.resetAllMocks();
});

describe("OpenCodeReleaseSettings", () => {
  it("prepares and resets a fallback without claiming a bundle exists or starting a service", async () => {
    const user = userEvent.setup();
    const external = { ...initial, bundledVersion: null };
    const available: OpenCodeReleaseStatus = {
      ...external,
      checkedAt: 1000,
      offer: {
        channel: "stable",
        version: "2.0.24",
        tested: true,
        requiresConfirmation: false,
        size: 1024,
      },
    };
    vi.mocked(palot.openCodeReleaseStatus).mockResolvedValue(external);
    vi.mocked(palot.checkOpenCodeRelease).mockResolvedValue(available);
    vi.mocked(palot.prepareOpenCodeRelease).mockResolvedValue({
      ...available,
      preparedVersion: "2.0.24",
    });
    vi.mocked(palot.resetOpenCodeRelease).mockResolvedValue(external);
    render(<OpenCodeReleaseSettings />);
    expect(await screen.findByText("未下载")).toBeTruthy();
    expect(screen.queryByText(/\(bundled\)/)).toBeNull();
    expect(palot.checkOpenCodeRelease).not.toHaveBeenCalled();
    expect(palot.prepareOpenCodeRelease).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "检查发布版本" }));
    await user.click(await screen.findByRole("button", { name: "下载 Palot 回退 2.0.24" }));
    expect(await screen.findByText("2.0.24（已下载）")).toBeTruthy();
    expect(palot.prepareOpenCodeRelease).toHaveBeenCalledExactlyOnceWith({ version: "2.0.24" });
    await user.click(screen.getByRole("button", { name: "重置已准备的运行时" }));
    expect(await screen.findByText("未下载")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /重置为内置/ })).toBeNull();
  });

  it("shows a checked but unavailable Beta without a download action or generic error", async () => {
    const user = userEvent.setup();
    vi.mocked(palot.openCodeReleaseStatus).mockResolvedValue({
      ...initial,
      channel: "beta",
      preparedVersion: "2.0.24",
    });
    vi.mocked(palot.checkOpenCodeRelease).mockResolvedValue({
      ...initial,
      channel: "beta",
      preparedVersion: "2.0.24",
      checkedAt: 1000,
      offer: null,
    });
    render(<OpenCodeReleaseSettings />);
    await user.click(await screen.findByRole("button", { name: "检查发布版本" }));
    expect(await screen.findByText(/没有兼容的 Beta 可用/)).toBeTruthy();
    expect(screen.getByText("2.0.24（已下载）")).toBeTruthy();
    expect(screen.getByText(/上次检查：/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /下载 Palot 回退/ })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(palot.prepareOpenCodeRelease).not.toHaveBeenCalled();
  });

  it.each([
    ["stable", "Stable"],
    ["beta", "Beta"],
  ] as const)("shows the saved %s label before the picker has opened", async (channel, label) => {
    vi.mocked(palot.openCodeReleaseStatus).mockResolvedValue({ ...initial, channel });
    render(<OpenCodeReleaseSettings />);
    const picker = await screen.findByRole("combobox", { name: "首选通道" });
    expect(picker.getAttribute("aria-expanded")).toBe("false");
    expect(picker.textContent).toContain(label);
    expect(palot.setOpenCodeReleaseChannel).not.toHaveBeenCalled();
    expect(palot.checkOpenCodeRelease).not.toHaveBeenCalled();
  });

  it("reads only local status on mount and separates connected and next-start versions", async () => {
    const store = createStore();
    store.set(runtimeAtom, {
      connectionID: "local",
      profileID: "local-default",
      contractVersion: "test",
      phase: "connected",
      connected: true,
      binaryPath: null,
      version: "2.0.0-beta.19507",
      pid: 7,
      managed: false,
      lastConnectedAt: null,
      error: null,
      versionMismatch: null,
      source: "shared-service",
    });
    render(
      <Provider store={store}>
        <OpenCodeReleaseSettings />
      </Provider>,
    );
    expect(await screen.findByRole("combobox", { name: "首选通道" })).toBeTruthy();
    expect(screen.getByText("2.0.0-beta.19507")).toBeTruthy();
    expect(screen.getByText("2.0.24（内置）")).toBeTruthy();
    expect(palot.openCodeReleaseStatus).toHaveBeenCalledOnce();
    expect(palot.checkOpenCodeRelease).not.toHaveBeenCalled();
    expect(palot.prepareOpenCodeRelease).not.toHaveBeenCalled();
    expect(palot.setOpenCodeReleaseChannel).not.toHaveBeenCalled();
  });

  it("saves a channel with keyboard controls without checking or discarding the prepared runtime", async () => {
    const user = userEvent.setup();
    vi.mocked(palot.openCodeReleaseStatus).mockResolvedValue({
      ...initial,
      preparedVersion: "2.0.0-beta.19507",
    });
    vi.mocked(palot.setOpenCodeReleaseChannel).mockResolvedValue({
      ...initial,
      channel: "beta",
      preparedVersion: "2.0.0-beta.19507",
    });
    render(<OpenCodeReleaseSettings />);
    const channel = await screen.findByRole("combobox", { name: "首选通道" });
    expect(channel.textContent).toContain("Stable");
    channel.focus();
    await user.keyboard("{Enter}{End}{Enter}");
    await waitFor(() => expect(palot.setOpenCodeReleaseChannel).toHaveBeenCalledWith("beta"));
    expect(channel.textContent).toContain("Beta");
    expect(screen.getByText("2.0.0-beta.19507（已下载）")).toBeTruthy();
    expect(palot.checkOpenCodeRelease).not.toHaveBeenCalled();
    expect(palot.prepareOpenCodeRelease).not.toHaveBeenCalled();
    expect(screen.getByText(/可能滞后于/)).toBeTruthy();
  });

  it.each(["success", "failure", "tab-away"] as const)(
    "preserves keyboard focus during a deferred channel save (%s)",
    async (outcome) => {
      const user = userEvent.setup();
      let resolve!: (value: OpenCodeReleaseStatus) => void;
      let reject!: (error: Error) => void;
      vi.mocked(palot.setOpenCodeReleaseChannel).mockReturnValue(
        new Promise((done, fail) => {
          resolve = done;
          reject = fail;
        }),
      );
      render(
        <>
          <OpenCodeReleaseSettings />
          <button type="button">Other settings</button>
        </>,
      );
      const channel = await screen.findByRole("combobox", { name: "首选通道" });
      channel.focus();
      await user.keyboard("{Enter}{End}{Enter}");
      await waitFor(() => expect(palot.setOpenCodeReleaseChannel).toHaveBeenCalledOnce());
      expect((channel as HTMLButtonElement).disabled).toBe(false);
      expect(channel.getAttribute("aria-readonly")).toBe("true");
      await waitFor(() => expect(document.activeElement).toBe(channel));
      expect(
        (screen.getByRole("button", { name: "检查发布版本" }) as HTMLButtonElement).disabled,
      ).toBe(true);

      // Browsing the read-only popup cannot admit another save while IPC is pending.
      await user.keyboard("{Enter}{End}{Enter}{Escape}");
      expect(palot.setOpenCodeReleaseChannel).toHaveBeenCalledOnce();
      await waitFor(() => expect(document.activeElement).toBe(channel));
      const other = screen.getByRole("button", { name: "Other settings" });
      if (outcome === "tab-away") {
        await user.tab();
        expect(document.activeElement).toBe(other);
      }
      await act(async () => {
        if (outcome === "failure") reject(new Error("Channel preference could not be saved"));
        else resolve({ ...initial, channel: "beta" });
      });
      expect(channel.getAttribute("aria-readonly")).toBeNull();
      expect(channel.textContent).toContain(outcome === "failure" ? "Stable" : "Beta");
      expect(document.activeElement).toBe(outcome === "tab-away" ? other : channel);
      expect(palot.checkOpenCodeRelease).not.toHaveBeenCalled();
      expect(palot.prepareOpenCodeRelease).not.toHaveBeenCalled();
    },
  );

  it.each(["stable", "beta"] as const)(
    "requires explicit consent for an unsupported %s release and supports cancellation",
    async (channel) => {
      const user = userEvent.setup();
      const version = channel === "stable" ? "2.1.0-beta.2" : "0.0.0-beta-20000";
      vi.mocked(palot.checkOpenCodeRelease).mockResolvedValue({
        ...offered,
        channel,
        offer: { ...offered.offer!, channel, version },
      });
      vi.mocked(palot.prepareOpenCodeRelease).mockResolvedValue({
        ...offered,
        preparedVersion: version,
      });
      render(<OpenCodeReleaseSettings />);
      await user.click(await screen.findByRole("button", { name: "检查发布版本" }));
      await user.click(screen.getByRole("button", { name: `下载 Palot 回退 ${version}` }));
      expect(screen.getByRole("alertdialog").textContent).toContain(
        "不保证兼容性",
      );
      expect(palot.prepareOpenCodeRelease).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "取消" }));
      expect(palot.prepareOpenCodeRelease).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: `下载 Palot 回退 ${version}` }));
      await user.click(screen.getByRole("button", { name: "继续并准备" }));
      expect(palot.prepareOpenCodeRelease).toHaveBeenCalledExactlyOnceWith({
        version,
        allowUntested: true,
      });
      expect(
        await screen.findByText(
          `Palot 运行时 ${version} 已作为回退或 Palot 运行时源准备好。现有服务不变。`,
        ),
      ).toBeTruthy();
      expect(screen.getByText(`${version}（已下载）`)).toBeTruthy();
    },
  );

  it.each(["stable", "beta"] as const)(
    "prepares compatible untested Stable releases from %s without a warning or override",
    async (channel) => {
      const user = userEvent.setup();
      vi.mocked(palot.checkOpenCodeRelease).mockResolvedValue({
        ...offered,
        channel,
        offer: {
          ...offered.offer!,
          channel,
          version: "2.0.8",
          requiresConfirmation: false,
        },
      });
      render(<OpenCodeReleaseSettings />);
      await user.click(await screen.findByRole("button", { name: "检查发布版本" }));
      expect(screen.getByText(/兼容 · 尚未在此 Palot 版本测试/)).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "下载 Palot 回退 2.0.8" }));
      expect(palot.prepareOpenCodeRelease).toHaveBeenCalledExactlyOnceWith({ version: "2.0.8" });
      expect(screen.queryByRole("alertdialog")).toBeNull();
    },
  );

  it("prepares tested releases without an untested override and resets to the bundle", async () => {
    const user = userEvent.setup();
    vi.mocked(palot.checkOpenCodeRelease).mockResolvedValue({
      ...offered,
      offer: { ...offered.offer!, version: "2.0.24", tested: true, requiresConfirmation: false },
    });
    render(<OpenCodeReleaseSettings />);
    await user.click(await screen.findByRole("button", { name: "检查发布版本" }));
    await user.click(screen.getByRole("button", { name: "下载 Palot 回退 2.0.24" }));
    expect(palot.prepareOpenCodeRelease).toHaveBeenCalledExactlyOnceWith({ version: "2.0.24" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "重置为内置 2.0.24" }));
    expect(palot.resetOpenCodeRelease).toHaveBeenCalledOnce();
    expect(screen.getByText("2.0.24（内置）")).toBeTruthy();
    expect(screen.getByText(/内置 OpenCode 2.0.24 重新成为 Palot 回退/)).toBeTruthy();
  });

  it("preserves the selected runtime on offline errors and retries only when asked", async () => {
    const user = userEvent.setup();
    vi.mocked(palot.openCodeReleaseStatus).mockResolvedValue({
      ...initial,
      preparedVersion: "2.1.0-beta.1",
    });
    vi.mocked(palot.checkOpenCodeRelease).mockRejectedValueOnce(
      new Error("Offline: release feed unavailable"),
    );
    render(<OpenCodeReleaseSettings />);
    await user.click(await screen.findByRole("button", { name: "检查发布版本" }));
    expect(screen.getByRole("alert").textContent).toContain("Offline");
    expect(screen.getByText("2.1.0-beta.1（已下载）")).toBeTruthy();
    expect(palot.checkOpenCodeRelease).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "重试发布操作" }));
    expect(palot.checkOpenCodeRelease).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("supports retrying failed local status without a release-feed request", async () => {
    const user = userEvent.setup();
    vi.mocked(palot.openCodeReleaseStatus).mockRejectedValueOnce(
      new Error("Cannot read local settings"),
    );
    render(<OpenCodeReleaseSettings />);
    await user.click(await screen.findByRole("button", { name: "重试发布操作" }));
    expect(await screen.findByRole("combobox", { name: "首选通道" })).toBeTruthy();
    expect(palot.openCodeReleaseStatus).toHaveBeenCalledTimes(2);
    expect(palot.checkOpenCodeRelease).not.toHaveBeenCalled();
  });

  it("does not reuse untested consent after a failed download", async () => {
    const user = userEvent.setup();
    vi.mocked(palot.prepareOpenCodeRelease).mockRejectedValueOnce(new Error("Download failed"));
    render(<OpenCodeReleaseSettings />);
    await user.click(await screen.findByRole("button", { name: "检查发布版本" }));
    await user.click(screen.getByRole("button", { name: "下载 Palot 回退 2.1.0-beta.1" }));
    await user.click(screen.getByRole("button", { name: "继续并准备" }));
    expect(screen.getByText("2.0.24（内置）")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "重试发布操作" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(palot.prepareOpenCodeRelease).toHaveBeenCalledOnce();
  });

  it("locks conflicting operations while a request is pending", async () => {
    const user = userEvent.setup();
    let resolve!: (value: OpenCodeReleaseStatus) => void;
    vi.mocked(palot.openCodeReleaseStatus).mockResolvedValue({
      ...initial,
      preparedVersion: "2.1.0-beta.1",
    });
    vi.mocked(palot.checkOpenCodeRelease).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render(<OpenCodeReleaseSettings />);
    await user.dblClick(await screen.findByRole("button", { name: "检查发布版本" }));
    expect(palot.checkOpenCodeRelease).toHaveBeenCalledOnce();
    expect(
      (screen.getByRole("combobox", { name: "首选通道" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "重置为内置 2.0.24" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await act(async () => resolve(offered));
    expect(
      (screen.getByRole("button", { name: "检查发布版本" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("loads setup lazily and works before a connection exists", async () => {
    const user = userEvent.setup();
    render(<OpenCodeReleaseSetup />);
    expect(palot.openCodeReleaseStatus).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "OpenCode 发布设置" }));
    expect(screen.getByRole("dialog", { name: "设置本地 OpenCode" })).toBeTruthy();
    expect(await screen.findByText("未连接")).toBeTruthy();
    expect(palot.openCodeReleaseStatus).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole("combobox", { name: "运行时来源" })).toBeTruthy();
    expect(palot.inspectOpenCodeInstallations).toHaveBeenCalledOnce();
    expect(palot.checkOpenCodeRelease).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
