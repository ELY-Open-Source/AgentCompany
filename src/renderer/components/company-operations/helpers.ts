export const documentTypeOptions = [
  "prd",
  "technical_spec",
  "design_doc",
  "test_plan",
  "post_mortem",
  "meeting_notes",
  "budget_proposal",
  "hiring_requisition",
  "performance_review_doc",
  "sop",
  "knowledge_article",
  "project_brief",
  "sprint_report",
  "incident_report",
  "onboarding_guide",
  "architecture_decision",
  "status_report",
  "contract",
  "proposal",
].map((value) => ({ value, label: value.replaceAll("_", " ") }));

export const documentStatusOptions = ["draft", "in_review", "approved", "archived", "superseded"].map((value) => ({
  value,
  label: value.replaceAll("_", " "),
}));

export const knowledgeCategoryOptions = [
  "lesson_learned",
  "best_practice",
  "decision",
  "process",
  "technical",
  "business",
  "onboarding",
  "incident",
].map((value) => ({ value, label: value.replaceAll("_", " ") }));

export const importanceOptions = ["critical", "high", "medium", "low"].map((value) => ({ value, label: value }));

export const meetingTypeOptions = [
  "standup",
  "sprint_planning",
  "sprint_review",
  "retrospective",
  "one_on_one",
  "all_hands",
  "department_sync",
  "incident_review",
  "hiring_committee",
  "budget_review",
  "design_review",
  "architecture_review",
].map((value) => ({ value, label: value.replaceAll("_", " ") }));

export const meetingStatusOptions = ["scheduled", "in_progress", "completed", "cancelled"].map((value) => ({ value, label: value.replaceAll("_", " ") }));
export const sprintStatusOptions = ["planning", "active", "review", "completed", "cancelled"].map((value) => ({ value, label: value }));

export function splitTags(value: string) {
  return JSON.stringify(value.split(",").map((item) => item.trim()).filter(Boolean));
}

export function parseTags(value: string) {
  try {
    const tags = JSON.parse(value) as string[];
    return tags.join(", ");
  } catch {
    return "";
  }
}

export function parseParticipantIds(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

import type { AgentRecord } from "@shared/types";

export function formatParticipantIds(raw: string, agents: AgentRecord[]) {
  try {
    const ids = JSON.parse(raw) as string[];
    return ids
      .map((id) => agents.find((agent) => agent.id === id)?.name ?? id.slice(0, 8))
      .join(", ");
  } catch {
    return "";
  }
}
