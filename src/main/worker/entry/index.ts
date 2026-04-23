import type { ChildMessage, ParentMessage, RunJob } from "../runtime/helpers";
import { WorkerRpcClient } from "./rpc";
import { WorkerRunner } from "../runtime";

const parentPort = process.parentPort;

if (!parentPort) {
  throw new Error("AgentCompany worker requires process.parentPort");
}

interface ActiveRun {
  runId: string;
  agentId: string;
  workspaceKey: string | null;
}

/**
 * Single source of truth for scheduling invariants: one active run per
 * agent and one active run per exclusive workspace lock. Prior layout
 * kept three parallel structures (`activeByAgent`, `activeByWorkspace`,
 * queue) that had to be updated in lockstep. The Map-of-ActiveRun keyed
 * by runId is the only authoritative record; agent/workspace busy checks
 * iterate it.
 */
const active = new Map<string, ActiveRun>();
const queue: RunJob[] = [];
const cancelledRuns = new Set<string>();

function post(message: ChildMessage) {
  parentPort.postMessage(message);
}

const rpc = new WorkerRpcClient(post);
const runner = new WorkerRunner({
  post,
  rpc,
  isCancelled: (runId) => cancelledRuns.has(runId),
});

function workspaceKey(job: RunJob): string | null {
  if (job.workspaceMode !== "exclusive") return null;
  return job.workspaceId ?? job.workspacePath ?? `task:${job.taskId}`;
}

function isAgentBusy(agentId: string): boolean {
  for (const run of active.values()) {
    if (run.agentId === agentId) return true;
  }
  return false;
}

function isWorkspaceBusy(lockKey: string): boolean {
  for (const run of active.values()) {
    if (run.workspaceKey === lockKey) return true;
  }
  return false;
}

function enqueue(job: RunJob) {
  queue.push(job);
  post({
    type: "run-status",
    runId: job.runId,
    status: "queued",
    message: "Run queued in orchestration worker.",
  });
  tickQueue();
}

/**
 * Claim-before-dispatch: for each queued job whose agent + workspace are
 * free, register the claim in `active` synchronously *before* calling
 * `startRun`. No async window between claim and dispatch.
 */
function tickQueue() {
  let i = 0;
  while (i < queue.length) {
    const job = queue[i];
    if (isAgentBusy(job.agentId)) { i += 1; continue; }
    const lockKey = workspaceKey(job);
    if (lockKey && isWorkspaceBusy(lockKey)) { i += 1; continue; }
    active.set(job.runId, { runId: job.runId, agentId: job.agentId, workspaceKey: lockKey });
    queue.splice(i, 1);
    void startRun(job);
  }
}

async function startRun(job: RunJob) {
  try {
    await runner.run(job);
  } finally {
    cancelledRuns.delete(job.runId);
    active.delete(job.runId);
    tickQueue();
  }
}

function cancelRun(runId: string) {
  const queuedIndex = queue.findIndex((entry) => entry.runId === runId);
  if (queuedIndex >= 0) {
    queue.splice(queuedIndex, 1);
    post({
      type: "run-finished",
      runId,
      status: "cancelled",
      summary: "Cancelled before execution.",
      errorMessage: null,
      exitCode: null,
      signal: null,
      model: null,
      usageStatus: "aborted_before_usage",
      inputTokens: null,
      outputTokens: null,
    });
    return;
  }

  cancelledRuns.add(runId);
  runner.cancel(runId);
}

parentPort.on("message", (event) => {
  const message = event.data as ParentMessage;
  if (message.type === "enqueue-run") {
    enqueue(message.payload);
    return;
  }
  if (message.type === "cancel-run") {
    cancelRun(message.runId);
    return;
  }
  if (message.type === "steer-run") {
    const accepted = runner.steer(message.runId, message.message);
    post({
      type: "steer-ack",
      runId: message.runId,
      correlationId: message.correlationId,
      accepted,
    });
    return;
  }
  if (message.type === "rpc-response") {
    rpc.resolve(message.rpcId, message.response);
    return;
  }
  if (message.type === "shutdown") {
    void (async () => {
      // Graceful drain: abort every active run and await its promise
      // settlement so that final `run-finished` messages and
      // `persistMessage` RPCs reach the parent before we exit. Bounded by
      // a 5s budget so a stuck run does not wedge the shutdown handshake
      // (the parent has its own kill-timer as a safety net).
      const drainBudgetMs = 5_000;
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, drainBudgetMs));
      await Promise.race([runner.cancelAll(), timeout]);
      rpc.cancelAll("Worker shutting down.");
      process.exit(0);
    })();
  }
});
