import { describe, expect, it } from "vitest";
import {
  PI_RUNTIME_PACKAGES,
  PI_RUNTIME_VERSION,
  lockfileHasImporterPin,
  lockfileHasPackageResolution,
  lockfileHasPackageSnapshot,
  readInstalledPackage,
  readPnpmLockfile,
  readRootPackage,
} from "../support/pi-runtime-contract";

describe("pi runtime dependency contract", () => {
  it("keeps the shipping pi runtime on exact npm package pins", () => {
    const dependencies = readRootPackage().dependencies ?? {};

    for (const packageName of PI_RUNTIME_PACKAGES) {
      expect(dependencies[packageName]).toBe(PI_RUNTIME_VERSION);
      expect(dependencies[packageName]).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("keeps package.json, pnpm-lock, and installed packages on one pi runtime version", () => {
    const lockfile = readPnpmLockfile();

    for (const packageName of PI_RUNTIME_PACKAGES) {
      expect(lockfileHasImporterPin(lockfile, packageName, PI_RUNTIME_VERSION)).toBe(true);
      expect(lockfileHasPackageResolution(lockfile, packageName, PI_RUNTIME_VERSION)).toBe(true);
      expect(lockfileHasPackageSnapshot(lockfile, packageName, PI_RUNTIME_VERSION)).toBe(true);
      expect(readInstalledPackage(packageName).version).toBe(PI_RUNTIME_VERSION);
    }
  });

  it("keeps the pi API surface used by AgentCompany available", async () => {
    const [agentCore, piAi, piCodingAgent] = await Promise.all([
      import("@mariozechner/pi-agent-core"),
      import("@mariozechner/pi-ai"),
      import("@mariozechner/pi-coding-agent"),
    ]);

    expect(typeof agentCore.Agent).toBe("function");
    expect(typeof piAi.createAssistantMessageEventStream).toBe("function");
    expect(typeof piAi.getEnvApiKey).toBe("function");
    expect(typeof piAi.getModel).toBe("function");
    expect(typeof piAi.getModels).toBe("function");
    expect(typeof piAi.streamSimple).toBe("function");
    expect(typeof piAi.Type.Record).toBe("function");
    expect(typeof piCodingAgent.createCodingTools).toBe("function");
    expect(typeof piCodingAgent.loadSkills).toBe("function");
  });
});
