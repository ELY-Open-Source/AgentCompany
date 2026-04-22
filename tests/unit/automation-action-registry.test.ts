import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AUTOMATION_ACTION_HANDLERS } from "../../src/main/automation/automation-actions";
import {
  ACTION_SCHEMAS,
  AUTOMATION_ACTIONS,
  WORKFLOW_ACTIONS,
  isAutomationAction,
  parseActionConfig,
} from "../../src/main/automation/automation-action-schemas";
import { normalizeWorkflowSteps } from "../../src/main/automation/automation-workflow";

describe("automation action registry", () => {
  it("drives schemas, workflow validation, and execution handlers from one action set", () => {
    const actionNames = [...AUTOMATION_ACTIONS].sort();
    expect([...WORKFLOW_ACTIONS].sort()).toEqual(actionNames);
    expect(Object.keys(ACTION_SCHEMAS).sort()).toEqual(actionNames);
    expect(Object.keys(AUTOMATION_ACTION_HANDLERS).sort()).toEqual(actionNames);

    for (const action of AUTOMATION_ACTIONS) {
      expect(isAutomationAction(action)).toBe(true);
      expect(AUTOMATION_ACTION_HANDLERS[action]).toEqual(expect.any(Function));
      expect(() => parseActionConfig(action, "{}")).not.toThrow();
      expect(normalizeWorkflowSteps([{ action, configJson: "{}" }])[0]).toMatchObject({
        action,
        status: "pending",
      });
    }
  });

  it("rejects unsupported workflow actions before execution", () => {
    expect(isAutomationAction("unknown_action")).toBe(false);
    expect(() => normalizeWorkflowSteps([{ action: "unknown_action" }])).toThrow(
      'Workflow step 1 has unsupported action "unknown_action".',
    );
  });

  it("keeps automation execution table-driven", () => {
    const dispatchSource = readFileSync(join(process.cwd(), "src/main/automation/automation-actions.ts"), "utf8");
    const handlerSource = readFileSync(join(process.cwd(), "src/main/automation/automation-action-handlers.ts"), "utf8");

    expect(dispatchSource).not.toContain("switch (action)");
    expect(handlerSource).not.toContain("switch (action)");
    expect(dispatchSource).toContain("AUTOMATION_ACTION_HANDLERS");
    expect(handlerSource).toContain("satisfies Record<AutomationAction, AutomationActionHandler>");
  });
});
