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

