import type { SocialPlatform } from "./domain";

export interface SocialAccountRecord {
  id: string;
  orgId: string;
  platform: SocialPlatform;
  handle: string;
  displayName: string;
  authorizedEmployeeId: string | null;
  createdAt: string;
}

export interface SocialAccountGrantRecord {
  id: string;
  orgId: string;
  socialAccountId: string;
  employeeId: string;
  role: string;
  scopeJson: string;
  createdAt: string;
}

export interface BrowserSessionContainerRecord {
  id: string;
  orgId: string;
  socialAccountId: string;
  platform: SocialPlatform;
  partitionKey: string;
  hostAllowlistJson: string;
  permissionPolicy: string;
  sandboxEnabled: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface BrowserActionPolicyRecord {
  id: string;
  orgId: string;
  socialAccountId: string;
  actionType: string;
  contentCategory: string;
  riskLevel: string;
  approvalRequired: boolean;
  approvalKind: string | null;
  createdAt: string;
}

export interface SocialApprovalRouteRecord {
  id: string;
  orgId: string;
  socialAccountId: string;
  actionType: string;
  riskLevel: string;
  approvalKind: string;
  routeToType: string;
  routeToId: string | null;
  createdAt: string;
}

export interface BrowserActionRecord {
  id: string;
  orgId: string;
  socialAccountId: string;
  actionType: string;
  policyDecision: string;
  evidenceFileId: string | null;
  metadataJson: string;
  createdAt: string;
}

export interface SocialAuditRecord {
  id: string;
  orgId: string;
  socialAccountId: string | null;
  sourceType: string;
  sourceId: string | null;
  eventType: string;
  actorType: string;
  actorId: string | null;
  policyDecision: string;
  evidenceFileId: string | null;
  metadataJson: string;
  createdAt: string;
}
