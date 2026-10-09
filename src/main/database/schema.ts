import type { DatabaseSync } from "node:sqlite";
import { initialEnterpriseSchema } from "./migrations/001-initial";
import { collaborationProviderPolicySchema } from "./migrations/002-collaboration";
import { onboardingExecutionSchema } from "./migrations/003-onboarding";
import { filesPinnedAndScheduledPosts } from "./migrations/004-files-posts";
import { chatReadState } from "./migrations/005-chat-read-state";
import { appStateSchema } from "./migrations/006-app-state";
import { skillHardeningSchema } from "./migrations/007-skill-hardening";
import { providerHealthSchema } from "./migrations/008-provider-health";
import { socialGovernanceSchema } from "./migrations/009-social-governance";
import { fileHandoffSecuritySchema } from "./migrations/010-file-handoff-security";
import { boardInterventionSchema } from "./migrations/011-board-interventions";
import { complianceControlsSchema } from "./migrations/012-compliance-controls";
import { searchDocumentsSchema } from "./migrations/013-search-documents";
import { providerPolicyUsageSchema } from "./migrations/014-provider-policy-usage";
import { identityAccessSchema } from "./migrations/015-identity-access";
import { orgGovernanceSchema } from "./migrations/016-org-governance";
import { operationsControlsSchema } from "./migrations/017-operations-controls";
import { sdlcControlsSchema } from "./migrations/018-sdlc-controls";
import { auditReplaySchema } from "./migrations/019-audit-replay";
import { rollbackSnapshotsSchema } from "./migrations/020-rollback-snapshots";
import { providerAuthBrokerSchema } from "./migrations/021-provider-auth-broker";
import { providerRateLimitObservationSchema } from "./migrations/022-provider-rate-limit-observations";
import { providerRequestRuntimeSchema } from "./migrations/023-provider-request-runtime";
import { taskRunProviderRequestSchema } from "./migrations/024-task-run-provider-request";
import { chatMessageDeliverySchema } from "./migrations/025-chat-message-delivery";
import { browserPlatformGovernanceSchema } from "./migrations/026-browser-platform-governance";
import { socialAuditRecordsSchema } from "./migrations/027-social-audit-records";
import { migrationCutoverJournalSchema } from "./migrations/028-migration-cutover-journal";
import { fileHandoffRecordsSchema } from "./migrations/029-file-handoff-records";
import { approvalSourceRefsSchema } from "./migrations/030-approval-source-refs";
import { providerRequestWorkspaceSchema } from "./migrations/031-provider-request-workspace";
import { browserActionMetadataSchema } from "./migrations/032-browser-action-metadata";
import { auditEventImmutabilitySchema } from "./migrations/033-audit-event-immutability";
import { providerAuthSessionsSchema } from "./migrations/034-provider-auth-sessions";
import { taskRunIsolationSchema } from "./migrations/035-task-run-isolation";
import { additionalConnectorsSchema } from "./migrations/036-additional-connectors";
import { customProvidersSchema } from "./migrations/037-custom-providers";
import { providerAuthProfileCascadeSchema } from "./migrations/038-provider-auth-profile-cascade";
import { auditImmutabilityOrgTeardownSchema } from "./migrations/039-audit-immutability-org-teardown";
import { documentsKnowledgeAutomationSchema } from "./migrations/040-documents-knowledge-automation";
import { taskSubtasksDeleteSchema } from "./migrations/041-task-subtasks-delete";
import { approvalNotesMeetingsSprintsSchema } from "./migrations/042-approval-notes-meetings-sprints";
import { composioIntegrationSchema } from "./migrations/043-composio-integration";
import { mentionWakeStateSchema } from "./migrations/044-mention-wake-state";
import { connectorGrantsSchema } from "./migrations/045-connector-grants";
import { composioKeyPurgeSchema } from "./migrations/046-composio-key-purge";
import { authConfigPurgeSchema } from "./migrations/047-auth-config-purge";
import { uiPreferencesSchema } from "./migrations/048-ui-preferences";
import { avatarsSchema } from "./migrations/049-avatars";
import { financeSalesDepartmentsSchema } from "./migrations/050-finance-sales-departments";
import { purgeRuntimeSnapshotBloatSchema } from "./migrations/051-purge-runtime-snapshot-bloat";
import { avatarImagesSchema } from "./migrations/052-avatar-images";
import { autonomousPauseSchema } from "./migrations/053-autonomous-pause";
import { closeStaleWakeTasksSchema } from "./migrations/054-close-stale-wake-tasks";
import { taskOriginSchema } from "./migrations/055-task-origin";
import { kimiProvidersSchema } from "./migrations/056-kimi-providers";
import { kimiCodeProviderSchema } from "./migrations/057-kimi-code-provider";
import { integrationKeysSchema } from "./migrations/058-integration-keys";
import { taskHandoffSchema } from "./migrations/059-task-handoff";
import { chatWakeTextPurgeSchema } from "./migrations/060-chat-wake-text-purge";
import { taskRunContextSchema } from "./migrations/061-task-run-context";
import { providerContextWindowSchema } from "./migrations/062-provider-context-window";
import { knowledgeScopeSchema } from "./migrations/063-knowledge-scope";
import { knowledgeRevisionsSchema } from "./migrations/064-knowledge-revisions";
import { documentVersionsSchema } from "./migrations/065-document-versions";
import { taskWritingModeSchema } from "./migrations/066-task-writing-mode";
import { taskRunBudgetSchema } from "./migrations/067-task-run-budget";
import { taskReviewLinkSchema } from "./migrations/068-task-review-link";
import { goalStallSchema } from "./migrations/069-goal-stall";
import { runActionsSchema } from "./migrations/070-run-actions";
import { backgroundPollFailuresSchema } from "./migrations/071-background-poll-failures";
import { spendSchema } from "./migrations/072-spend";
import { usageWindowTokensSchema } from "./migrations/073-usage-window-tokens";
import { runFailureKindSchema } from "./migrations/074-run-failure-kind";
import { providerCooldownsSchema } from "./migrations/075-provider-cooldowns";
import { runPinsSchema } from "./migrations/076-run-pins";
import { modelChecksSchema } from "./migrations/077-model-checks";
import { requestErrorCodesSchema } from "./migrations/078-request-error-codes";
import { eraseRetiredCredentialsSchema } from "./migrations/079-erase-retired-credentials";
import { runCapabilityWarningsSchema } from "./migrations/080-run-capability-warnings";
import { connectorExecutionsSchema } from "./migrations/081-connector-executions";
import { connectorPendingAccountSchema } from "./migrations/082-connector-pending-account";
import { connectorAccountLabelsSchema } from "./migrations/083-connector-account-labels";
import { connectorGrantLimitsSchema } from "./migrations/084-connector-grant-limits";
import { approvalSubjectSnapshotSchema } from "./migrations/085-approval-subject-snapshot";
import { heldDeliverablesSchema } from "./migrations/086-held-deliverables";
import { goalAuditorSchema } from "./migrations/087-goal-auditor";
import { hostAccessNoteSchema } from "./migrations/088-host-access-note";
import { fileVersionsSchema } from "./migrations/089-file-versions";
import { erasureReceiptsSchema } from "./migrations/090-erasure-receipts";
import { requestPurposeSchema } from "./migrations/091-request-purpose";
import { runActionTargetsSchema } from "./migrations/092-run-action-targets";
import { taskEnqueueErrorSchema } from "./migrations/093-task-enqueue-error";

interface Migration {
  version: number;
  name: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  { version: 1, name: "initial_enterprise_schema", sql: initialEnterpriseSchema },
  { version: 2, name: "collaboration_provider_policy_schema", sql: collaborationProviderPolicySchema },
  { version: 3, name: "onboarding_execution_schema", sql: onboardingExecutionSchema },
  { version: 4, name: "files_pinned_and_scheduled_posts", sql: filesPinnedAndScheduledPosts },
  { version: 5, name: "chat_read_state", sql: chatReadState },
  { version: 6, name: "app_state", sql: appStateSchema },
  { version: 7, name: "skill_hardening", sql: skillHardeningSchema },
  { version: 8, name: "provider_health", sql: providerHealthSchema },
  { version: 9, name: "social_governance", sql: socialGovernanceSchema },
  { version: 10, name: "file_handoff_security", sql: fileHandoffSecuritySchema },
  { version: 11, name: "board_interventions", sql: boardInterventionSchema },
  { version: 12, name: "compliance_controls", sql: complianceControlsSchema },
  { version: 13, name: "search_documents", sql: searchDocumentsSchema },
  { version: 14, name: "provider_policy_usage", sql: providerPolicyUsageSchema },
  { version: 15, name: "identity_access", sql: identityAccessSchema },
  { version: 16, name: "org_governance", sql: orgGovernanceSchema },
  { version: 17, name: "operations_controls", sql: operationsControlsSchema },
  { version: 18, name: "sdlc_controls", sql: sdlcControlsSchema },
  { version: 19, name: "audit_replay", sql: auditReplaySchema },
  { version: 20, name: "rollback_snapshots", sql: rollbackSnapshotsSchema },
  { version: 21, name: "provider_auth_broker", sql: providerAuthBrokerSchema },
  { version: 22, name: "provider_rate_limit_observations", sql: providerRateLimitObservationSchema },
  { version: 23, name: "provider_request_runtime", sql: providerRequestRuntimeSchema },
  { version: 24, name: "task_run_provider_request", sql: taskRunProviderRequestSchema },
  { version: 25, name: "chat_message_delivery", sql: chatMessageDeliverySchema },
  { version: 26, name: "browser_platform_governance", sql: browserPlatformGovernanceSchema },
  { version: 27, name: "social_audit_records", sql: socialAuditRecordsSchema },
  { version: 28, name: "migration_cutover_journal", sql: migrationCutoverJournalSchema },
  { version: 29, name: "file_handoff_records", sql: fileHandoffRecordsSchema },
  { version: 30, name: "approval_source_refs", sql: approvalSourceRefsSchema },
  { version: 31, name: "provider_request_workspace", sql: providerRequestWorkspaceSchema },
  { version: 32, name: "browser_action_metadata", sql: browserActionMetadataSchema },
  { version: 33, name: "audit_event_immutability", sql: auditEventImmutabilitySchema },
  { version: 34, name: "provider_auth_sessions", sql: providerAuthSessionsSchema },
  { version: 35, name: "task_run_isolation", sql: taskRunIsolationSchema },
  { version: 36, name: "additional_connectors", sql: additionalConnectorsSchema },
  { version: 37, name: "custom_providers", sql: customProvidersSchema },
  { version: 38, name: "provider_auth_profile_cascade", sql: providerAuthProfileCascadeSchema },
  { version: 39, name: "audit_immutability_org_teardown", sql: auditImmutabilityOrgTeardownSchema },
  { version: 40, name: "documents_knowledge_automation", sql: documentsKnowledgeAutomationSchema },
  { version: 41, name: "task_subtasks_delete", sql: taskSubtasksDeleteSchema },
  { version: 42, name: "approval_notes_meetings_sprints", sql: approvalNotesMeetingsSprintsSchema },
  { version: 43, name: "composio_integration", sql: composioIntegrationSchema },
  { version: 44, name: "mention_wake_state", sql: mentionWakeStateSchema },
  { version: 45, name: "connector_grants", sql: connectorGrantsSchema },
  { version: 46, name: "composio_key_purge", sql: composioKeyPurgeSchema },
  { version: 47, name: "auth_config_purge", sql: authConfigPurgeSchema },
  { version: 48, name: "ui_preferences", sql: uiPreferencesSchema },
  { version: 49, name: "avatars", sql: avatarsSchema },
  { version: 50, name: "finance_sales_departments", sql: financeSalesDepartmentsSchema },
  { version: 51, name: "purge_runtime_snapshot_bloat", sql: purgeRuntimeSnapshotBloatSchema },
  { version: 52, name: "avatar_images", sql: avatarImagesSchema },
  { version: 53, name: "autonomous_pause", sql: autonomousPauseSchema },
  { version: 54, name: "close_stale_wake_tasks", sql: closeStaleWakeTasksSchema },
  { version: 55, name: "task_origin", sql: taskOriginSchema },
  { version: 56, name: "kimi_providers", sql: kimiProvidersSchema },
  { version: 57, name: "kimi_code_provider", sql: kimiCodeProviderSchema },
  { version: 58, name: "integration_keys", sql: integrationKeysSchema },
  { version: 59, name: "task_handoff", sql: taskHandoffSchema },
  { version: 60, name: "chat_wake_text_purge", sql: chatWakeTextPurgeSchema },
  { version: 61, name: "task_run_context", sql: taskRunContextSchema },
  { version: 62, name: "provider_context_window", sql: providerContextWindowSchema },
  { version: 63, name: "knowledge_scope", sql: knowledgeScopeSchema },
  { version: 64, name: "knowledge_revisions", sql: knowledgeRevisionsSchema },
  { version: 65, name: "document_versions", sql: documentVersionsSchema },
  { version: 66, name: "task_writing_mode", sql: taskWritingModeSchema },
  { version: 67, name: "task_run_budget", sql: taskRunBudgetSchema },
  { version: 68, name: "task_review_link", sql: taskReviewLinkSchema },
  { version: 69, name: "goal_stall", sql: goalStallSchema },
  { version: 70, name: "run_actions", sql: runActionsSchema },
  { version: 71, name: "background_poll_failures", sql: backgroundPollFailuresSchema },
  { version: 72, name: "spend", sql: spendSchema },
  { version: 73, name: "usage_window_tokens", sql: usageWindowTokensSchema },
  { version: 74, name: "run_failure_kind", sql: runFailureKindSchema },
  { version: 75, name: "provider_cooldowns", sql: providerCooldownsSchema },
  { version: 76, name: "run_pins", sql: runPinsSchema },
  { version: 77, name: "model_checks", sql: modelChecksSchema },
  { version: 78, name: "request_error_codes", sql: requestErrorCodesSchema },
  { version: 79, name: "erase_retired_credentials", sql: eraseRetiredCredentialsSchema },
  { version: 80, name: "run_capability_warnings", sql: runCapabilityWarningsSchema },
  { version: 81, name: "connector_executions", sql: connectorExecutionsSchema },
  { version: 82, name: "connector_pending_account", sql: connectorPendingAccountSchema },
  { version: 83, name: "connector_account_labels", sql: connectorAccountLabelsSchema },
  { version: 84, name: "connector_grant_limits", sql: connectorGrantLimitsSchema },
  { version: 85, name: "approval_subject_snapshot", sql: approvalSubjectSnapshotSchema },
  { version: 86, name: "held_deliverables", sql: heldDeliverablesSchema },
  { version: 87, name: "goal_auditor", sql: goalAuditorSchema },
  { version: 88, name: "host_access_note", sql: hostAccessNoteSchema },
  { version: 89, name: "file_versions", sql: fileVersionsSchema },
  { version: 90, name: "erasure_receipts", sql: erasureReceiptsSchema },
  { version: 91, name: "request_purpose", sql: requestPurposeSchema },
  { version: 92, name: "run_action_targets", sql: runActionTargetsSchema },
  { version: 93, name: "task_enqueue_error", sql: taskEnqueueErrorSchema },
];

const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export function installSchema(db: DatabaseSync): void {
  db.exec(`
    create table if not exists schema_migrations (
      version integer primary key,
      name text not null,
      applied_at text not null
    );
  `);

  const row = db.prepare("select coalesce(max(version), 0) as version from schema_migrations").get() as { version: number };
  let currentVersion = row.version;
  if (currentVersion > SCHEMA_VERSION) {
    throw new Error(`Database schema ${currentVersion} is newer than supported schema ${SCHEMA_VERSION}.`);
  }
  backfillMigrationLedger(db, currentVersion);

  for (const migration of MIGRATIONS) {
    if (currentVersion >= migration.version) continue;
    applyMigration(db, migration);
    currentVersion = migration.version;
  }
}

function applyMigration(db: DatabaseSync, migration: Migration): void {
  db.exec("begin immediate");
  try {
    db.exec(migration.sql);
    recordMigration(db, migration);
    db.exec("commit");
  } catch (error) {
    db.exec("rollback");
    throw error;
  }
}

function backfillMigrationLedger(db: DatabaseSync, currentVersion: number): void {
  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) return;
    recordMigration(db, migration);
  }
}

function recordMigration(db: DatabaseSync, migration: Migration): void {
  db.prepare("insert or ignore into schema_migrations(version, name, applied_at) values (?, ?, datetime('now'))")
    .run(migration.version, migration.name);
}
