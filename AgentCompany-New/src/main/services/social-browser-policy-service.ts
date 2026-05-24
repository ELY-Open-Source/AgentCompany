import type { DatabaseSync } from "node:sqlite";
import { SOCIAL_PLATFORM, type RiskLevel, type SocialPlatform } from "../../shared/domain";
import { createId } from "../../shared/ids";

export const SOCIAL_BROWSER_ACTION = {
  LOGIN: "login",
  DRAFT: "draft",
  APPROVE: "approve",
} as const;

export type SocialBrowserAction = typeof SOCIAL_BROWSER_ACTION[keyof typeof SOCIAL_BROWSER_ACTION];

const PLATFORM_HOSTS: Record<SocialPlatform, string[]> = {
  [SOCIAL_PLATFORM.X]: ["x.com", "twitter.com"],
  [SOCIAL_PLATFORM.LINKEDIN]: ["linkedin.com", "www.linkedin.com"],
  [SOCIAL_PLATFORM.YOUTUBE]: ["accounts.google.com", "youtube.com", "www.youtube.com"],
  [SOCIAL_PLATFORM.INSTAGRAM]: ["instagram.com", "www.instagram.com"],
};

const ACTION_POLICIES: ReadonlyArray<{
  actionType: SocialBrowserAction;
  contentCategory: string;
  riskLevel: RiskLevel;
  approvalRequired: boolean;
  approvalKind: string | null;
}> = [
  { actionType: SOCIAL_BROWSER_ACTION.LOGIN, contentCategory: "auth", riskLevel: "low", approvalRequired: false, approvalKind: null },
  { actionType: SOCIAL_BROWSER_ACTION.DRAFT, contentCategory: "content", riskLevel: "low", approvalRequired: false, approvalKind: null },
  { actionType: SOCIAL_BROWSER_ACTION.APPROVE, contentCategory: "content", riskLevel: "medium", approvalRequired: true, approvalKind: "social_publish" },
];

export interface BrowserSessionContainerRow {
  id: string;
  partition_key: string;
  host_allowlist_json: string;
  permission_policy: string;
  sandbox_enabled: number;
}

export interface BrowserActionPolicyRow {
  id: string;
  action_type: SocialBrowserAction;
  risk_level: RiskLevel;
  approval_required: number;
  approval_kind: string | null;
}

export interface SocialApprovalRouteRow {
  id: string;
  approval_kind: string;
  route_to_type: string;
  route_to_id: string | null;
}

export class SocialBrowserPolicyService {
  constructor(private readonly db: DatabaseSync) {}

  seedAccountControls(input: {
    orgId: string;
    socialAccountId: string;
    platform: SocialPlatform;
    authorizedEmployeeId: string | null;
    createdAt: string;
  }): void {
    this.db.prepare(`
      insert or ignore into browser_session_containers(
        id, org_id, social_account_id, platform, partition_key, host_allowlist_json,
        permission_policy, sandbox_enabled, created_at, last_used_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, null)
    `).run(
      createId("bsc"),
      input.orgId,
      input.socialAccountId,
      input.platform,
      `persist:agentcompany-social-${input.socialAccountId}`,
      JSON.stringify(PLATFORM_HOSTS[input.platform]),
      "deny_all",
      1,
      input.createdAt,
    );
    for (const policy of ACTION_POLICIES) {
      this.db.prepare(`
        insert or ignore into browser_action_policies(
          id, org_id, social_account_id, action_type, content_category, risk_level,
          approval_required, approval_kind, created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        createId("bap"),
        input.orgId,
        input.socialAccountId,
        policy.actionType,
        policy.contentCategory,
        policy.riskLevel,
        policy.approvalRequired ? 1 : 0,
        policy.approvalKind,
        input.createdAt,
      );
    }
    this.db.prepare(`
      insert or ignore into social_approval_routes(
        id, org_id, social_account_id, action_type, risk_level, approval_kind,
        route_to_type, route_to_id, created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      createId("sar"),
      input.orgId,
      input.socialAccountId,
      SOCIAL_BROWSER_ACTION.APPROVE,
      "medium",
      "social_publish",
      "authorized_employee",
      input.authorizedEmployeeId,
      input.createdAt,
    );
  }

  requireSessionContainer(orgId: string, socialAccountId: string): BrowserSessionContainerRow {
    const row = this.db.prepare(`
      select id, partition_key, host_allowlist_json, permission_policy, sandbox_enabled
      from browser_session_containers
      where org_id = ? and social_account_id = ?
    `).get(orgId, socialAccountId) as BrowserSessionContainerRow | undefined;
    if (!row) throw new Error("Browser session container is required.");
    this.parseHostAllowlist(row.host_allowlist_json);
    if (row.permission_policy !== "deny_all") throw new Error("Browser permission policy is invalid.");
    if (row.sandbox_enabled !== 1) throw new Error("Browser sandbox policy is required.");
    return row;
  }

  allowedHosts(container: BrowserSessionContainerRow): string[] {
    return this.parseHostAllowlist(container.host_allowlist_json);
  }

  markSessionUsed(containerId: string, usedAt: string): void {
    this.db.prepare("update browser_session_containers set last_used_at = ? where id = ?").run(usedAt, containerId);
  }

  requireActionPolicy(orgId: string, socialAccountId: string, actionType: SocialBrowserAction): BrowserActionPolicyRow {
    const row = this.db.prepare(`
      select id, action_type, risk_level, approval_required, approval_kind
      from browser_action_policies
      where org_id = ? and social_account_id = ? and action_type = ?
    `).get(orgId, socialAccountId, actionType) as BrowserActionPolicyRow | undefined;
    if (!row) throw new Error("Browser action policy is required.");
    return row;
  }

  requireApprovalRoute(orgId: string, socialAccountId: string, actionType: SocialBrowserAction, riskLevel: RiskLevel): SocialApprovalRouteRow {
    const row = this.db.prepare(`
      select id, approval_kind, route_to_type, route_to_id
      from social_approval_routes
      where org_id = ? and social_account_id = ? and action_type = ? and risk_level = ?
    `).get(orgId, socialAccountId, actionType, riskLevel) as SocialApprovalRouteRow | undefined;
    if (!row) throw new Error("Social approval route is required.");
    return row;
  }

  private parseHostAllowlist(raw: string): string[] {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string" && item.trim())) {
      throw new Error("Browser host allowlist is invalid.");
    }
    return parsed.map((item) => item.toLowerCase());
  }
}
