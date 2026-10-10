import type { AppSnapshot } from "../../../shared/domain";

export const ROUTE_IDS = ["home", "team", "work", "chat", "files", "library", "runs", "approvals", "connectors", "office", "settings"] as const;
export type RouteId = (typeof ROUTE_IDS)[number];

/** Connectors exist once a Composio key is saved. */
export function connectorsEnabled(snapshot: AppSnapshot): boolean {
  return snapshot.integrationKeys.some((key) => key.name === "composio" && key.configured);
}
