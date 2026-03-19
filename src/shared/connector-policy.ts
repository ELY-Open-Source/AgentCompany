import type { CapabilityMatrix, ConnectorRecord } from "./types";

type ConnectorExecutionCandidate = Pick<ConnectorRecord, "status" | "capabilityMatrix"> & Partial<Pick<ConnectorRecord, "label">>;

export function isConnectorExecutionReady(connector: ConnectorExecutionCandidate) {
  return connector.status === "ready";
}

export function getConnectorExecutionReadinessIssue(connector: ConnectorExecutionCandidate) {
  const label = connector.label ?? "Connector";
  if (connector.status === "ready") {
    return null;
  }
  if (connector.status === "not_installed") {
    return `${label} is not installed.`;
  }
  if (connector.status === "auth_required") {
    return `${label} requires authentication. Run the CLI login command first.`;
  }
  return `${label} is ${connector.status.replaceAll("_", " ")} and cannot be used for autonomous execution.`;
}
