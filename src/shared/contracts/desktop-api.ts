// DesktopApi composition. Flat shape is preserved via intersection of sub-APIs;
// external `window.agentCompany` callers stay unchanged. Per-domain declarations
// live in `./desktop-api/*.ts`.

import type { AgentsApi } from "./desktop-api/agents";
import type { ApprovalsApi } from "./desktop-api/approvals";
import type { AutomationApi } from "./desktop-api/automation";
import type { BudgetApi } from "./desktop-api/budget";
import type { CommunicationApi } from "./desktop-api/communication";
import type { CompaniesApi } from "./desktop-api/companies";
import type { CredentialsApi } from "./desktop-api/credentials";
import type { RunsApi } from "./desktop-api/runs";
import type { SkillsApi } from "./desktop-api/skills";
import type { TasksApi } from "./desktop-api/tasks";
import type { ThreadsApi } from "./desktop-api/threads";
import type { WindowApi } from "./desktop-api/window";

export type {
  DesktopResult,
  SaveTaskResult,
  RunEventRecord,
  HeartbeatPolicy,
} from "./desktop-api/common";

export type {
  AgentsApi,
  ApprovalsApi,
  AutomationApi,
  BudgetApi,
  CommunicationApi,
  CompaniesApi,
  CredentialsApi,
  RunsApi,
  SkillsApi,
  TasksApi,
  ThreadsApi,
  WindowApi,
};

export type DesktopApi =
  & CompaniesApi
  & AgentsApi
  & TasksApi
  & RunsApi
  & ApprovalsApi
  & CommunicationApi
  & ThreadsApi
  & CredentialsApi
  & SkillsApi
  & BudgetApi
  & AutomationApi
  & WindowApi;
