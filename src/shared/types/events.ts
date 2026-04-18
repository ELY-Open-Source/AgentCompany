import type { RunStatus, SectionId, AutomationTrigger, AutomationAction } from "./enums";
import type { CommentRecord } from "./records-core";
import type { AgentMessageRecord } from "./records-extended";

export interface LogChunkEvent {
  type: "run-log";
  runId: string;
  stream: "stdout" | "stderr";
  chunk: string;
}

export interface DomainChangedEvent {
  type: "domain-changed";
}

export interface ShortcutEvent {
  type: "shortcut";
  action: "toggle-command-palette" | "refresh";
}

export interface RunStatusEvent {
  type: "run-status";
  runId: string;
  status: RunStatus;
  message: string;
}

export interface HeartbeatStatusEvent {
  type: "heartbeat-status";
  agentId: string;
  enabled: boolean;
  nextWakeAt: string | null;
}

export interface AgentMessageEvent {
  type: "agent-message";
  taskId: string;
  comment: CommentRecord;
}

export interface AutomationFiredEvent {
  type: "automation-fired";
  ruleId: string;
  ruleName: string;
  trigger: AutomationTrigger;
  action: AutomationAction;
}

export interface NewMessageEvent {
  type: "new-message";
  message: AgentMessageRecord;
}

export interface NotificationClickEvent {
  type: "notification-click";
  section: SectionId;
  entityId?: string;
}

export interface TaskUpdatedEvent {
  type: "task-updated";
  taskId: string;
  action: "created" | "updated" | "deleted";
}

export interface RunUpdatedEvent {
  type: "run-updated";
  runId: string;
  action: "created" | "status_changed" | "completed";
}

export interface ApprovalUpdatedEvent {
  type: "approval-updated";
  approvalId: string;
  action: "created" | "decided" | "deleted";
}

export interface AgentUpdatedEvent {
  type: "agent-updated";
  agentId: string;
  action: "updated" | "paused";
}

export interface BudgetChangedEvent {
  type: "budget-changed";
  companyId: string;
}

export interface ThreadWaitStateUpdatedEvent {
  type: "thread-wait-state-updated";
  threadId: string;
  companyId: string;
  waitStateId: string;
  action: "created" | "resolved";
}

export interface RecoveryNeededEvent {
  type: "recovery-needed";
  interruptedRuns: Array<{
    runId: string; taskId: string; taskTitle: string; agentId: string;
    agentName: string; companyId: string; connectorId: string; interruptedAt: string;
  }>;
}

// ─── pi-mono credentials / OAuth events ────────────────────────────────────

export type OAuthStatusValue =
  | "pending"
  | "in_progress"
  | "active"
  | "error"
  | "cancelled"
  | "completed";

export interface OAuthStatusEvent {
  type: "oauth:status";
  connectorId: string;
  status: OAuthStatusValue;
  message?: string;
  errorMessage?: string;
}

export interface OAuthAuthUrlEvent {
  type: "oauth:auth-url";
  connectorId: string;
  url: string;
  instructions?: string;
}

export interface OAuthProgressEvent {
  type: "oauth:progress";
  connectorId: string;
  message: string;
}

export interface OAuthPromptRequestEvent {
  type: "oauth:prompt-request";
  connectorId: string;
  requestId: string;
  message: string;
  placeholder?: string;
  allowEmpty?: boolean;
}

export interface OAuthManualCodeRequestEvent {
  type: "oauth:manual-code-request";
  connectorId: string;
  requestId: string;
  authUrl?: string;
  instructions?: string;
}

export interface CredentialsChangedEvent {
  type: "credentials-changed";
  connectorId?: string;
}

export interface AgentEvent {
  type: "agent-event";
  runId: string;
  agentId: string;
  companyId: string;
  taskId: string | null;
  emittedAt: string;
  event: { type: string } & Record<string, unknown>;
}

export type DesktopEvent =
  | LogChunkEvent
  | DomainChangedEvent
  | ShortcutEvent
  | RunStatusEvent
  | HeartbeatStatusEvent
  | AgentMessageEvent
  | AutomationFiredEvent
  | NewMessageEvent
  | NotificationClickEvent
  | TaskUpdatedEvent
  | RunUpdatedEvent
  | ApprovalUpdatedEvent
  | AgentUpdatedEvent
  | BudgetChangedEvent
  | ThreadWaitStateUpdatedEvent
  | RecoveryNeededEvent
  | OAuthStatusEvent
  | OAuthAuthUrlEvent
  | OAuthProgressEvent
  | OAuthPromptRequestEvent
  | OAuthManualCodeRequestEvent
  | CredentialsChangedEvent
  | AgentEvent;
