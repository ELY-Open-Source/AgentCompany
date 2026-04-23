import { describe, expect, it } from "vitest";
import { approvalTypeEnum } from "../../src/shared/types/enums";
import { COFOUNDER_MANDATORY_APPROVAL_TYPES } from "../../src/main/execution-policy";
import { EVAL_SCENARIO_MATRIX, buildMatrixPrompt } from "./scenario-contract.js";

describe("approval API prompt contract", () => {
  it("renders every schema approval type and every Co-Founder mandatory review type", () => {
    const managerScenario = EVAL_SCENARIO_MATRIX.find((entry) => entry.audience === "manager");
    if (!managerScenario) {
      throw new Error("Expected at least one manager eval scenario.");
    }

    const prompt = buildMatrixPrompt(managerScenario);

    for (const approvalType of approvalTypeEnum.options) {
      expect(prompt).toContain(approvalType);
    }
    expect(prompt).toContain("Co-Founder mandatory review types:");
    for (const approvalType of COFOUNDER_MANDATORY_APPROVAL_TYPES) {
      expect(prompt).toContain(`- ${approvalType}`);
    }
  });
});
