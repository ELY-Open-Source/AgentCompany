import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { safeStorage } from "electron";

export class SecretVault {
  private readonly keyPath: string;

  constructor(private readonly profileDir: string) {
    this.keyPath = join(profileDir, "vault.key");
  }

  getBackendLabel(): string {
    if (this.canUseSafeStorage()) {
      const selectedBackend = typeof safeStorage?.getSelectedStorageBackend === "function"
        ? safeStorage.getSelectedStorageBackend()
        : "platform";
      if (selectedBackend && selectedBackend !== "basic_text") {
        return `safe_storage:${selectedBackend}`;
      }
    }
    return this.allowInsecureVaultFallback() ? "vault:aes-256-gcm" : "unavailable";
  }

  encrypt(value: string): { backend: "safe_storage" | "vault"; payload: Buffer } {
    if (this.canUseSafeStorage()) {
      const selectedBackend = typeof safeStorage?.getSelectedStorageBackend === "function"
        ? safeStorage.getSelectedStorageBackend()
        : "platform";
      if (selectedBackend !== "basic_text") {
        return {
          backend: "safe_storage",
          payload: safeStorage.encryptString(value),
        };
      }
    }

    if (!this.allowInsecureVaultFallback()) {
      throw new Error("Secure secret storage is unavailable. AgentCompany requires OS-backed credential storage unless AGENTCOMPANY_ALLOW_INSECURE_VAULT=true is set for test-only environments.");
    }

    const iv = randomBytes(12);
    const key = this.ensureKey();
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      backend: "vault",
      payload: Buffer.concat([iv, tag, encrypted]),
    };
  }

  decrypt(backend: "safe_storage" | "vault", payload: Buffer): string {
    if (backend === "safe_storage") {
      if (!this.canUseSafeStorage()) {
        throw new Error("safeStorage backend is unavailable in the current runtime.");
      }
      return safeStorage.decryptString(payload);
    }
    const key = this.ensureKey();
    const iv = payload.subarray(0, 12);
    const tag = payload.subarray(12, 28);
    const encrypted = payload.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  }

  private ensureKey(): Buffer {
    mkdirSync(this.profileDir, { recursive: true });
    if (!existsSync(this.keyPath)) {
      const nextKey = randomBytes(32);
      writeFileSync(this.keyPath, nextKey);
      chmodSync(this.keyPath, 0o600);
      return nextKey;
    }
    return readFileSync(this.keyPath);
  }

  private canUseSafeStorage() {
    return typeof safeStorage?.isEncryptionAvailable === "function" && safeStorage.isEncryptionAvailable();
  }

  private allowInsecureVaultFallback() {
    return (
      process.env.AGENTCOMPANY_ALLOW_INSECURE_VAULT === "true" ||
      process.env.NODE_ENV === "test" ||
      process.env.VITEST === "true"
    );
  }
}
