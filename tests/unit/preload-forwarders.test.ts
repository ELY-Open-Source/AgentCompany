import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  IPC_CHANNELS,
  PRELOAD_FORWARDERS,
  PRELOAD_INPUT_SCHEMAS,
  mapPreloadInvokeArgs,
  type PreloadPayloadSpec,
} from "../../src/shared/contracts";

const validatedInputMethods = [
  "addComment",
  "assignSkillToAgent",
  "bootstrapOnboarding",
  "cancelBrowserAction",
  "cancelOAuth",
  "cancelRun",
  "checkSkillUpdate",
  "decideApproval",
  "deleteAgent",
  "deleteApproval",
  "deleteAutomationRule",
  "deleteBudgetPolicy",
  "deleteCompany",
  "deleteDocument",
  "deleteGoal",
  "deleteKnowledgeEntry",
  "deleteMeeting",
  "deleteProject",
  "deleteSecret",
  "deleteSkill",
  "deleteSocialAccount",
  "deleteSprint",
  "deleteTask",
  "deleteWorkflow",
  "deleteWorkspace",
  "importSkill",
  "markMessageRead",
  "openPath",
  "openTerminalCommand",
  "openWorkProduct",
  "recoveryFail",
  "recoveryRetry",
  "removeCredential",
  "removeSkillFromAgent",
  "requestApproval",
  "requestHire",
  "resolveBudgetIncident",
  "runWorkflow",
  "saveAgent",
  "saveAutomationRule",
  "saveBudgetPolicy",
  "saveCompany",
  "saveConnector",
  "saveCredential",
  "saveDocument",
  "saveGoal",
  "saveKnowledgeEntry",
  "saveMeeting",
  "saveProject",
  "saveSocialAccount",
  "saveSprint",
  "saveTask",
  "saveWorkflow",
  "saveWorkspace",
  "sendAgentMessage",
  "setConnectorDisabledModels",
  "setCurrentCompany",
  "setHeartbeat",
  "startOAuth",
  "startTaskRun",
  "submitOAuthManualCode",
  "submitOAuthPrompt",
  "testConnector",
  "testCredential",
  "toggleAutomationRule",
  "triggerBrowserLogin",
  "triggerHeartbeat",
  "updateSettings",
] as const;

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

  it("validates write and action payloads before invoking main", () => {
    const startRun = PRELOAD_FORWARDERS.find((forwarder) => forwarder.api === "startTaskRun");
    const importSkill = PRELOAD_FORWARDERS.find((forwarder) => forwarder.api === "importSkill");

    expect(startRun).toBeDefined();
    expect(importSkill).toBeDefined();

    expect(() =>
      mapPreloadInvokeArgs(startRun!.payload, [{ companyId: "bad", taskId: "bad" }], PRELOAD_INPUT_SCHEMAS.startTaskRun)
    ).toThrow();
    expect(() =>
      mapPreloadInvokeArgs(importSkill!.payload, ["company-1", ""], PRELOAD_INPUT_SCHEMAS.importSkill)
    ).toThrow();
  });

  it("keeps every preload input schema attached to a registered forwarder", () => {
    const apiNames = new Set<string>(PRELOAD_FORWARDERS.map((forwarder) => forwarder.api));

    for (const method of Object.keys(PRELOAD_INPUT_SCHEMAS)) {
      expect(apiNames.has(method)).toBe(true);
    }
  });

  it("keeps write and action preload inputs behind schemas", () => {
    expect(Object.keys(PRELOAD_INPUT_SCHEMAS).sort()).toEqual([...validatedInputMethods].sort());
  });

  it("samples read-path payload mapping without runtime schemas", () => {
    const readPathSamples = [
      { api: "getRunLog", args: [{ companyId: "bad", runId: "bad" }] },
      { api: "listSkills", args: ["bad-company"] },
      { api: "getBudgetStatus", args: ["bad-company"] },
    ] as const;

    for (const sample of readPathSamples) {
      const forwarder = PRELOAD_FORWARDERS.find((candidate) => candidate.api === sample.api);
      expect(forwarder).toBeDefined();
      expect(PRELOAD_INPUT_SCHEMAS[sample.api]).toBeUndefined();
      expect(mapPreloadInvokeArgs(forwarder!.payload, sample.args)).toHaveLength(1);
    }
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
