import type { PromptContext } from "../../src/main/prompt-builder/index";
import type {
  AgentRecord,
  ApprovalRecord,
  GoalRecord,
  ProjectRecord,
  TaskRecord,
} from "../../src/shared/types";
import type { TaskPromptEvalCase } from "./task-level-prompt-eval.js";

const EVAL_NOW = "2026-04-20T00:00:00.000Z";

function createAgent(overrides: Partial<AgentRecord>): AgentRecord {
  return {
    id: "agent-1",
    companyId: "company-1",
    name: "Agent",
    role: "Engineer",
    title: "Engineer",
    roleLevel: "ic",
    department: "engineering",
    status: "active",
    reportsTo: "manager-1",
    connectorId: "openai-codex",
    workspaceId: null,
    model: "gpt-5.4",
    capabilities: "Build production software",
    budgetMonthlyUsd: 200,
    spentMonthlyUsd: 0,
    metadataJson: "{}",
    heartbeatEnabled: true,
    heartbeatIntervalSec: 120,
    lastHeartbeatAt: null,
    createdAt: EVAL_NOW,
    updatedAt: EVAL_NOW,
    ...overrides,
  };
}

function createTask(overrides: Partial<TaskRecord>): TaskRecord {
  return {
    id: "task-1",
    companyId: "company-1",
    projectId: null,
    goalId: null,
    parentId: null,
    title: "Execute assigned work",
    description: "Complete the assigned production task with verification.",
    assigneeAgentId: "agent-1",
    workspaceId: null,
    status: "in_progress",
    priority: "high",
    activeRunId: null,
    costUsd: 0,
    taskType: null,
    requiresUserReview: false,
    requiresFilesystem: true,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    createdAt: EVAL_NOW,
    updatedAt: EVAL_NOW,
    ...overrides,
  };
}

function createGoal(overrides: Partial<GoalRecord>): GoalRecord {
  return {
    id: "goal-1",
    companyId: "company-1",
    title: "Launch reliable agent operations",
    description: "Build a dependable automated company operating loop.",
    parentId: null,
    ownerAgentId: "ceo-1",
    status: "active",
    createdAt: EVAL_NOW,
    updatedAt: EVAL_NOW,
    ...overrides,
  };
}

function createProject(overrides: Partial<ProjectRecord>): ProjectRecord {
  return {
    id: "project-1",
    companyId: "company-1",
    goalId: "goal-1",
    name: "Reliability hardening",
    description: "Reduce operational regressions across runtime paths.",
    leadAgentId: "manager-1",
    status: "in_progress",
    targetDate: null,
    createdAt: EVAL_NOW,
    updatedAt: EVAL_NOW,
    ...overrides,
  };
}

function createApproval(overrides: Partial<ApprovalRecord>): ApprovalRecord {
  return {
    id: "approval-1",
    companyId: "company-1",
    relatedTaskId: "task-1",
    relatedAgentId: null,
    requestedByAgentId: "agent-1",
    type: "plan_review",
    payloadSummary: "Human review plan before implementation.",
    impactSummary: "Blocks execution until the co-founder approves scope.",
    payloadJson: null,
    decisionNote: "",
    state: "pending",
    createdAt: EVAL_NOW,
    updatedAt: EVAL_NOW,
    ...overrides,
  };
}

const ceo = createAgent({
  id: "ceo-1",
  name: "CEO",
  role: "CEO",
  title: "Chief Executive Officer",
  roleLevel: "c_suite",
  department: "executive",
  reportsTo: null,
  capabilities: "Lead the company",
});
const manager = createAgent({
  id: "manager-1",
  name: "VP Engineering",
  role: "VP Engineering",
  title: "VP Engineering",
  roleLevel: "vp",
  reportsTo: ceo.id,
  capabilities: "Run engineering delivery",
});
const ic = createAgent({
  id: "ic-1",
  name: "Backend IC",
  role: "Backend Engineer",
  title: "Backend Engineer",
  reportsTo: manager.id,
  capabilities: "Implement backend tasks",
});

function buildContext(overrides: Partial<PromptContext>): PromptContext {
  return {
    agent: ic,
    apiUrl: "http://127.0.0.1:3000",
    apiKey: "eval-token",
    runId: "eval-run",
    task: null,
    companyName: "AgentCompany Eval",
    companyDescription: "Task-level prompt eval coverage",
    goals: [createGoal({})],
    projects: [createProject({})],
    directReports: [],
    chainOfCommand: [manager, ceo],
    assignedTasks: [],
    allAgents: [ceo, manager, ic],
    pendingApprovals: [],
    tasksAwaitingReview: [],
    wakeReason: "assignment",
    allTasks: [],
    recentComments: [],
    socialAccounts: [],
    allConnectors: [
      { id: "openai-apikey", label: "OpenAI API", status: "ready", enabledModels: ["gpt-5.4"] },
      { id: "anthropic-oauth", label: "Anthropic OAuth", status: "ready", enabledModels: ["claude-sonnet-4-5"] },
    ],
    ...overrides,
  };
}

const reviewTask = createTask({
  id: "task-review-1",
  title: "Review /api/companies p99 fix",
  description: "Review the submitted database query fix and approve or request changes.",
  assigneeAgentId: ic.id,
  status: "in_review",
});

export const TASK_LEVEL_PROMPT_EVAL_CASES: TaskPromptEvalCase[] = [
  {
    caseId: "ceo-bootstrap-hiring",
    taskLevel: "executive",
    description: "CEO cold-start task must expose hiring mode and suppress normal operating mode.",
    context: buildContext({
      agent: ceo,
      runId: "eval-run-ceo-bootstrap",
      task: createTask({
        id: "task-ceo-bootstrap",
        title: "Bootstrap the leadership team",
        description: "Create the first leadership hires and file the organization strategy.",
        assigneeAgentId: ceo.id,
      }),
      directReports: [],
      chainOfCommand: [],
      allAgents: [ceo],
    }),
    requiredHeadings: [
      "Agent Identity",
      "Your Leadership Style",
      "Position",
      "Active Goals",
      "Operating Instructions (CEO — Team Building Phase)",
      "Available Connectors",
      "Current Task",
      "Context",
    ],
    forbiddenHeadings: [
      "Operating Instructions (Executive / CEO)",
      "Proactive Behaviors (Things to Do Without Being Asked)",
      "Tasks Awaiting Your Review (1 pending)",
    ],
    requiredFragments: [
      "file 3–5 `hire_agent` tool calls",
      "Current Run ID: eval-run-ceo-bootstrap",
    ],
    forbiddenFragments: ["Goal Decomposition"],
  },
  {
    caseId: "manager-review-handoff",
    taskLevel: "manager",
    description: "Manager review task must expose review queue, workload, and delegation guidance.",
    context: buildContext({
      agent: manager,
      runId: "eval-run-manager-review",
      task: createTask({
        id: "task-manager-review",
        title: "Review latency fix",
        description: "Review the submitted p99 fix and unblock the release.",
        assigneeAgentId: manager.id,
      }),
      directReports: [ic],
      chainOfCommand: [ceo],
      allAgents: [ceo, manager, ic],
      allTasks: [reviewTask],
      tasksAwaitingReview: [reviewTask],
      recentComments: [{
        taskId: reviewTask.id,
        taskTitle: reviewTask.title,
        authorName: ic.name,
        body: "Implemented the index-backed query path and attached benchmark output.",
        createdAt: EVAL_NOW,
      }],
    }),
    requiredHeadings: [
      "Agent Identity",
      "Your Management Style",
      "Your Direct Reports",
      "Operating Instructions (Manager)",
      "Team Workload",
      "Current Task",
      "Tasks Awaiting Your Review (1 pending)",
      "Context",
    ],
    forbiddenHeadings: [
      "Operating Instructions (Individual Contributor)",
      "Operating Instructions (CEO — Team Building Phase)",
    ],
    requiredFragments: ["1 in review", "REVIEW WORKFLOW", "Review /api/companies p99 fix"],
    forbiddenFragments: ["file 3–5 `hire_agent` tool calls"],
  },
  {
    caseId: "ic-implementation-task",
    taskLevel: "individual_contributor",
    description: "IC implementation task must expose checkout, quality, and current task instructions.",
    context: buildContext({
      agent: ic,
      runId: "eval-run-ic-implementation",
      task: createTask({
        id: "task-ic-implementation",
        title: "Fix pagination boundary",
        description: "Patch src/utils/paginate.ts and prove tests pass.",
        assigneeAgentId: ic.id,
      }),
      directReports: [],
      chainOfCommand: [manager, ceo],
      allAgents: [ceo, manager, ic],
      assignedTasks: [createTask({
        id: "task-next",
        title: "Document pagination invariant",
        assigneeAgentId: ic.id,
        status: "todo",
      })],
    }),
    requiredHeadings: [
      "Agent Identity",
      "Your Work Philosophy",
      "Operating Instructions (Individual Contributor)",
      "Task Execution Workflow (SOP-002)",
      "Quality Standards",
      "Current Task",
      "Your Assigned Tasks",
      "Context",
    ],
    forbiddenHeadings: [
      "Operating Instructions (Manager)",
      "Operating Instructions (CEO — Team Building Phase)",
      "Tasks Awaiting Your Review (1 pending)",
    ],
    requiredFragments: ["Checkout", "set to \"in_review\"", "task-ic-implementation"],
  },
  {
    caseId: "cofounder-plan-review-gate",
    taskLevel: "manager",
    description: "AI cofounder task must expose human review gate and pending approval context.",
    context: buildContext({
      agent: manager,
      runId: "eval-run-cofounder-review",
      executionMode: "ai_cofounder",
      task: createTask({
        id: "task-cofounder-plan",
        title: "Plan checkout recovery refactor",
        description: "Prepare a plan before modifying task checkout recovery.",
        assigneeAgentId: manager.id,
        requiresUserReview: true,
      }),
      directReports: [ic],
      chainOfCommand: [ceo],
      allAgents: [ceo, manager, ic],
      pendingApprovals: [createApproval({
        id: "approval-plan-1",
        relatedTaskId: "task-cofounder-plan",
        requestedByAgentId: manager.id,
      })],
    }),
    requiredHeadings: [
      "Execution Mode: AI Co-Founder (Human-Reviewed)",
      "Operating Instructions (Manager)",
      "Current Task",
      "Pending Approvals",
      "Context",
    ],
    forbiddenHeadings: [
      "Operating Instructions (Executive / CEO)",
      "Operating Instructions (CEO — Team Building Phase)",
    ],
    requiredFragments: [
      "Treat pending approvals as blocking",
      "plan_review: Human review plan before implementation.",
      "approval-plan-1",
    ],
  },
];
