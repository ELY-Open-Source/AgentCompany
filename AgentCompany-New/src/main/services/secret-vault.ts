import { safeStorage } from "electron";

export class SecretVault {
  encryptSecret(secret: string): Buffer {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("OS credential encryption is unavailable.");
    }
    return safeStorage.encryptString(secret);
  }

  decryptSecret(ciphertext: Buffer): string {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("OS credential encryption is unavailable.");
    }
    return safeStorage.decryptString(ciphertext);
  }
}
