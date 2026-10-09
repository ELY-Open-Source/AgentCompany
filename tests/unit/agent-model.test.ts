import { describe, expect, it } from "vitest";
import { agentModel, defaultModelReach } from "../../src/shared/agent-model";
import { effectiveModel } from "../../src/main/services/task-run-preparation";

describe("agent model", () => {
  it("names the model in effect and where it comes from", () => {
    expect(agentModel("gpt-6", "gpt-5")).toEqual({ model: "gpt-6", source: "agent" });
    expect(agentModel("  ", "gpt-5")).toEqual({ model: "gpt-5", source: "provider_default" });
    expect(agentModel(null, null)).toEqual({ model: null, source: "none" });
    // Runs start with exactly the model the UI shows.
    expect(effectiveModel(" gpt-6 ", "gpt-5")).toBe("gpt-6");
    expect(effectiveModel(null, "gpt-5")).toBe("gpt-5");
  });

  it("counts the agents a default-model change reaches", () => {
    const agents = [
      { modelProviderId: "p1", modelId: null },
      { modelProviderId: "p1", modelId: "" },
      { modelProviderId: "p1", modelId: "own" },
      { modelProviderId: "p2", modelId: null },
    ];
    expect(defaultModelReach(agents, "p1")).toEqual({ following: 2, ownModel: 1 });
  });
});
