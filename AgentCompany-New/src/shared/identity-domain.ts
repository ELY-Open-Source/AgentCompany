type ValueOf<T> = T[keyof T];

export const IDENTITY_SOURCE = { BOOTSTRAP: "bootstrap", SSO: "sso", SCIM: "scim" } as const;
export const ROLE_KEY = {
  ORG_ADMIN: "org_admin",
  APPROVAL_DECIDER: "approval_decider",
  HIRING_MANAGER: "hiring_manager",
  SCOPED_AGENT: "scoped_agent",
} as const;
export const ACCESS_DECISION = { ALLOW: "allow", DENY: "deny" } as const;

export type IdentitySource = ValueOf<typeof IDENTITY_SOURCE>;
export type RoleKey = ValueOf<typeof ROLE_KEY>;
export type AccessDecision = ValueOf<typeof ACCESS_DECISION>;
export type PrincipalType = "employee" | "agent" | "service_identity";

export interface EmployeeIdentityRecord {
  id: string; orgId: string; employeeId: string; source: IdentitySource; externalSubject: string;
  email: string | null; active: boolean; createdAt: string; lastSeenAt: string | null;
}

export interface ServiceIdentityRecord {
  id: string; orgId: string; agentId: string; name: string; scopeJson: string; createdAt: string;
}

export interface RoleGrantRecord {
  id: string; orgId: string; principalType: PrincipalType; principalId: string; roleKey: RoleKey;
  scopeType: string; scopeId: string; grantedByEmployeeId: string | null; createdAt: string;
}

export interface AccessDecisionRecord {
  id: string; orgId: string; principalType: PrincipalType; principalId: string; action: string;
  resourceType: string; resourceId: string; decision: AccessDecision; reason: string; createdAt: string;
}
