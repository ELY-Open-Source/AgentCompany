import { z } from "zod";

export type SectionId =
  | "overview"
  | "inbox"
  | "standup"
  | "performance"
  | "runs"
  | "connectors"
  | "agents"
  | "hiring"
  | "goals"
  | "projects"
  | "tasks"
  | "approvals"
  | "costs"
  | "activity"
  | "workspaces"
  | "social"
  | "skills"
  | "automation"
  | "communication"
  | "documents"
  | "knowledge"
  | "meetings"
  | "sprints"
  | "settings";

/**
 * Pure pi-mono connector catalog ids. Five OAuth, eighteen API-key, three
 * cloud — see `src/main/connector-definitions.ts`. The id is what the UI, the
 * database `connectors` table, and the worker resolver all key on.
 *
 * Single source of truth: derived from the `connectorIdEnum` zod enum in
 * `contracts/schemas-company.ts`. Adding a connector requires editing the zod
 * enum only; the TS union updates automatically.
 */
export type { ConnectorId } from "../contracts/schemas-company";

export type ConnectorStatus =
  | "not_installed"
  | "detected"
  | "auth_required"
  | "ready"
  | "degraded"
  | "error";

export type TaskType = "code" | "research" | "content" | "management" | "general";

export type WorkspaceState = "ready" | "busy" | "blocked" | "missing" | "error";
export type CompanyStatus = "active" | "paused" | "archived";
export type ExecutionMode = "ai_ceo" | "ai_cofounder";
export type AgentStatus =
  | "idle"
  | "active"
  | "running"
  | "paused"
  | "error"
  | "pending_approval"
  | "terminated";

/**
 * Hierarchical role seniority. Used by prompt generation, skill auto-assign,
 * and other "am I a manager?" decisions to avoid substring-matching English
 * role strings like "chief" / "vp" / "manager". `role` remains a free-text
 * field that users can edit in the UI.
 */
export type AgentRoleLevel = "ic" | "lead" | "manager" | "director" | "vp" | "c_suite";

export const AGENT_ROLE_LEVELS: readonly AgentRoleLevel[] = [
  "ic", "lead", "manager", "director", "vp", "c_suite",
] as const;

/** Levels that grant leadership-style prompts and cross-team visibility. */
export const LEADERSHIP_LEVELS: readonly AgentRoleLevel[] = [
  "lead", "manager", "director", "vp", "c_suite",
] as const;

export function isLeadershipLevel(level: AgentRoleLevel | null | undefined): boolean {
  return level != null && level !== "ic";
}

/**
 * Three-dimensional capability axes used by the model dispatcher. We compress
 * the marketing five ("architecture / coding / writing / math / research")
 * into three because the first, fourth and fifth collapse into a single
 * reasoning axis empirically — a model that can design an RFC, do the math,
 * and read a paper is the same model. Writing and coding stay separate
 * because the rankings between top providers diverge there.
 */
export type TaskDomain = "reasoning" | "coding" | "writing";

/**
 * Difficulty tier. Agents whose work is routine tagging, formatting, or
 * summarization are `trivial` and should burn the cheapest model that
 * clears the domain threshold. `hard` is for architecture/audit/research —
 * send the strongest model the user has enabled.
 */
export type TaskTier = "trivial" | "standard" | "hard";

/**
 * Run-time model routing for an agent.
 *   - `explicit`: use the agent.connectorId + agent.model pair the user
 *                 saved. This was the pre-v39 behavior; existing rows stay
 *                 here on migration so nothing silently re-routes.
 *   - `auto`:     ignore agent.connectorId/model; the dispatcher picks the
 *                 cheapest enabled model that clears the agent's inferred
 *                 task profile. Default for newly created agents.
 */
export type AgentModelStrategy = "explicit" | "auto";

export type GoalStatus = "planned" | "active" | "achieved" | "cancelled";
export type ProjectStatus = "backlog" | "planned" | "in_progress" | "completed" | "cancelled";
export type TaskStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done" | "blocked" | "cancelled";
export type ApprovalState = "pending" | "approved" | "rejected" | "revision_requested";
export const approvalTypeEnum = z.enum([
  "hire_agent",
  "approve_ceo_strategy",
  "dangerous_command",
  "secret_access",
  "budget_request",
  "promotion",
  "termination",
  "vendor_approval",
  "document_review",
  "production_deploy",
  "incident_escalation",
  "social_post",
  "deliverable_review",
  "budget_override",
  "plan_review",
  "scope_review",
  "draft_review",
  "strategy_review",
  "exception_review",
]);

export type ApprovalType = z.infer<typeof approvalTypeEnum>;
export type RunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "interrupted";

export const RUN_USAGE_STATUSES = [
  "ok",
  "pre_first_message",
  "error_stop",
  "aborted_before_usage",
] as const;

export type RunUsageStatus = (typeof RUN_USAGE_STATUSES)[number];

export type DepartmentId =
  | "executive"
  | "engineering"
  | "product"
  | "marketing"
  | "sales"
  | "hr"
  | "finance"
  | "legal"
  | "operations"
  | "customer_support"
  | "research"
  | "design";

export type SkillSourceType = "github" | "local_path" | "url" | "skills_sh" | "managed";
export type TrustLevel = "markdown_only" | "assets" | "scripts_executables";

export type SocialPlatform =
  | "twitter"
  | "linkedin"
  | "instagram"
  | "facebook"
  | "reddit"
  | "youtube"
  | "tiktok"
  | "bluesky"
  | "discord"
  | "threads"
  | "pinterest"
  | "telegram"
  | "whatsapp"
  | "wechat"
  | "weibo"
  | "xiaohongshu"
  | "douyin"
  | "bilibili"
  | "zhihu"
  | "other";
export type SocialAccountStatus = "active" | "logged_in" | "login_required" | "suspended" | "paused";
export type BrowserActionType = "post" | "reply" | "like" | "follow" | "browse_feed" | "screenshot" | "navigate" | "search";
export type BrowserActionStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "approval_required";

export type MeetingType =
  | "standup"
  | "sprint_planning"
  | "sprint_review"
  | "retrospective"
  | "one_on_one"
  | "all_hands"
  | "department_sync"
  | "incident_review"
  | "hiring_committee"
  | "budget_review"
  | "design_review"
  | "architecture_review";

export type MeetingStatus = "scheduled" | "in_progress" | "completed" | "cancelled";

export type DocumentType =
  | "prd"
  | "technical_spec"
  | "design_doc"
  | "test_plan"
  | "post_mortem"
  | "meeting_notes"
  | "budget_proposal"
  | "hiring_requisition"
  | "performance_review_doc"
  | "sop"
  | "knowledge_article"
  | "project_brief"
  | "sprint_report"
  | "incident_report"
  | "onboarding_guide"
  | "architecture_decision"
  | "status_report"
  | "contract"
  | "proposal";

export type DocumentStatus = "draft" | "in_review" | "approved" | "archived" | "superseded";

export type {
  WorkProductType,
  WorkProductProvider,
  WorkProductStatus,
  WorkProductReviewState,
} from "../contracts/schemas-work-products";

export type KnowledgeCategory =
  | "lesson_learned"
  | "best_practice"
  | "decision"
  | "process"
  | "technical"
  | "business"
  | "onboarding"
  | "incident";

export type SprintStatus = "planning" | "active" | "review" | "completed" | "cancelled";

/**
 * Single source of truth: `automationTriggerEnum` in `contracts/helpers.ts`.
 * Shared by `automationRuleInputSchema` and `workflowInputSchema`.
 */
export type { AutomationTrigger } from "../contracts/helpers";

export type AutomationAction =
  | "assign_task"
  | "create_task"
  | "notify_agent"
  | "send_message"
  | "trigger_heartbeat"
  | "create_approval"
  | "update_task_status"
  | "escalate_to_manager"
  | "cross_department_notify"
  | "schedule_meeting"
  | "create_document"
  | "auto_approve"
  | "reassign_task"
  | "run_task";

export type AutomationStatus = "active" | "paused" | "disabled" | "error";

export type MessageChannel = "direct" | "department" | "company" | "project" | "incident";
export type MessagePriority = "urgent" | "normal" | "low";

export type WorkflowStatus = "draft" | "active" | "paused" | "completed" | "failed";


export type InboxItemType = "pending_approval" | "failed_run" | "budget_warning" | "blocked_task" | "review_needed" | "agent_message";

export type ThreadType = "task" | "approval" | "general" | "announcement";
export type ThreadEventType =
  | "message"
  | "status_change"
  | "approval_request"
  | "approval_decision"
  | "file_attachment"
  | "system_note";
export type ThreadActorType = "agent" | "user" | "system";
export type ThreadParticipantRole = "owner" | "member" | "observer";
export type ThreadWaitingFor = "user_review" | "user_approval" | "user_reply";
export type ThreadNotifyOn = "all" | "mentions" | "none";
