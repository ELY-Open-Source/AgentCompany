/**
 * Turn Context Assembly
 *
 * Extracts the run payload assembly logic from dispatchRunToWorker into
 * a single composable function. Each step (env, comments, session, skills,
 * prompt) is an isolated helper, making the pipeline testable and extensible.
 */

import { buildTaskPrompt } from "../prompt-builder";
import type { AppDatabase } from "../database";
import type { RuntimeSkillEntry } from "../skill-types";
import type { ConnectorId, ExecutionMode } from "@shared/types";
import type { WorkspaceLockMode, EnqueueRunPayload } from "./types";
import { normalizeMessagesForPrompt, normalizeCommentsForPrompt } from "../message-normalize";
import { getConnectorModelPolicy, validateConnectorModelSelection } from "../connector-model-policy";

export interface RunDispatchParams {
  runId: string;
  companyId: string;
  agent: ReturnType<AppDatabase["getAgent"]>;
  task: ReturnType<AppDatabase["getTask"]>;
  connector: ReturnType<AppDatabase["getConnector"]>;
  workspace: ReturnType<AppDatabase["getWorkspace"]>;
  workspaceMode: WorkspaceLockMode;
  companyName: string;
  companyDescription: string;
  snapshot: ReturnType<AppDatabase["listSnapshot"]>;
  trigger: string;
}

export interface TurnContextDeps {
  db: AppDatabase;
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
  getApiPort: () => number;
  createRunToken: (agentId: string, companyId: string, runId: string) => string;
  listRuntimeSkillEntries: (companyId: string, agentId: string, connectorId: string) => RuntimeSkillEntry[];
  getSessionHandoff?: (taskId: string) => string | null;
  evaluatePreRunSessionRotation?: (taskId: string, connectorId: string) => {
    rotated: boolean;
    handoff: string | null;
  };
}

function assembleApiEnv(
  db: AppDatabase,
  connector: RunDispatchParams["connector"],
  companyId: string,
  agentId: string,
  runId: string,
  trigger: string,
  deps: Pick<TurnContextDeps, "getApiPort" | "createRunToken">,
) {
  const env = db.resolveSecretEnv(connector.envBindingText, companyId);
  const apiPort = deps.getApiPort();
  const apiUrl = apiPort ? `http://127.0.0.1:${apiPort}` : "";
  const apiKey = apiUrl ? deps.createRunToken(agentId, companyId, runId) : "";

  if (apiUrl) {
    env.AGENT_COMPANY_API_URL = apiUrl;
    env.AGENT_COMPANY_API_KEY = apiKey;
    env.AGENT_COMPANY_AGENT_ID = agentId;
    env.AGENT_COMPANY_COMPANY_ID = companyId;
    env.AGENT_COMPANY_RUN_ID = runId;
    env.AGENT_COMPANY_TASK_ID = "";
    env.AGENT_COMPANY_WAKE_REASON = trigger;
  }
  return { env, apiUrl, apiKey };
}

function assembleRecentComments(
  assignedTasks: ReturnType<AppDatabase["listAgentTasks"]>,
  reviewTasks: ReturnType<AppDatabase["listAgentTasks"]>,
  snapshot: RunDispatchParams["snapshot"],
) {
  const relevantTaskIds = new Set([
    ...assignedTasks.map((t) => t.id),
    ...reviewTasks.map((t) => t.id),
  ]);
  const allRelevantTasks = [...assignedTasks, ...reviewTasks];
  return snapshot.comments
    .filter((comment) => relevantTaskIds.has(comment.taskId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 30)
    .map((comment) => ({
      taskId: comment.taskId,
      taskTitle: allRelevantTasks.find((t) => t.id === comment.taskId)?.title ?? comment.taskId,
      authorName: comment.authorName,
      body: comment.body,
      createdAt: comment.createdAt,
    }));
}

function resolveSessionHandoff(
  taskId: string,
  deps: Pick<TurnContextDeps, "getSessionHandoff" | "logger">,
): string | null {
  if (!deps.getSessionHandoff) return null;
  try {
    return deps.getSessionHandoff(taskId);
  } catch (err) {
    deps.logger.warn(`[run] Failed to load session handoff for task ${taskId}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function resolveSkills(
  companyId: string,
  agentId: string,
  connectorId: string,
  agentName: string,
  deps: Pick<TurnContextDeps, "listRuntimeSkillEntries" | "logger">,
): RuntimeSkillEntry[] {
  try {
    return deps.listRuntimeSkillEntries(companyId, agentId, connectorId);
  } catch (err) {
    deps.logger.warn(`[run] Failed to fetch managed skills for agent ${agentName}: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

function resolveEnabledConnectorModels(
  db: AppDatabase,
  connector: { id: string; model: string | null },
): string[] {
  return getConnectorModelPolicy(db, connector.id as ConnectorId).enabledModels.map((model) => model.id);
}

function resolveSession(
  db: AppDatabase,
  task: RunDispatchParams["task"],
  connectorId: string,
  sessionHandoff: string | null,
  deps: Pick<TurnContextDeps, "evaluatePreRunSessionRotation" | "logger">,
) {
  const activeSession = db.getActiveTaskSession(task.id);
  let taskSession = activeSession
    ? {
        sessionParams: activeSession.sessionParamsJson ? JSON.parse(activeSession.sessionParamsJson) as Record<string, unknown> : null,
        sessionDisplayId: activeSession.sessionDisplayId,
      }
    : db.getTaskSession(task.id);

  let finalHandoff = sessionHandoff;
  if (deps.evaluatePreRunSessionRotation && activeSession) {
    const rotationResult = deps.evaluatePreRunSessionRotation(task.id, connectorId);
    if (rotationResult.rotated) {
      taskSession = { sessionParams: null, sessionDisplayId: null };
      if (!finalHandoff && rotationResult.handoff) {
        finalHandoff = rotationResult.handoff;
      }
      deps.logger.info(`[session] Pre-run compaction for task ${task.id}: session rotated before execution`);
    }
  }

  return { taskSession, sessionHandoff: finalHandoff };
}

function extractThinkingEffort(metadataJson: string | null): string | null {
  try {
    const meta = JSON.parse(metadataJson || "{}");
    if (typeof meta.thinkingEffort === "string" && meta.thinkingEffort) {
      return meta.thinkingEffort;
    }
  } catch { /* malformed metadata */ }
  return null;
}

function filterUpcomingMeetings(
  meetings: RunDispatchParams["snapshot"]["meetings"],
  companyId: string,
  agentId: string,
) {
  return meetings
    .filter((meeting) => meeting.companyId === companyId && (meeting.status === "scheduled" || meeting.status === "in_progress"))
    .filter((meeting) => {
      try {
        const ids: string[] = JSON.parse(meeting.participantAgentIds);
        return ids.includes(agentId) || meeting.organizerAgentId === agentId;
      } catch {
        return false;
      }
    })
    .slice(0, 5);
}

function filterRelevantKnowledge(
  knowledge: RunDispatchParams["snapshot"]["knowledgeBase"],
  companyId: string,
) {
  return knowledge
    .filter((entry) => entry.companyId === companyId && (entry.importance === "critical" || entry.importance === "high"))
    .slice(0, 20);
}

function filterRecentDocuments(
  documents: RunDispatchParams["snapshot"]["documents"],
  companyId: string,
  agentId: string,
) {
  return documents
    .filter((document) => document.companyId === companyId && (document.authorAgentId === agentId || document.reviewerAgentId === agentId || document.status === "in_review"))
    .slice(0, 5);
}

function filterPendingApprovals(
  approvals: RunDispatchParams["snapshot"]["approvals"],
  companyId: string,
  agentId: string,
) {
  return approvals.filter(
    (approval) => approval.companyId === companyId &&
      approval.requestedByAgentId === agentId &&
      (approval.state === "pending" || approval.state === "revision_requested"),
  );
}

function buildConnectorCatalog(
  db: AppDatabase,
  connectors: RunDispatchParams["snapshot"]["connectors"],
) {
  return connectors
    .filter((c) => c.status === "ready")
    .filter((c) => c.id.startsWith("claude_compat") || db.hasModelPoolSettings(c.id))
    .map((c) => ({
      id: c.id,
      label: c.label,
      status: c.status,
      enabledModels: resolveEnabledConnectorModels(db, c),
    }))
    .filter((c) => c.enabledModels.length > 0);
}

/**
 * Assemble the full run payload from resolved entities and dependencies.
 * This is the core composition step that was previously inlined in dispatchRunToWorker.
 */
export function buildRunPayload(params: RunDispatchParams, deps: TurnContextDeps): EnqueueRunPayload {
  const { runId, companyId, agent, task, connector, workspace, workspaceMode, companyName, companyDescription, snapshot, trigger } = params;
  const { db } = deps;

  const { env, apiUrl, apiKey } = assembleApiEnv(db, connector, companyId, agent.id, runId, trigger, deps);
  env.AGENT_COMPANY_TASK_ID = task.id;

  const assignedTasks = db.listAgentTasks(agent.id, companyId, ["todo", "in_progress", "blocked"]);
  const reviewTasks = db.listReviewTasksForManager(agent.id, companyId);
  const recentComments = assembleRecentComments(assignedTasks, reviewTasks, snapshot);
  let sessionHandoff = resolveSessionHandoff(task.id, deps);
  const skills = resolveSkills(companyId, agent.id, connector.id, agent.name, deps);

  const skillNames = skills
    .map((s) => s.name ?? s.runtimeName)
    .filter(Boolean);

  const systemPrompt = apiUrl ? buildTaskPrompt({
    agent,
    apiUrl,
    apiKey,
    runId,
    task,
    companyName,
    locale: snapshot.locale,
    executionMode: db.getCompanyExecutionMode(companyId) as ExecutionMode,
    goals: snapshot.goals.filter((goal) => goal.companyId === companyId),
    projects: snapshot.projects.filter((project) => project.companyId === companyId),
    directReports: db.getDirectReports(agent.id, companyId),
    chainOfCommand: db.getChainOfCommand(agent.id),
    assignedTasks,
    allAgents: snapshot.agents.filter((entry) => entry.companyId === companyId),
    pendingApprovals: filterPendingApprovals(snapshot.approvals, companyId, agent.id),
    tasksAwaitingReview: reviewTasks,
    wakeReason: trigger,
    allTasks: snapshot.tasks.filter((entry) => entry.companyId === companyId),
    recentComments: normalizeCommentsForPrompt(recentComments),
    companyDescription,
    socialAccounts: db.listSocialAccounts(companyId).map((account) => ({
      id: account.id,
      platform: account.platform,
      accountName: account.accountName,
      status: account.status,
      requireApproval: account.requireApproval,
    })),
    recentMessages: normalizeMessagesForPrompt(db.listAgentMessages(companyId, { agentId: agent.id, limit: 20 })),
    upcomingMeetings: filterUpcomingMeetings(snapshot.meetings, companyId, agent.id),
    relevantKnowledge: filterRelevantKnowledge(snapshot.knowledgeBase, companyId),
    activeSprint: snapshot.sprints.find((sprint) => sprint.companyId === companyId && sprint.status === "active") ?? null,
    recentDocuments: filterRecentDocuments(snapshot.documents, companyId, agent.id),
    allConnectors: buildConnectorCatalog(db, snapshot.connectors),
    sessionHandoff,
    skillNames,
    skillEntries: skills.map((s) => ({
      name: s.name ?? s.runtimeName,
      whenToUse: s.whenToUse,
      allowedTools: s.allowedTools,
      effort: s.effort,
      contextMode: s.contextMode,
    })),
    companySkillCatalog: db.listCompanySkills(companyId).map((skill) => ({
      name: skill.name,
      slug: skill.slug,
      description: skill.description,
    })),
    companyWorkspaces: snapshot.workspaces
      .filter((workspace) => workspace.companyId === companyId)
      .map((workspace) => ({ name: workspace.name, localPath: workspace.localPath })),
    companyDocuments: snapshot.documents.filter((d) => d.companyId === companyId),
  }) : null;

  const { taskSession, sessionHandoff: finalHandoff } = resolveSession(db, task, connector.id, sessionHandoff, deps);
  if (finalHandoff !== sessionHandoff && systemPrompt && finalHandoff) {
    sessionHandoff = finalHandoff;
  }

  const thinkingEffort = extractThinkingEffort(agent.metadataJson);
  const modelSelection = validateConnectorModelSelection(db, connector.id, agent.model);
  if (!modelSelection.ok) {
    throw new Error(modelSelection.error);
  }

  return {
    runId,
    companyId,
    taskId: task.id,
    taskTitle: task.title,
    taskDescription: task.description,
    agentId: agent.id,
    agentName: agent.name,
    connectorId: connector.id,
    workspaceId: workspaceMode === "exclusive" ? (workspace?.id ?? null) : null,
    workspacePath: workspace?.localPath ?? null,
    workspaceMode,
    command: connector.command,
    model: modelSelection.effectiveModel,
    thinkingEffort,
    env,
    sessionParams: taskSession.sessionParams,
    systemPrompt,
    trigger,
    managedSkills: skills.map((s) => ({ runtimeName: s.runtimeName, sourcePath: s.sourcePath })),
  };
}
