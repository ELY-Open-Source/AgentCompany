import { t } from "./i18n";

/** A stored value with no label yet shows as stored and is logged, so the gap is visible instead of hidden. */
function labelOf(kind: string, labels: Record<string, string>, value: string): string {
  const label = labels[value];
  if (label !== undefined) return label;
  console.warn(`[labels] no ${kind} label for "${value}"`);
  return value;
}

const APPROVAL_KINDS: Record<string, string> = {
  task_risk: t("High-risk task"),
  task_execution: t("Workspace access"),
  agent_hire: t("Hire"),
  deliverable_review: t("Deliverable review"),
  goal_review: t("Goal review"),
  chat_escalation: t("Escalation"),
  board_force_approval: t("Board override"),
  social_publish: t("Social post"),
};
export const approvalKindLabel = (kind: string) => labelOf("approval kind", APPROVAL_KINDS, kind);

const OFFICE_ACTIVITIES: Record<string, string> = { active: t("Active"), thinking: t("Thinking"), busy: t("Busy"), idle: t("Idle") };
export const officeActivityLabel = (activity: string) => labelOf("office activity", OFFICE_ACTIVITIES, activity);

const APPROVAL_STATES: Record<string, string> = { pending: t("Pending"), approved: t("Approved"), declined: t("Declined"), superseded: t("Superseded") };
export const approvalStateLabel = (state: string) => labelOf("approval state", APPROVAL_STATES, state);

const RUN_TRIGGERS: Record<string, string> = { heartbeat: t("Heartbeat"), manual: t("Manual"), chat_mention: t("Chat mention"), bootstrap: t("Company launch") };
export const runTriggerLabel = (trigger: string) => labelOf("run trigger", RUN_TRIGGERS, trigger);

const REQUEST_STATES: Record<string, string> = { pending: t("Pending"), streaming: t("Streaming"), succeeded: t("Succeeded"), failed: t("Failed"), cancelled: t("Cancelled") };
export const requestStateLabel = (state: string) => labelOf("request state", REQUEST_STATES, state);

const RISKS: Record<string, string> = { low: t("Low"), medium: t("Medium"), high: t("High") };
export const riskLabel = (risk: string) => labelOf("risk", RISKS, risk);

const ROLE_LEVELS: Record<string, string> = { staff: t("Staff"), lead: t("Lead"), director: t("Director"), c_suite: t("C-suite") };
export const roleLevelLabel = (level: string) => labelOf("rank", ROLE_LEVELS, level);

const DOCUMENT_STATUSES: Record<string, string> = { draft: t("Draft"), review: t("In review"), approved: t("Approved"), archived: t("Archived") };
export const DOCUMENT_STATUS_VALUES = Object.keys(DOCUMENT_STATUSES);
export const documentStatusLabel = (status: string) => labelOf("document status", DOCUMENT_STATUSES, status);

const CREDENTIAL_SOURCES: Record<string, string> = { manual_secret: t("Key entered here"), provider_oauth_login: t("Signed in") };
export const credentialSourceLabel = (source: string) => labelOf("credential source", CREDENTIAL_SOURCES, source);

const TASK_EVENTS: Record<string, string> = {
  created: t("Created"), updated: t("Edited"), deleted: t("Deleted"), status_changed: t("Status changed"), stalled: t("Stalled"),
  review_requested: t("Review requested"), review_closed: t("Review closed"), blocked: t("Blocked"), unblocked: t("Unblocked"),
};
export const taskEventLabel = (action: string) => labelOf("task event", TASK_EVENTS, action);

const FILE_KINDS: Record<string, string> = { md: "Markdown", pdf: "PDF", img: t("Image"), sheet: t("Spreadsheet"), doc: t("Document"), file: t("File") };
/** Other kinds are file extensions, shown as the format name. */
export const fileKindLabel = (kind: string) => FILE_KINDS[kind] ?? kind.toUpperCase();

/** The platform's own notation, matching the keys the handlers accept (Cmd on macOS, Ctrl elsewhere). */
export function shortcutLabel(key: "K" | "Enter"): string {
  if (window.agentCompany.platform === "darwin") return key === "Enter" ? "⌘↩" : "⌘K";
  return `Ctrl+${key}`;
}
