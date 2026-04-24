import type { AppDatabase } from "@main/database";
import type { ProjectionOutcome } from "./artifact-types";

export type ArtifactProjectionPhase = "completion_reconcile";

export interface ArtifactProjectionEventInput {
  companyId: string;
  runId: string;
  agentId: string;
  phase: ArtifactProjectionPhase;
  workspaceId: string | null;
  workspaceMode: "exclusive" | "shared" | "none";
  outcomes: ProjectionOutcome[];
}

export interface ArtifactProjectionFailureInput {
  companyId: string;
  runId: string;
  agentId: string;
  phase: ArtifactProjectionPhase;
  workspaceId: string | null;
  workspaceMode: "exclusive" | "shared" | "none";
  errorMessage: string;
}

interface ProjectionCounts {
  inserted: number;
  updated: number;
  retired: number;
  skipped: number;
}

function countOutcomes(outcomes: ProjectionOutcome[]): ProjectionCounts {
  const counts: ProjectionCounts = {
    inserted: 0,
    updated: 0,
    retired: 0,
    skipped: 0,
  };
  for (const outcome of outcomes) {
    counts[outcome.kind] += 1;
  }
  return counts;
}

function summarizeOutcomes(phase: ArtifactProjectionPhase, counts: ProjectionCounts): string {
  return [
    `Artifact projection ${phase} acknowledged`,
    `${counts.inserted} inserted`,
    `${counts.updated} updated`,
    `${counts.retired} retired`,
    `${counts.skipped} skipped`,
  ].join("; ");
}

export function appendArtifactProjectionEvent(
  db: AppDatabase,
  input: ArtifactProjectionEventInput,
): ProjectionCounts {
  const counts = countOutcomes(input.outcomes);
  db.core.runs.appendRunEvent({
    companyId: input.companyId,
    runId: input.runId,
    agentId: input.agentId,
    eventType: "artifact_projection",
    level: "info",
    message: summarizeOutcomes(input.phase, counts),
    payload: {
      phase: input.phase,
      workspaceId: input.workspaceId,
      workspaceMode: input.workspaceMode,
      counts,
      outcomes: input.outcomes,
    },
  });
  return counts;
}

export function appendArtifactProjectionFailureEvent(
  db: AppDatabase,
  input: ArtifactProjectionFailureInput,
): void {
  db.core.runs.appendRunEvent({
    companyId: input.companyId,
    runId: input.runId,
    agentId: input.agentId,
    eventType: "artifact_projection",
    level: "error",
    message: `Artifact projection ${input.phase} failed: ${input.errorMessage}`,
    payload: {
      phase: input.phase,
      workspaceId: input.workspaceId,
      workspaceMode: input.workspaceMode,
      errorMessage: input.errorMessage,
    },
  });
}
