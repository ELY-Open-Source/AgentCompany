import { z } from "zod";
import type * as C from "../../../shared/commands";
import { INTEGRATION_KEY_NAMES } from "../../../shared/commands";
import { COMPLIANCE_EXPORT_TYPE } from "../../../shared/compliance-domain";
import { SOCIAL_PLATFORM } from "../../../shared/domain";
import { PROVIDER_DATA_POLICY, PROVIDER_EXECUTION_MODE } from "../../../shared/provider-policy-domain";
import { SEARCH_ENTITY_TYPES } from "../../../shared/search-domain";

const id = z.string();
const nullableId = z.string().nullable();
const providerResponse = z.strictObject({
  orgId: id, providerId: id, workspaceId: nullableId.optional(), prompt: z.string(), instructions: z.string().nullable(),
  executionMode: z.enum(PROVIDER_EXECUTION_MODE).optional(),
}) satisfies z.ZodType<C.CreateProviderResponseInput>;

export const platformContracts = {
  setIntegrationKey: z.strictObject({ name: z.enum(INTEGRATION_KEY_NAMES), value: z.string() }) satisfies z.ZodType<C.SetIntegrationKeyInput>,
  clearIntegrationKey: z.strictObject({ name: z.enum(INTEGRATION_KEY_NAMES) }) satisfies z.ZodType<C.ClearIntegrationKeyInput>,
  saveProviderCredential: z.strictObject({ orgId: id, providerId: id, secret: z.string(), model: z.string().nullable() }) satisfies z.ZodType<C.SaveProviderCredentialInput>,
  setProviderModel: z.strictObject({ orgId: id, providerId: id, model: z.string().max(200) }) satisfies z.ZodType<C.SetProviderModelInput>,
  revokeProviderCredential: z.strictObject({ orgId: id, providerId: id }) satisfies z.ZodType<C.RevokeProviderCredentialInput>,
  startProviderOAuth: z.strictObject({
    providerKey: z.string(), enterpriseDomain: z.string().nullable().optional(), orgId: id.optional(), providerId: id.optional(),
    employeeId: id.optional(), model: z.string().nullable().optional(),
  }) satisfies z.ZodType<C.StartProviderOAuthInput>,
  cancelProviderOAuth: z.strictObject({ providerKey: z.string() }) satisfies z.ZodType<C.CancelProviderOAuthInput>,
  checkProviderHealth: z.strictObject({ orgId: id, providerId: id }) satisfies z.ZodType<C.CheckProviderHealthInput>,
  listProviderModels: z.strictObject({ providerKey: z.string(), secret: z.string().optional(), orgId: id.optional(), providerId: id.optional() }) satisfies z.ZodType<C.ListProviderModelsInput>,
  checkProviderModel: z.strictObject({ orgId: id, providerId: id, model: z.string() }),
  updateProviderPolicy: z.strictObject({
    orgId: id, providerId: id, dataPolicy: z.enum(PROVIDER_DATA_POLICY), backgroundEnabled: z.boolean(), monthlyRequestLimit: z.number(),
    workspaceScope: z.enum(["organization", "workspace"]), contextWindowTokens: z.number(),
  }) satisfies z.ZodType<C.UpdateProviderPolicyInput>,
  setProviderPrices: z.strictObject({
    orgId: id, providerId: id, inputDollarsPerMtok: z.number().nullable(), cachedInputDollarsPerMtok: z.number().nullable(), outputDollarsPerMtok: z.number().nullable(),
  }) satisfies z.ZodType<C.SetProviderPricesInput>,
  setGoalAuditor: z.strictObject({ orgId: id, providerId: id, modelId: z.string() }),
  openExternalUrl: z.string(),
  createProviderResponse: providerResponse,
  streamProviderResponse: providerResponse,
  cancelProviderResponse: z.strictObject({ orgId: id, requestId: id, providerResponseId: id.optional() }) satisfies z.ZodType<C.CancelProviderResponseInput>,
  createSocialAccount: z.strictObject({
    orgId: id, platform: z.enum(SOCIAL_PLATFORM), handle: z.string(), displayName: z.string(), createdByEmployeeId: id, authorizedEmployeeId: nullableId,
  }) satisfies z.ZodType<C.CreateSocialAccountInput>,
  launchSocialLogin: z.strictObject({ orgId: id, socialAccountId: id, employeeId: id }) satisfies z.ZodType<C.LaunchSocialLoginInput>,
  createScheduledPost: z.strictObject({
    orgId: id, socialAccountId: id, bodyMd: z.string(), scheduledFor: z.string(), createdByEmployeeId: id,
  }) satisfies z.ZodType<C.CreateScheduledPostInput>,
  setScheduledPostState: z.strictObject({
    orgId: id, scheduledPostId: id, state: z.enum(["draft", "scheduled", "published", "cancelled"]), employeeId: id,
  }) satisfies z.ZodType<C.SetScheduledPostStateInput>,
  importFile: z.strictObject({ orgId: id, spaceId: id.optional() }) satisfies z.ZodType<C.ImportFileInput>,
  openFile: z.strictObject({ orgId: id, fileId: id }) satisfies z.ZodType<C.OpenFileInput>,
  setFilePinned: z.strictObject({ orgId: id, fileId: id, pinned: z.boolean() }) satisfies z.ZodType<C.SetFilePinnedInput>,
  createMigrationReport: z.strictObject({ orgId: id, sourceDatabasePath: z.string() }) satisfies z.ZodType<C.CreateMigrationReportInput>,
  setFeatureFlag: z.strictObject({ orgId: id, flagId: id, enabled: z.boolean() }) satisfies z.ZodType<C.SetFeatureFlagInput>,
  createComplianceExport: z.strictObject({
    orgId: id, subjectType: z.enum(["employee", "agent"]), subjectId: id, exportType: z.enum(COMPLIANCE_EXPORT_TYPE), requestedByEmployeeId: id,
  }) satisfies z.ZodType<C.CreateComplianceExportInput>,
  createLegalHold: z.strictObject({
    orgId: id, entityType: z.enum(["organization", "employee", "agent", "chat_thread", "file_object"]), entityId: id, reason: z.string(), createdByEmployeeId: id,
  }) satisfies z.ZodType<C.CreateLegalHoldInput>,
  setLegalHoldState: z.strictObject({ orgId: id, legalHoldId: id, active: z.boolean(), employeeId: id }) satisfies z.ZodType<C.SetLegalHoldStateInput>,
  createRetentionFreeze: z.strictObject({
    orgId: id, scopeType: z.enum(["organization", "chat_space", "file_object"]), scopeId: id, reason: z.string(), createdByEmployeeId: id,
  }) satisfies z.ZodType<C.CreateRetentionFreezeInput>,
  setRetentionFreezeState: z.strictObject({ orgId: id, retentionFreezeId: id, active: z.boolean(), employeeId: id }) satisfies z.ZodType<C.SetRetentionFreezeStateInput>,
  connectComposioToolkit: z.strictObject({ orgId: id, toolkitSlug: z.string(), label: z.string() }) satisfies z.ZodType<C.ConnectComposioToolkitInput>,
  disconnectComposioToolkit: z.strictObject({ orgId: id, toolkitSlug: z.string(), label: z.string() }) satisfies z.ZodType<C.DisconnectComposioToolkitInput>,
  refreshComposioAccounts: z.strictObject({ orgId: id }) satisfies z.ZodType<C.RefreshComposioAccountsInput>,
  grantConnector: z.strictObject({ orgId: id, agentId: id, toolkitSlug: z.string(), accountLabel: z.string(), employeeId: id }) satisfies z.ZodType<C.GrantConnectorInput>,
  revokeConnector: z.strictObject({ orgId: id, agentId: id, toolkitSlug: z.string() }) satisfies z.ZodType<C.RevokeConnectorInput>,
  approvalDrifts: z.strictObject({ orgId: id, approvalIds: z.array(id).max(1000) }),
  runRequests: z.strictObject({ orgId: id, runId: id }),
  chatThreadHistory: z.strictObject({ orgId: id, threadId: id }),
  chatSpaceHistory: z.union([
    z.strictObject({ orgId: id, spaceId: id, beforeMessageId: id.nullable(), limit: z.number().int().min(1).max(500) }),
    z.strictObject({ orgId: id, spaceId: id, beforeMessageId: id.nullable(), fromMessageId: id }),
  ]),
  search: z.strictObject({
    orgId: id, employeeId: id, query: z.string(), entityTypes: z.array(z.enum(SEARCH_ENTITY_TYPES)).optional(), limit: z.number().optional(),
  }) satisfies z.ZodType<C.SearchInput>,
};
