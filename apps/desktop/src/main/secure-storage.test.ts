// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { configureKeychainPolicy, configureSecureStorage } from "./secure-storage";

describe("configureSecureStorage", () => {
  it.each(["Hyprland", "hyprland", "Hyprland:wlroots"])(
    "selects Secret Service on %s before keyring initialization",
    (desktop) => {
      const commandLine = { hasSwitch: vi.fn(() => false), appendSwitch: vi.fn() };
      configureSecureStorage(commandLine, "linux", desktop);
      expect(commandLine.appendSwitch).toHaveBeenCalledWith("password-store", "gnome-libsecret");
    },
  );

  it("preserves an explicitly selected password store", () => {
    const commandLine = {
      hasSwitch: vi.fn((name) => name === "password-store"),
      appendSwitch: vi.fn(),
    };
    configureSecureStorage(commandLine, "linux", "Hyprland");
    expect(commandLine.appendSwitch).not.toHaveBeenCalled();
  });

  it.each(["GNOME", "KDE", "XFCE", "", "NotHyprland"])(
    "leaves native backend selection intact for %s",
    (desktop) => {
      const commandLine = { hasSwitch: vi.fn(() => false), appendSwitch: vi.fn() };
      configureSecureStorage(commandLine, "linux", desktop);
      expect(commandLine.appendSwitch).not.toHaveBeenCalled();
    },
  );

  it.each(["darwin", "win32"] as const)("does not change %s storage", (platform) => {
    const commandLine = { hasSwitch: vi.fn(() => false), appendSwitch: vi.fn() };
    configureSecureStorage(commandLine, platform, "Hyprland");
    expect(commandLine.appendSwitch).not.toHaveBeenCalled();
  });
});

describe("configureKeychainPolicy", () => {
  // macOS 自签构建：钥匙串 ACL 按 cdhash 授权，重装一次「始终允许」就失效
  // ⇒ 启动时必须关掉 Chromium 对系统钥匙串的依赖，否则每次启动都弹密码框。
  it("disables the system keychain on macOS", () => {
    const commandLine = { hasSwitch: vi.fn(() => false), appendSwitch: vi.fn() };
    configureKeychainPolicy(commandLine, "darwin");
    expect(commandLine.appendSwitch).toHaveBeenCalledWith("use-mock-keychain");
  });

  it.each(["linux", "win32"] as const)("leaves %s keyrings alone", (platform) => {
    const commandLine = { hasSwitch: vi.fn(() => false), appendSwitch: vi.fn() };
    configureKeychainPolicy(commandLine, platform);
    expect(commandLine.appendSwitch).not.toHaveBeenCalled();
  });

  it("preserves an explicit mock-keychain choice without duplicating it", () => {
    const commandLine = {
      hasSwitch: vi.fn((name) => name === "use-mock-keychain"),
      appendSwitch: vi.fn(),
    };
    configureKeychainPolicy(commandLine, "darwin");
    expect(commandLine.appendSwitch).not.toHaveBeenCalled();
  });
});
