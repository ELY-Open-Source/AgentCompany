import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  IPC_CHANNELS,
  PRELOAD_FORWARDERS,
  mapPreloadInvokeArgs,
  type PreloadPayloadSpec,
} from "../../src/shared/contracts";

describe("preload forwarders", () => {
  it("keeps API methods and IPC channels unique", () => {
    const apiNames = new Set<string>();
    const channelNames = new Set<string>();
    const ipcChannelKeys = new Set(Object.keys(IPC_CHANNELS));

    for (const forwarder of PRELOAD_FORWARDERS) {
      expect(ipcChannelKeys.has(forwarder.channel)).toBe(true);
      expect(apiNames.has(forwarder.api)).toBe(false);
      expect(channelNames.has(forwarder.channel)).toBe(false);
      apiNames.add(forwarder.api);
      channelNames.add(forwarder.channel);
    }
  });

  it("maps zero, single, and object payloads", () => {
    const noArgs = PRELOAD_FORWARDERS.find((forwarder) => forwarder.api === "loadSnapshot");
    const singleArg = PRELOAD_FORWARDERS.find((forwarder) => forwarder.api === "openPath");
    const objectArg = PRELOAD_FORWARDERS.find((forwarder) => forwarder.api === "importSkill");

    expect(noArgs).toBeDefined();
    expect(singleArg).toBeDefined();
    expect(objectArg).toBeDefined();

    expect(mapPreloadInvokeArgs(noArgs!.payload, [])).toEqual([]);
    expect(mapPreloadInvokeArgs(singleArg!.payload, ["/tmp/output"])).toEqual(["/tmp/output"]);
    expect(mapPreloadInvokeArgs(objectArg!.payload, ["company-1", "/skills/local"])).toEqual([
      { companyId: "company-1", source: "/skills/local" },
    ]);
  });

  it("rejects payload arity drift", () => {
    const payload: PreloadPayloadSpec = { kind: "object", keys: ["companyId", "skillId"] };

    expect(() => mapPreloadInvokeArgs(payload, ["company-1"])).toThrow(
      "Invalid preload object argument count: expected 2, received 1",
    );
  });

  it("keeps preload invoking through the shared registry", () => {
    const preloadSource = readFileSync(join(process.cwd(), "src/preload/index.ts"), "utf8");
    const staticChannelAccesses = [...preloadSource.matchAll(/IPC_CHANNELS\.([A-Za-z0-9_]+)/g)]
      .map((match) => match[1]);

    expect(staticChannelAccesses.sort()).toEqual([
      "rendererEvent",
      "rendererEvent",
      "windowClose",
      "windowIsMaximized",
      "windowMaximize",
      "windowMinimize",
    ]);
  });
});
