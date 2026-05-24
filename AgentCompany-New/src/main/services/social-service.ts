import type { DatabaseSync } from "node:sqlite";
import { BrowserWindow, session } from "electron";
import type {
  CreateScheduledPostInput,
  CreateSocialAccountInput,
  LaunchSocialLoginInput,
  SetScheduledPostStateInput,
} from "../../shared/commands";
import { APPROVAL_STATE, RISK_LEVEL, ROUTE_TO_TYPE, SOCIAL_PLATFORM, type RiskLevel, type SocialPlatform } from "../../shared/domain";
import { createId } from "../../shared/ids";
import { ApprovalService } from "./approval-service";
import { AuditService } from "./audit-service";
import { SocialAuditService } from "./social-audit-service";
import {
  SOCIAL_BROWSER_ACTION,
  SocialBrowserPolicyService,
  type BrowserActionPolicyRow,
  type SocialApprovalRouteRow,
  type SocialBrowserAction,
} from "./social-browser-policy-service";

const PLATFORM_LOGIN_URL: Record<SocialPlatform, string> = {
  [SOCIAL_PLATFORM.X]: "https://x.com/i/flow/login",
  [SOCIAL_PLATFORM.LINKEDIN]: "https://www.linkedin.com/login",
  [SOCIAL_PLATFORM.YOUTUBE]: "https://accounts.google.com/",
  [SOCIAL_PLATFORM.INSTAGRAM]: "https://www.instagram.com/accounts/login/",
};

const STATE_GRANT_ACTION: Record<SetScheduledPostStateInput["state"], SocialBrowserAction> = {
  draft: SOCIAL_BROWSER_ACTION.DRAFT,
  scheduled: SOCIAL_BROWSER_ACTION.APPROVE,
  published: SOCIAL_BROWSER_ACTION.APPROVE,
  cancelled: SOCIAL_BROWSER_ACTION.APPROVE,
};

const GRANT_SCOPE = {
  actions: [SOCIAL_BROWSER_ACTION.LOGIN, SOCIAL_BROWSER_ACTION.DRAFT, SOCIAL_BROWSER_ACTION.APPROVE],
  riskCeiling: RISK_LEVEL.MEDIUM,
} as const;

const ACTION_REQUIRED_RISK: Record<SocialBrowserAction, RiskLevel> = {
  login: RISK_LEVEL.LOW,
  draft: RISK_LEVEL.LOW,
  approve: RISK_LEVEL.MEDIUM,
};

const RISK_WEIGHT: Record<RiskLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

interface SocialAccountRow {
  id: string;
  org_id: string;
  platform: SocialPlatform;
  handle: string;
  authorized_employee_id: string | null;
}

interface ScheduledPostRow {
  id: string;
  org_id: string;
  social_account_id: string;
  body_md: string;
  state: SetScheduledPostStateInput["state"];
  approval_id: string | null;
  created_by_employee_id: string | null;
}

interface GrantScope {
  actions: string[];
  riskCeiling: RiskLevel;
}

export class SocialService {
  private readonly audit: AuditService;
  private readonly approvals: ApprovalService;
  private readonly socialAudit: SocialAuditService;
  private readonly browserPolicy: SocialBrowserPolicyService;

  constructor(private readonly db: DatabaseSync) {
    this.audit = new AuditService(db);
    this.approvals = new ApprovalService(db);
    this.socialAudit = new SocialAuditService(db);
    this.browserPolicy = new SocialBrowserPolicyService(db);
  }

  createScheduledPost(input: CreateScheduledPostInput): string {
    this.requireAccount(input.orgId, input.socialAccountId);
    const policy = this.browserPolicy.requireActionPolicy(input.orgId, input.socialAccountId, SOCIAL_BROWSER_ACTION.DRAFT);
    this.requireGrant(input.orgId, input.socialAccountId, input.createdByEmployeeId, SOCIAL_BROWSER_ACTION.DRAFT);
    const body = this.requireText(input.bodyMd, "Post body is required.");
    const scheduledFor = this.requireSchedule(input.scheduledFor);
    const id = createId("spost");
    const now = new Date().toISOString();
    this.db.prepare(`
      insert into scheduled_posts(
        id, org_id, social_account_id, body_md, scheduled_for,
        state, approval_id, created_by_employee_id, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.orgId,
      input.socialAccountId,
      body,
      scheduledFor,
      "draft",
      null,
      input.createdByEmployeeId,
      now,
      now,
    );
    this.audit.record({
      orgId: input.orgId,
      entityType: "scheduled_post",
      entityId: id,
      actorType: "employee",
      actorId: input.createdByEmployeeId,
      action: "drafted",
      payload: { socialAccountId: input.socialAccountId, scheduledFor, state: "draft" },
    });
    this.socialAudit.record({
      orgId: input.orgId,
      socialAccountId: input.socialAccountId,
      sourceType: "scheduled_post",
      sourceId: id,
      eventType: "draft_created",
      actorType: "employee",
      actorId: input.createdByEmployeeId,
      policyDecision: "allowed_by_policy",
      metadata: { scheduledFor, actionType: policy.action_type, riskLevel: policy.risk_level },
      createdAt: now,
    });
    return id;
  }

  setScheduledPostState(input: SetScheduledPostStateInput): void {
    const post = this.requireScheduledPost(input.orgId, input.scheduledPostId);
    const action = STATE_GRANT_ACTION[input.state];
    const policy = this.browserPolicy.requireActionPolicy(input.orgId, post.social_account_id, action);
    this.requireGrant(input.orgId, post.social_account_id, input.employeeId, action);
    this.assertStateTransition(post, input.state);
    const approvalId = this.resolveApprovalForState(input, post, policy);
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      update scheduled_posts set state = ?, approval_id = ?, updated_at = ?
      where id = ? and org_id = ?
    `).run(input.state, approvalId, now, input.scheduledPostId, input.orgId);
    if (result.changes === 0) throw new Error("Scheduled post was not found.");
    this.audit.record({
      orgId: input.orgId,
      entityType: "scheduled_post",
      entityId: input.scheduledPostId,
      actorType: "employee",
      actorId: input.employeeId,
      action: `state_${input.state}`,
      payload: { state: input.state, approvalId },
    });
    this.socialAudit.record({
      orgId: input.orgId,
      socialAccountId: post.social_account_id,
      sourceType: "scheduled_post",
      sourceId: input.scheduledPostId,
      eventType: `state_${input.state}`,
      actorType: "employee",
      actorId: input.employeeId,
      policyDecision: policyDecisionForState(input.state, policy.approval_required === 1),
      metadata: { state: input.state, approvalId, actionType: policy.action_type, riskLevel: policy.risk_level },
      createdAt: now,
    });
  }

  createAccount(input: CreateSocialAccountInput): string {
    this.assertOrg(input.orgId);
    this.assertPlatform(input.platform);
    this.assertEmployee(input.orgId, input.createdByEmployeeId, "Creating employee was not found.");
    const handle = this.requireText(input.handle, "Social handle is required.");
    const displayName = this.requireText(input.displayName, "Social display name is required.");
    this.assertUniqueAccount(input.orgId, input.platform, handle);
    const id = createId("soc");
    const now = new Date().toISOString();
    if (input.authorizedEmployeeId) {
      this.assertEmployee(input.orgId, input.authorizedEmployeeId, "Authorized employee was not found.");
    }
    this.db.prepare(`
      insert into social_accounts(id, org_id, platform, handle, display_name, authorized_employee_id, created_at)
      values (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.orgId,
      input.platform,
      handle,
      displayName,
      input.authorizedEmployeeId,
      now,
    );
    this.browserPolicy.seedAccountControls({
      orgId: input.orgId,
      socialAccountId: id,
      platform: input.platform,
      authorizedEmployeeId: input.authorizedEmployeeId ?? null,
      createdAt: now,
    });
    if (input.authorizedEmployeeId) {
      this.db.prepare(`
        insert into social_account_grants(id, org_id, social_account_id, employee_id, role, scope_json, created_at)
        values (?, ?, ?, ?, ?, ?, ?)
      `).run(
        createId("sgr"),
        input.orgId,
        id,
        input.authorizedEmployeeId,
        "operator",
        JSON.stringify(GRANT_SCOPE),
        now,
      );
    }
    this.audit.record({
      orgId: input.orgId,
      entityType: "social_account",
      entityId: id,
      actorType: "employee",
      actorId: input.createdByEmployeeId,
      action: "created",
      payload: { platform: input.platform, handle },
    });
    this.socialAudit.record({
      orgId: input.orgId,
      socialAccountId: id,
      sourceType: "social_account",
      sourceId: id,
      eventType: "account_created",
      actorType: "employee",
      actorId: input.createdByEmployeeId,
      policyDecision: "allowed_employee_authorization",
      metadata: { platform: input.platform, handle, authorizedEmployeeId: input.authorizedEmployeeId ?? null },
      createdAt: now,
    });
    return id;
  }

  launchLoginWindow(input: LaunchSocialLoginInput): void {
    const account = this.requireAccount(input.orgId, input.socialAccountId);
    const container = this.browserPolicy.requireSessionContainer(input.orgId, input.socialAccountId);
    this.browserPolicy.requireActionPolicy(input.orgId, input.socialAccountId, SOCIAL_BROWSER_ACTION.LOGIN);
    this.requireGrant(input.orgId, input.socialAccountId, input.employeeId, SOCIAL_BROWSER_ACTION.LOGIN);
    const socialSession = session.fromPartition(container.partition_key);
    socialSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    socialSession.setPermissionCheckHandler(() => false);

    const win = new BrowserWindow({
      width: 1280,
      height: 860,
      title: `${account.handle}`,
      webPreferences: {
        session: socialSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: container.sandbox_enabled === 1,
      },
    });
    this.attachNavigationPolicy(win, this.browserPolicy.allowedHosts(container));
    win.loadURL(PLATFORM_LOGIN_URL[account.platform]);
    const now = new Date().toISOString();
    this.browserPolicy.markSessionUsed(container.id, now);
    const browserActionId = createId("bact");
    this.db.prepare(`
      insert into browser_actions(id, org_id, social_account_id, action_type, policy_decision, evidence_file_id, created_at)
      values (?, ?, ?, ?, ?, ?, ?)
    `).run(browserActionId, account.org_id, account.id, "login_window_opened", "allowed_human_login", null, now);
    this.audit.record({
      orgId: account.org_id,
      entityType: "social_account",
      entityId: account.id,
      actorType: "employee",
      actorId: input.employeeId,
      action: "login_window_opened",
      payload: { platform: account.platform },
    });
    this.socialAudit.record({
      orgId: account.org_id,
      socialAccountId: account.id,
      sourceType: "browser_action",
      sourceId: browserActionId,
      eventType: "login_window_opened",
      actorType: "employee",
      actorId: input.employeeId,
      policyDecision: "allowed_human_login",
      metadata: { platform: account.platform, containerId: container.id },
      createdAt: now,
    });
  }

  private attachNavigationPolicy(win: BrowserWindow, allowedHosts: string[]): void {
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    const guard = (event: Electron.Event, url: string) => {
      if (!this.isAllowedNavigation(allowedHosts, url)) event.preventDefault();
    };
    win.webContents.on("will-navigate", guard);
    win.webContents.on("will-redirect", guard);
  }

  private requireAccount(orgId: string, accountId: string): SocialAccountRow {
    const account = this.db.prepare("select * from social_accounts where id = ? and org_id = ?")
      .get(accountId, orgId) as SocialAccountRow | undefined;
    if (!account) throw new Error("Social account was not found.");
    return account;
  }

  private requireScheduledPost(orgId: string, scheduledPostId: string): ScheduledPostRow {
    const post = this.db.prepare("select * from scheduled_posts where id = ? and org_id = ?")
      .get(scheduledPostId, orgId) as ScheduledPostRow | undefined;
    if (!post) throw new Error("Scheduled post was not found.");
    return post;
  }

  private requireGrant(orgId: string, socialAccountId: string, employeeId: string, action: SocialBrowserAction): void {
    this.assertEmployee(orgId, employeeId, "Social account grant is required.");
    const row = this.db.prepare(`
      select scope_json from social_account_grants
      where org_id = ? and social_account_id = ? and employee_id = ?
    `).get(orgId, socialAccountId, employeeId) as { scope_json: string } | undefined;
    if (!row) throw new Error("Social account grant is required.");
    const scope = parseGrantScope(row.scope_json);
    if (!scope.actions.includes(action)) throw new Error("Social account grant is required.");
    if (RISK_WEIGHT[scope.riskCeiling] < RISK_WEIGHT[ACTION_REQUIRED_RISK[action]]) {
      throw new Error("Social account grant risk ceiling is insufficient.");
    }
  }

  private resolveApprovalForState(input: SetScheduledPostStateInput, post: ScheduledPostRow, policy: BrowserActionPolicyRow): string | null {
    if (input.state === "scheduled") {
      return policy.approval_required === 1
        ? post.approval_id ?? this.createPublishApproval(input.orgId, input.employeeId, post, policy)
        : post.approval_id;
    }
    if (input.state === "published") {
      if (policy.approval_required === 1) this.assertApprovalApproved(input.orgId, post.approval_id);
      return post.approval_id;
    }
    return post.approval_id;
  }

  private createPublishApproval(orgId: string, employeeId: string, post: ScheduledPostRow, policy: BrowserActionPolicyRow): string {
    const route = this.browserPolicy.requireApprovalRoute(orgId, post.social_account_id, policy.action_type, policy.risk_level);
    const approvalId = this.approvals.create({
      orgId,
      kind: route.approval_kind,
      title: "Approve social post",
      details: post.body_md,
      risk: policy.risk_level,
      requestedByType: "employee",
      requestedById: employeeId,
    });
    this.assignSocialApprovalRoute(orgId, approvalId, route);
    return approvalId;
  }

  private assignSocialApprovalRoute(orgId: string, approvalId: string, route: SocialApprovalRouteRow): void {
    if (route.route_to_type !== "authorized_employee") throw new Error("Social approval route target type is invalid.");
    if (!route.route_to_id) throw new Error("Social approval route target is required.");
    this.assertEmployee(orgId, route.route_to_id, "Social approval route employee was not found.");
    this.db.prepare(`
      insert into approval_assignments(id, org_id, approval_id, assignee_type, assignee_id, routing_rule_id, created_at)
      values (?, ?, ?, ?, ?, null, ?)
      on conflict(approval_id, assignee_type, assignee_id) do nothing
    `).run(createId("aas"), orgId, approvalId, ROUTE_TO_TYPE.EMPLOYEE, route.route_to_id, new Date().toISOString());
    this.audit.record({
      orgId,
      entityType: "approval",
      entityId: approvalId,
      actorType: "system",
      actorId: null,
      action: "social_route_assigned",
      payload: { routeId: route.id, routeToType: route.route_to_type, routeToId: route.route_to_id },
    });
  }

  private assertApprovalApproved(orgId: string, approvalId: string | null): void {
    if (!approvalId) throw new Error("Approved social approval is required.");
    const approval = this.db.prepare("select state from approvals where id = ? and org_id = ? and kind = ?")
      .get(approvalId, orgId, "social_publish") as { state: string } | undefined;
    if (!approval || approval.state !== APPROVAL_STATE.APPROVED) {
      throw new Error("Approved social approval is required.");
    }
  }

  private assertStateTransition(post: ScheduledPostRow, nextState: SetScheduledPostStateInput["state"]): void {
    if (post.state === nextState) throw new Error("Scheduled post already has this state.");
    const allowed = post.state === "draft"
      ? ["scheduled", "cancelled"]
      : post.state === "scheduled"
        ? ["published", "cancelled"]
        : [];
    if (!allowed.includes(nextState)) throw new Error("Scheduled post state transition is invalid.");
  }

  private assertOrg(orgId: string): void {
    const org = this.db.prepare("select id from organizations where id = ?").get(orgId);
    if (!org) throw new Error("Organization was not found.");
  }

  private assertEmployee(orgId: string, employeeId: string, message: string): void {
    const employee = this.db.prepare("select id from employees where id = ? and org_id = ?").get(employeeId, orgId);
    if (!employee) throw new Error(message);
  }

  private assertPlatform(platform: SocialPlatform): void {
    if (!Object.values(SOCIAL_PLATFORM).includes(platform)) throw new Error("Social platform is unsupported.");
  }

  private assertUniqueAccount(orgId: string, platform: SocialPlatform, handle: string): void {
    const account = this.db.prepare("select id from social_accounts where org_id = ? and platform = ? and lower(handle) = lower(?)")
      .get(orgId, platform, handle);
    if (account) throw new Error("Social account already exists.");
  }

  private requireText(value: string, message: string): string {
    const trimmed = value.trim();
    if (!trimmed) throw new Error(message);
    return trimmed;
  }

  private requireSchedule(value: string): string {
    const scheduledFor = this.requireText(value, "Scheduled date is required.");
    const date = new Date(scheduledFor);
    if (Number.isNaN(date.getTime())) throw new Error("Scheduled date is invalid.");
    return scheduledFor;
  }

  private isAllowedNavigation(allowedHosts: string[], url: string): boolean {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    return allowedHosts.some((entry) => host === entry || host.endsWith(`.${entry}`));
  }
}

function parseGrantScope(raw: string): GrantScope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Social account grant scope is invalid.");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.actions) || !parsed.actions.every((action) => typeof action === "string")) {
    throw new Error("Social account grant scope is invalid.");
  }
  if (!isRiskLevel(parsed.riskCeiling)) throw new Error("Social account grant scope is invalid.");
  return { actions: parsed.actions, riskCeiling: parsed.riskCeiling };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRiskLevel(value: unknown): value is RiskLevel {
  return Object.values(RISK_LEVEL).includes(value as RiskLevel);
}

function policyDecisionForState(state: SetScheduledPostStateInput["state"], approvalRequired: boolean): string {
  if (state === "scheduled" && approvalRequired) return "approval_requested";
  if (state === "published" && approvalRequired) return "allowed_after_approval";
  return "allowed_by_policy";
}
