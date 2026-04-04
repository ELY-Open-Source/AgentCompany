export type SectionId =
  | "overview"
  | "inbox"
  | "standup"
  | "performance"
  | "runs"
  | "connectors"
  | "agents"
  | "orgchart"
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

export type ConnectorId =
  | "codex_local"
  | "claude_local"
  | "claude_compatible"
  | "claude_compat_2"
  | "claude_compat_3"
  | "claude_compat_4"
  | "claude_compat_5"
  | "claude_compat_6"
  | "claude_compat_7"
  | "claude_compat_8"
  | "claude_compat_9"
  | "claude_compat_10"
  | "gemini_local";

export type ConnectorStatus =
  | "not_installed"
  | "detected"
  | "auth_required"
  | "ready"
  | "degraded"
  | "error";

export type SenderKind = "agent" | "human" | "system";

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
export type GoalStatus = "planned" | "active" | "achieved" | "cancelled";
export type ProjectStatus = "backlog" | "planned" | "in_progress" | "completed" | "cancelled";
export type TaskStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done" | "blocked" | "cancelled";
export type ApprovalState = "pending" | "approved" | "rejected" | "revision_requested";
export type ApprovalType =
  | "hire_agent"
  | "approve_ceo_strategy"
  | "dangerous_command"
  | "secret_access"
  | "budget_request"
  | "promotion"
  | "termination"
  | "vendor_approval"
  | "document_review"
  | "production_deploy"
  | "incident_escalation"
  | "social_post"
  | "deliverable_review"
  | "budget_override"
  | "plan_review"
  | "scope_review"
  | "draft_review"
  | "strategy_review"
  | "exception_review";
export type RunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "interrupted";

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

export type BudgetAlertLevel = "warn" | "hard_stop";

export type SkillSourceType = "github" | "local_path" | "url" | "skills_sh" | "managed";
export type TrustLevel = "markdown_only" | "assets" | "scripts_executables";

export type SocialPlatform = "twitter" | "linkedin" | "instagram" | "facebook" | "reddit" | "youtube" | "tiktok" | "bluesky" | "other";
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

export type AutomationTrigger =
  | "task_status_changed"
  | "task_created"
  | "task_blocked"
  | "task_reassigned"
  | "run_completed"
  | "run_failed"
  | "approval_created"
  | "approval_resolved"
  | "budget_threshold"
  | "agent_idle"
  | "comment_posted"
  | "document_created"
  | "schedule"
  | "hire_approved"
  | "sprint_started"
  | "sprint_ended";

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

export type WorkProductType = "preview_url" | "pull_request" | "branch" | "commit" | "artifact" | "document" | "runtime_service";
export type WorkProductStatus = "active" | "ready_for_review" | "approved" | "changes_requested" | "merged" | "closed" | "failed" | "archived" | "draft";
export type WorkProductReviewState = "none" | "needs_board_review" | "approved" | "changes_requested";

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
