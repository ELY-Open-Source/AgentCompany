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
  void maybeStartQueuedRuns();
}

async function maybeStartQueuedRuns() {
  const readyJobs = [...queue];
  for (const job of readyJobs) {
    if (activeByAgent.has(job.agentId)) continue;
    const lockKey = workspaceKey(job);
    if (lockKey && activeByWorkspace.has(lockKey)) continue;
    const index = queue.findIndex((entry) => entry.runId === job.runId);
    if (index >= 0) queue.splice(index, 1);
    void startRun(job);
  }
}

async function startRun(job: RunJob) {
  const lockKey = workspaceKey(job);
  activeByAgent.set(job.agentId, job.runId);
  if (lockKey) activeByWorkspace.set(lockKey, job.runId);

  try {
    await runner.run(job);
  } finally {
    cancelledRuns.delete(job.runId);
    activeByAgent.delete(job.agentId);
    if (lockKey) activeByWorkspace.delete(lockKey);
    void maybeStartQueuedRuns();
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
      costUsd: null,
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
    runner.cancelAll();
    rpc.cancelAll("Worker shutting down.");
    process.exit(0);
  }
});
