import type { CapabilityMatrix, ConnectorRecord } from "./types";

type ConnectorExecutionCandidate = Pick<ConnectorRecord, "status" | "capabilityMatrix"> & Partial<Pick<ConnectorRecord, "label">>;

function missingExecutionCapabilities(capabilityMatrix: CapabilityMatrix | null | undefined) {
  const missing: string[] = [];
  if (!capabilityMatrix?.sessionResume) missing.push("session resume");
  if (!capabilityMatrix?.structuredTranscript) missing.push("structured transcript");
  return missing;
}

export function isConnectorExecutionReady(connector: ConnectorExecutionCandidate) {
  return connector.status === "ready" && missingExecutionCapabilities(connector.capabilityMatrix).length === 0;
}

export function getConnectorExecutionReadinessIssue(connector: ConnectorExecutionCandidate) {
  const label = connector.label ?? "Connector";
  if (connector.status !== "ready") {
    return `${label} is ${connector.status.replaceAll("_", " ")} and cannot be used for autonomous execution.`;
  }
  const missing = missingExecutionCapabilities(connector.capabilityMatrix);
  if (missing.length === 0) {
    return null;
  }
  return `${label} does not provide ${missing.join(" and ")}, which AgentCompany requires for autonomous execution.`;
}
