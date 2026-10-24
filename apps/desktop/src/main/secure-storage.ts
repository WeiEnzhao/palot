/** Select the system keyring before Electron initializes safeStorage. */
export function configureSecureStorage(
  commandLine: Pick<Electron.CommandLine, "hasSwitch" | "appendSwitch">,
  platform = process.platform,
  desktop = process.env.XDG_CURRENT_DESKTOP,
): void {
  if (platform !== "linux" || commandLine.hasSwitch("password-store")) return;
  // Chromium does not recognize Hyprland and otherwise selects basic_text,
  // even when a working Secret Service keyring is available on the session bus.
  if (desktop?.split(":").some((name) => name.trim().toLowerCase() === "hyprland")) {
    commandLine.appendSwitch("password-store", "gnome-libsecret");
  }
}

/**
 * macOS：Chromium 的 OSCrypt 主密钥放在登录钥匙串里（`<App> Safe Storage` /
 * acct `<App> Key`），每次初始化都要向钥匙串要它。自签证书签名的构建没有 Team ID，
 * 钥匙串 ACL 是按 **cdhash** 授权的（2026-10-23 securityd 日志实测：
 * displaying → always allow → cdhash:83f68…）⇒ 每重新打一次包 cdhash 就变，
 * 「始终允许」只对当次那个构建有效，于是每次启动都弹「输入钥匙串密码」。
 * 2026-10-25 用户明确选择彻底关掉这条依赖。
 *
 * `use-mock-keychain` 让 Chromium 用进程内固定密钥代替钥匙串：
 * · 不再有任何钥匙串弹窗（本函数存在的唯一目的）；
 * · 代价 = cookie / 表单密码的加密降级为「固定密钥」，本机其他程序理论上可解
 *   （与旁边 electron-store 那份 JSON 同一信任级别）；
 * · 已用真钥匙串密钥加密的旧 Cookies 会解不开 —— 内嵌浏览器需要重新登录一次。
 * opencode 连接凭据不受影响：那条走 credential-vault 的文件后端（独立 0600 密钥）。
 */
export function configureKeychainPolicy(
  commandLine: Pick<Electron.CommandLine, "hasSwitch" | "appendSwitch">,
  platform = process.platform,
): void {
  if (platform !== "darwin" || commandLine.hasSwitch("use-mock-keychain")) return;
  commandLine.appendSwitch("use-mock-keychain");
}
