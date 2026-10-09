export const ROUTE_IDS = ["home", "team", "work", "chat", "files", "library", "runs", "approvals", "connectors", "office", "settings"] as const;
export type RouteId = (typeof ROUTE_IDS)[number];
