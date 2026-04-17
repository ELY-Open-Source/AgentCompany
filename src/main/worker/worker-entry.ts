import type { ChildMessage, ParentMessage, RunJob } from "./worker-helpers";
import { WorkerRpcClient } from "./worker-rpc";
import { WorkerRunner } from "./worker-runner";

const parentPort = process.parentPort;

if (!parentPort) {
  throw new Error("AgentCompany worker requires process.parentPort");
}

const activeByAgent = new Map<string, string>();
const activeByWorkspace = new Map<string, string>();
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

function workspaceKey(job: RunJob) {
  if (job.workspaceMode !== "exclusive") return null;
  return job.workspaceId ?? job.workspacePath ?? `task:${job.taskId}`;
}

function enqueue(job: RunJob) {
  queue.push(job);
  post({
    type: "run-status",
    runId: job.runId,
    status: "queued",
    message: "Run queued in orchestration worker.",
  });
  maybeStartQueuedRuns();
}

/**
 * Walks the queue in-place and dispatches every job whose agent + workspace
 * are not currently busy. Claims (activeByAgent / activeByWorkspace) are
 * written BEFORE the job is removed from the queue and BEFORE `startRun`
 * fires — this is the atomic point of commit for orchestrator ordering.
 * Hardens against a future refactor that adds an `await` before the claim
 * inside `startRun`, which would open a re-entrancy window.
 */
function maybeStartQueuedRuns() {
  let i = 0;
  while (i < queue.length) {
    const job = queue[i];
    if (activeByAgent.has(job.agentId)) { i += 1; continue; }
    const lockKey = workspaceKey(job);
    if (lockKey && activeByWorkspace.has(lockKey)) { i += 1; continue; }
    activeByAgent.set(job.agentId, job.runId);
    if (lockKey) activeByWorkspace.set(lockKey, job.runId);
    queue.splice(i, 1);
    void startRun(job, lockKey);
  }
}

async function startRun(job: RunJob, lockKey: string | null) {
  try {
    await runner.run(job);
  } finally {
    cancelledRuns.delete(job.runId);
    activeByAgent.delete(job.agentId);
    if (lockKey) activeByWorkspace.delete(lockKey);
    maybeStartQueuedRuns();
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
      sessionParams: null,
      sessionDisplayId: null,
      unattributedCost: true,
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
