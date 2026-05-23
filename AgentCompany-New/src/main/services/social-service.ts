import type { DatabaseSync } from "node:sqlite";
import { BrowserWindow, session } from "electron";
import type {
  CreateScheduledPostInput,
  CreateSocialAccountInput,
  LaunchSocialLoginInput,
  SetScheduledPostStateInput,
} from "../../shared/commands";
import { APPROVAL_STATE, RISK_LEVEL, SOCIAL_PLATFORM, type RiskLevel, type SocialPlatform } from "../../shared/domain";
import { createId } from "../../shared/ids";
import { ApprovalService } from "./approval-service";
import { AuditService } from "./audit-service";

const PLATFORM_LOGIN_URL: Record<SocialPlatform, string> = {
  [SOCIAL_PLATFORM.X]: "https://x.com/i/flow/login",
  [SOCIAL_PLATFORM.LINKEDIN]: "https://www.linkedin.com/login",
  [SOCIAL_PLATFORM.YOUTUBE]: "https://accounts.google.com/",
  [SOCIAL_PLATFORM.INSTAGRAM]: "https://www.instagram.com/accounts/login/",
};

const ALLOWED_HOSTS: Record<SocialPlatform, string[]> = {
  [SOCIAL_PLATFORM.X]: ["x.com", "twitter.com"],
  [SOCIAL_PLATFORM.LINKEDIN]: ["linkedin.com", "www.linkedin.com"],
  [SOCIAL_PLATFORM.YOUTUBE]: ["accounts.google.com", "youtube.com", "www.youtube.com"],
  [SOCIAL_PLATFORM.INSTAGRAM]: ["instagram.com", "www.instagram.com"],
};

const SOCIAL_GRANT_ACTION = {
  LOGIN: "login",
  DRAFT: "draft",
  APPROVE: "approve",
} as const;

type SocialGrantAction = typeof SOCIAL_GRANT_ACTION[keyof typeof SOCIAL_GRANT_ACTION];

const STATE_GRANT_ACTION: Record<SetScheduledPostStateInput["state"], SocialGrantAction> = {
  draft: SOCIAL_GRANT_ACTION.DRAFT,
  scheduled: SOCIAL_GRANT_ACTION.APPROVE,
  published: SOCIAL_GRANT_ACTION.APPROVE,
  cancelled: SOCIAL_GRANT_ACTION.APPROVE,
};

const GRANT_SCOPE = {
  actions: [SOCIAL_GRANT_ACTION.LOGIN, SOCIAL_GRANT_ACTION.DRAFT, SOCIAL_GRANT_ACTION.APPROVE],
  riskCeiling: RISK_LEVEL.MEDIUM,
} as const;

const ACTION_REQUIRED_RISK: Record<SocialGrantAction, RiskLevel> = {
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

  constructor(private readonly db: DatabaseSync) {
    this.audit = new AuditService(db);
    this.approvals = new ApprovalService(db);
  }

  createScheduledPost(input: CreateScheduledPostInput): string {
    this.requireAccount(input.orgId, input.socialAccountId);
    this.requireGrant(input.orgId, input.socialAccountId, input.createdByEmployeeId, SOCIAL_GRANT_ACTION.DRAFT);
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
    return id;
  }

  setScheduledPostState(input: SetScheduledPostStateInput): void {
    const post = this.requireScheduledPost(input.orgId, input.scheduledPostId);
    this.requireGrant(input.orgId, post.social_account_id, input.employeeId, STATE_GRANT_ACTION[input.state]);
    this.assertStateTransition(post, input.state);
    const approvalId = this.resolveApprovalForState(input, post);
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
    return id;
  }

  launchLoginWindow(input: LaunchSocialLoginInput): void {
    const account = this.requireAccount(input.orgId, input.socialAccountId);
    this.requireGrant(input.orgId, input.socialAccountId, input.employeeId, SOCIAL_GRANT_ACTION.LOGIN);
    const partition = `persist:agentcompany-social-${account.id}`;
    const socialSession = session.fromPartition(partition);
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
        sandbox: true,
      },
    });
    this.attachNavigationPolicy(win, account.platform);
    win.loadURL(PLATFORM_LOGIN_URL[account.platform]);
    this.db.prepare(`
      insert into browser_actions(id, org_id, social_account_id, action_type, policy_decision, evidence_file_id, created_at)
      values (?, ?, ?, ?, ?, ?, ?)
    `).run(createId("bact"), account.org_id, account.id, "login_window_opened", "allowed_human_login", null, new Date().toISOString());
    this.audit.record({
      orgId: account.org_id,
      entityType: "social_account",
      entityId: account.id,
      actorType: "employee",
      actorId: input.employeeId,
      action: "login_window_opened",
      payload: { platform: account.platform },
    });
  }

  private attachNavigationPolicy(win: BrowserWindow, platform: SocialPlatform): void {
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    const guard = (event: Electron.Event, url: string) => {
      if (!this.isAllowedNavigation(platform, url)) event.preventDefault();
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

  private requireGrant(orgId: string, socialAccountId: string, employeeId: string, action: SocialGrantAction): void {
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

  private resolveApprovalForState(input: SetScheduledPostStateInput, post: ScheduledPostRow): string | null {
    if (input.state === "scheduled") {
      return post.approval_id ?? this.createPublishApproval(input.orgId, input.employeeId, post.body_md);
    }
    if (input.state === "published") {
      this.assertApprovalApproved(input.orgId, post.approval_id);
      return post.approval_id;
    }
    return post.approval_id;
  }

  private createPublishApproval(orgId: string, employeeId: string, body: string): string {
    return this.approvals.create({
      orgId,
      kind: "social_publish",
      title: "Approve social post",
      details: body,
      risk: RISK_LEVEL.MEDIUM,
      requestedByType: "employee",
      requestedById: employeeId,
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

  private isAllowedNavigation(platform: SocialPlatform, url: string): boolean {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    return ALLOWED_HOSTS[platform].some((entry) => host === entry || host.endsWith(`.${entry}`));
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
