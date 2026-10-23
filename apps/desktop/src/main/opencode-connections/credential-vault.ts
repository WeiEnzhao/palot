import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { app, safeStorage } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Store from "electron-store";
import type { OpenCodeCredentialInput } from "../../shared";

interface CredentialStore {
  credentials: Record<string, string>;
}

interface CredentialStoreBackend {
  get(key: "credentials"): Record<string, string>;
  set(key: "credentials", value: Record<string, string>): void;
}

interface EncryptionAdapter {
  available(): boolean;
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
}

// 钥匙串加密在个人 Mac 上有个绕不开的坑：授权按 cdhash 走，每重新打一次包 cdhash 就变、
// 就再弹一次框（2026-10-23 securityd 日志实锤：displaying → always allow → cdhash:83f68…）。
// 文件后端和这些彻底无关：AES-256-GCM，32 字节随机密钥存 userData（0600）——和旁边
// electron-store 那份 JSON 同一个信任域，安全性同级，但不再经过钥匙串。
const FILE_KEY_MAGIC = Buffer.from("PALOT1:");
function credentialKeyFile(): string {
  const dir =
    process.env.PALOT_E2E_USER_DATA ??
    process.env.PALOT_RELEASE_SMOKE_USER_DATA ??
    app.getPath("userData");
  return join(dir, "palot-credential.key");
}
function loadOrCreateKey(): Buffer {
  const file = credentialKeyFile();
  if (existsSync(file)) {
    const saved = readFileSync(file);
    if (saved.length === 32) return saved;
  }
  const key = randomBytes(32);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, key, { mode: 0o600 });
  return key;
}
function fileEncrypt(value: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", loadOrCreateKey(), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return Buffer.concat([FILE_KEY_MAGIC, iv, body]);
}
function fileDecrypt(value: Buffer): string {
  const ivStart = FILE_KEY_MAGIC.length;
  const iv = value.subarray(ivStart, ivStart + 12);
  const body = value.subarray(ivStart + 12);
  const decipher = createDecipheriv("aes-256-gcm", loadOrCreateKey(), iv);
  decipher.setAuthTag(body.subarray(body.length - 16));
  return Buffer.concat([
    decipher.update(body.subarray(0, body.length - 16)),
    decipher.final(),
  ]).toString("utf8");
}
const hybridEncryption: EncryptionAdapter = {
  available: () => true,
  encrypt: (value) => fileEncrypt(value),
  // 带魔数前缀的走文件后端；不带的是钥匙串时代的老密文，读到时原样交给 safeStorage。
  decrypt: (value) =>
    value.subarray(0, FILE_KEY_MAGIC.length).equals(FILE_KEY_MAGIC)
      ? fileDecrypt(value)
      : safeStorage.decryptString(value),
};

export class OpenCodeCredentialVault {
  private readonly store: CredentialStoreBackend;

  constructor(
    store?: CredentialStoreBackend,
    private readonly encryption: EncryptionAdapter = hybridEncryption,
  ) {
    this.store =
      store ??
      new Store<CredentialStore>({
        name: "opencode-credentials",
        cwd: process.env.PALOT_E2E_USER_DATA ?? process.env.PALOT_RELEASE_SMOKE_USER_DATA,
        defaults: { credentials: {} },
      });
  }

  storeCredential(input: OpenCodeCredentialInput): string | null {
    if (input.type === "none") return null;
    if (!this.encryption.available()) throw new Error("Secure credential storage is unavailable");
    const id = randomUUID();
    const encrypted = this.encryption.encrypt(JSON.stringify(input)).toString("base64");
    this.store.set("credentials", { ...this.store.get("credentials"), [id]: encrypted });
    return id;
  }

  replace(previousID: string | null, input: OpenCodeCredentialInput): string | null {
    const nextID = this.storeCredential(input);
    if (previousID) this.delete(previousID);
    return nextID;
  }

  delete(credentialID: string): void {
    const credentials = { ...this.store.get("credentials") };
    delete credentials[credentialID];
    this.store.set("credentials", credentials);
  }

  headers(credentialID: string | null): Record<string, string> | undefined {
    if (!credentialID) return undefined;
    if (!this.encryption.available()) throw new Error("Secure credential storage is unavailable");
    const encoded = this.store.get("credentials")[credentialID];
    if (!encoded) throw new Error("OpenCode credentials were not found");
    const raw = Buffer.from(encoded, "base64");
    const credential = JSON.parse(this.encryption.decrypt(raw)) as OpenCodeCredentialInput;
    // 老钥匙串密文首次读到就地升级成文件格式，此后这条凭据再也不碰钥匙串。
    if (
      this.encryption === hybridEncryption &&
      !raw.subarray(0, FILE_KEY_MAGIC.length).equals(FILE_KEY_MAGIC)
    ) {
      const upgraded = { ...this.store.get("credentials") };
      upgraded[credentialID] = this.encryption
        .encrypt(JSON.stringify(credential))
        .toString("base64");
      this.store.set("credentials", upgraded);
    }
    if (credential.type === "basic") {
      return {
        authorization: `Basic ${Buffer.from(`${credential.username}:${credential.password}`).toString("base64")}`,
      };
    }
    if (credential.type === "bearer") return { authorization: `Bearer ${credential.token}` };
    if (credential.type === "headers") return { ...credential.headers };
    return undefined;
  }

  basic(credentialID: string | null): { username: string; password: string } | null {
    if (!credentialID) return null;
    const encoded = this.store.get("credentials")[credentialID];
    if (!encoded || !this.encryption.available()) return null;
    const raw = Buffer.from(encoded, "base64");
    const credential = JSON.parse(this.encryption.decrypt(raw)) as OpenCodeCredentialInput;
    // 老钥匙串密文首次读到就地升级成文件格式，此后这条凭据再也不碰钥匙串。
    if (
      this.encryption === hybridEncryption &&
      !raw.subarray(0, FILE_KEY_MAGIC.length).equals(FILE_KEY_MAGIC)
    ) {
      const upgraded = { ...this.store.get("credentials") };
      upgraded[credentialID] = this.encryption
        .encrypt(JSON.stringify(credential))
        .toString("base64");
      this.store.set("credentials", upgraded);
    }
    return credential.type === "basic"
      ? { username: credential.username, password: credential.password }
      : null;
  }
}
