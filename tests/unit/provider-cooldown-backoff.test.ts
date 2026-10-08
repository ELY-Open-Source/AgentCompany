import { describe, expect, test, vi } from "vitest";
import { ProviderCooldowns } from "../../src/main/services/provider-cooldowns";

describe("provider cooldown sizing", () => {
  test("a provider-given wait is honored; otherwise parks back off and reset once a request is served", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    let now = 0;
    const cooldowns = new ProviderCooldowns(() => now);
    const provider = { id: "prv_1", label: "OpenAI" };
    const parkedFor = (): number => {
      let elapsed = 0;
      while (cooldowns.cooledProviderIds().includes(provider.id)) {
        now += 1_000;
        elapsed += 1_000;
      }
      return elapsed;
    };
    cooldowns.park(provider, "429", 45_000);
    expect(parkedFor()).toBe(45_000);
    cooldowns.park(provider, "503", null);
    expect(parkedFor()).toBe(4 * 60_000);
    cooldowns.park(provider, "503", null);
    expect(parkedFor()).toBe(8 * 60_000);
    cooldowns.clear(provider);
    cooldowns.park(provider, "503", null);
    expect(parkedFor()).toBe(2 * 60_000);
    cooldowns.park(provider, "429", 5 * 3_600_000);
    expect(parkedFor()).toBe(60 * 60_000);
    vi.restoreAllMocks();
  });
});
