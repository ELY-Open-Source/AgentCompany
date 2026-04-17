import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { safeStorage } from "electron";

export class SecretVault {
  private readonly keyPath: string;

  constructor(private readonly profileDir: string) {
    this.keyPath = join(profileDir, "vault.key");
  }

  getBackendLabel(): string {
    const info = this.getBackendInfo();
    switch (info.kind) {
      case "safe_storage":
        return info.backend ? `safe_storage:${info.backend}` : "safe_storage";
      case "vault":
        return info.backend ? `vault:${info.backend}` : "vault";
      case "unavailable":
        return "unavailable";
    }
  }

  /** Structured view of the active backend. Prefer this over the string form
   * (`getBackendLabel`) when the caller needs to branch on kind vs algorithm. */
  getBackendInfo(): { kind: "safe_storage" | "vault" | "unavailable"; backend?: string } {
    if (this.canUseSafeStorage()) {
      const selectedBackend = typeof safeStorage?.getSelectedStorageBackend === "function"
        ? safeStorage.getSelectedStorageBackend()
        : "platform";
      if (selectedBackend && selectedBackend !== "basic_text") {
        return { kind: "safe_storage", backend: selectedBackend };
      }
    }
    if (this.allowInsecureVaultFallback()) {
      return { kind: "vault", backend: "aes-256-gcm" };
    }
    return { kind: "unavailable" };
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
    try {
      const fd = openSync(this.keyPath, "wx", 0o600);
      const nextKey = randomBytes(32);
      writeSync(fd, nextKey);
      closeSync(fd);
      return nextKey;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        return readFileSync(this.keyPath);
      }
      throw err;
    }
  }

  private canUseSafeStorage() {
    return typeof safeStorage?.isEncryptionAvailable === "function" && safeStorage.isEncryptionAvailable();
  }

  private allowInsecureVaultFallback() {
    return process.env.AGENTCOMPANY_ALLOW_INSECURE_VAULT === "true";
  }
}
