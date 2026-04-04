import { describe, expect, it } from "vitest";
import { buildConnectorSection } from "@main/prompt-builder/skill-injection";

describe("buildConnectorSection", () => {
  it("includes enabled model pools for ready connectors", () => {
    const section = buildConnectorSection({
      allConnectors: [
        {
          id: "codex_local",
          label: "Codex",
          status: "ready",
          enabledModels: ["gpt-5.4", "gpt-5.4-mini"],
        },
      ],
    });

    expect(section).toContain("Enabled models: gpt-5.4, gpt-5.4-mini.");
    expect(section).toContain("choose from the enabled model pool");
  });

  it("does not render disabled models in the connector section", () => {
    const section = buildConnectorSection({
      allConnectors: [
        {
          id: "codex_local",
          label: "Codex",
          status: "ready",
          enabledModels: ["gpt-5.4"],
        },
      ],
    });

    expect(section).toContain("Enabled models: gpt-5.4.");
    expect(section).not.toContain("gpt-5.4-mini");
  });

  it("omits ready connectors whose enabled pool is empty", () => {
    const section = buildConnectorSection({
      allConnectors: [
        {
          id: "codex_local",
          label: "Codex",
          status: "ready",
          enabledModels: [],
        },
      ],
    });

    expect(section).toBeNull();
  });
});
