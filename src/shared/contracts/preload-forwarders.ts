import { IPC_CHANNELS } from "./channels";
import type { DesktopApi } from "./desktop-api";

type DesktopFunctionKey = {
  [Key in keyof DesktopApi]: DesktopApi[Key] extends (...args: infer _Args) => unknown ? Key : never;
}[keyof DesktopApi];

type IpcChannelKey = keyof typeof IPC_CHANNELS;

export type PreloadPayloadSpec =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "single" }>
  | Readonly<{ kind: "object"; keys: readonly string[] }>;

export type PreloadForwarder = Readonly<{
  api: DesktopFunctionKey;
  channel: IpcChannelKey;
  payload: PreloadPayloadSpec;
}>;

const noPayload = { kind: "none" } as const;
const singlePayload = { kind: "single" } as const;
const objectPayload = <const Keys extends readonly string[]>(...keys: Keys) =>
  ({ kind: "object", keys } as const);
const forwardSame = <const Api extends Extract<DesktopFunctionKey, IpcChannelKey>>(
  api: Api,
  payload: PreloadPayloadSpec,
) => ({ api, channel: api, payload } as const);
const forwardAlias = <const Api extends DesktopFunctionKey, const Channel extends IpcChannelKey>(
  api: Api,
  channel: Channel,
  payload: PreloadPayloadSpec,
) => ({ api, channel, payload } as const);

export const PRELOAD_FORWARDERS = [
  forwardSame("loadSnapshot", noPayload),
  forwardSame("pickDirectory", noPayload),
  forwardSame("openPath", singlePayload),
  forwardSame("openWorkProduct", singlePayload),
  forwardSame("saveCompany", singlePayload),
  forwardSame("setCurrentCompany", singlePayload),
  forwardSame("saveConnector", singlePayload),
  forwardSame("testConnector", singlePayload),
  forwardSame("saveWorkspace", singlePayload),
  forwardSame("saveAgent", singlePayload),
  forwardSame("requestHire", singlePayload),
  forwardSame("saveGoal", singlePayload),
  forwardSame("saveProject", singlePayload),
  forwardSame("saveTask", singlePayload),
  forwardSame("requestApproval", singlePayload),
  forwardSame("decideApproval", singlePayload),
  forwardSame("startTaskRun", singlePayload),
  forwardSame("cancelRun", singlePayload),
  forwardSame("getRunLog", singlePayload),
  forwardSame("getRunLogChunk", singlePayload),
  forwardSame("backupProfile", noPayload),
  forwardSame("restoreProfile", noPayload),
  forwardSame("updateSettings", singlePayload),
  forwardSame("checkForUpdates", noPayload),
  forwardSame("deleteCompany", singlePayload),
  forwardSame("deleteAgent", singlePayload),
  forwardSame("deleteTask", singlePayload),
  forwardSame("deleteGoal", singlePayload),
  forwardSame("deleteProject", singlePayload),
  forwardSame("deleteWorkspace", singlePayload),
  forwardSame("deleteApproval", singlePayload),
  forwardSame("deleteSecret", singlePayload),
  forwardSame("listConnectorModels", singlePayload),
  forwardSame("getConnectorDisabledModels", singlePayload),
  forwardSame("setConnectorDisabledModels", singlePayload),
  forwardSame("addComment", singlePayload),
  forwardSame("setHeartbeat", singlePayload),
  forwardSame("triggerHeartbeat", singlePayload),
  forwardSame("getCompanyMetrics", singlePayload),
  forwardSame("getStandupReport", singlePayload),
  forwardSame("bootstrapOnboarding", singlePayload),
  forwardSame("checkNodeInstalled", noPayload),
  forwardSame("openTerminalCommand", singlePayload),
  forwardSame("saveSocialAccount", singlePayload),
  forwardSame("deleteSocialAccount", singlePayload),
  forwardSame("listBrowserActions", singlePayload),
  forwardSame("cancelBrowserAction", singlePayload),
  forwardSame("triggerBrowserLogin", singlePayload),
  forwardSame("saveMeeting", singlePayload),
  forwardSame("deleteMeeting", singlePayload),
  forwardSame("saveDocument", singlePayload),
  forwardSame("deleteDocument", singlePayload),
  forwardSame("saveKnowledgeEntry", singlePayload),
  forwardSame("deleteKnowledgeEntry", singlePayload),
  forwardSame("saveSprint", singlePayload),
  forwardSame("deleteSprint", singlePayload),
  forwardSame("saveAutomationRule", singlePayload),
  forwardSame("deleteAutomationRule", singlePayload),
  forwardSame("toggleAutomationRule", singlePayload),
  forwardSame("getAutomationLog", singlePayload),
  forwardSame("sendAgentMessage", singlePayload),
  forwardSame("searchMessages", singlePayload),
  forwardSame("markMessageRead", singlePayload),
  forwardSame("saveWorkflow", singlePayload),
  forwardSame("deleteWorkflow", singlePayload),
  forwardSame("runWorkflow", singlePayload),
  forwardSame("importSkill", objectPayload("companyId", "source")),
  forwardSame("listSkills", objectPayload("companyId")),
  forwardSame("getSkillDetail", objectPayload("companyId", "skillId")),
  forwardSame("getSkillMarkdown", objectPayload("companyId", "slug")),
  forwardSame("deleteSkill", objectPayload("companyId", "skillId")),
  forwardSame("assignSkillToAgent", objectPayload("companyId", "agentId", "skillId")),
  forwardSame("removeSkillFromAgent", objectPayload("companyId", "agentId", "skillId")),
  forwardSame("checkSkillUpdate", objectPayload("companyId", "skillId")),
  forwardSame("listSkillAgents", objectPayload("companyId", "skillId")),
  forwardSame("listAgentSkills", objectPayload("companyId", "agentId")),
  forwardSame("saveBudgetPolicy", singlePayload),
  forwardSame("deleteBudgetPolicy", singlePayload),
  forwardSame("listBudgetPolicies", objectPayload("companyId")),
  forwardSame("listBudgetIncidents", singlePayload),
  forwardSame("resolveBudgetIncident", singlePayload),
  forwardSame("getBudgetStatus", objectPayload("companyId")),
  forwardSame("recoveryRetry", objectPayload("taskId", "agentId", "companyId")),
  forwardSame("recoveryFail", objectPayload("taskId", "companyId")),
  forwardSame("getTask", singlePayload),
  forwardSame("getAgent", singlePayload),
  forwardSame("getRun", singlePayload),
  forwardSame("getApproval", singlePayload),
  forwardSame("getThread", singlePayload),
  forwardSame("listThreadEvents", singlePayload),
  forwardSame("listThreadWaitStates", singlePayload),
  forwardSame("listThreadParticipants", singlePayload),
  forwardAlias("listCredentials", "credentialsList", noPayload),
  forwardAlias("saveCredential", "credentialsSave", singlePayload),
  forwardAlias("removeCredential", "credentialsRemove", singlePayload),
  forwardAlias("testCredential", "credentialsTest", singlePayload),
  forwardAlias("startOAuth", "oauthStart", singlePayload),
  forwardAlias("cancelOAuth", "oauthCancel", singlePayload),
  forwardAlias("submitOAuthPrompt", "oauthPromptResponse", singlePayload),
  forwardAlias("submitOAuthManualCode", "oauthManualCodeResponse", singlePayload),
] as const satisfies readonly PreloadForwarder[];

export type PreloadForwardedMethod = (typeof PRELOAD_FORWARDERS)[number]["api"];
export type PreloadForwardedApi = Pick<DesktopApi, PreloadForwardedMethod>;

export function mapPreloadInvokeArgs(
  payload: PreloadPayloadSpec,
  args: readonly unknown[],
): readonly unknown[] {
  if (payload.kind === "none") {
    assertArgCount(payload.kind, args.length, 0);
    return [];
  }

  if (payload.kind === "single") {
    assertArgCount(payload.kind, args.length, 1);
    return [args[0]];
  }

  assertArgCount(payload.kind, args.length, payload.keys.length);
  return [Object.fromEntries(payload.keys.map((key, index) => [key, args[index]]))];
}

function assertArgCount(kind: PreloadPayloadSpec["kind"], actual: number, expected: number): void {
  if (actual !== expected) {
    throw new Error(`Invalid preload ${kind} argument count: expected ${expected}, received ${actual}`);
  }
}
