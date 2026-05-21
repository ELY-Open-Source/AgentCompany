import type { DatabaseSync } from "node:sqlite";
import { BrowserWindow, session } from "electron";
import type {
  CreateScheduledPostInput,
  CreateSocialAccountInput,
  SetScheduledPostStateInput,
} from "../../shared/commands";
import { SOCIAL_PLATFORM, type SocialPlatform } from "../../shared/domain";
import { createId } from "../../shared/ids";
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

export class SocialService {
  private readonly audit: AuditService;

  constructor(private readonly db: DatabaseSync) {
    this.audit = new AuditService(db);
  }

  createScheduledPost(input: CreateScheduledPostInput): string {
    const account = this.db.prepare("select id from social_accounts where id = ? and org_id = ?")
      .get(input.socialAccountId, input.orgId) as { id: string } | undefined;
    if (!account) throw new Error("Social account was not found.");
    const body = input.bodyMd.trim();
    if (!body) throw new Error("Post body is required.");
    const scheduledFor = input.scheduledFor.trim();
    if (!scheduledFor) throw new Error("Scheduled date is required.");
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
      input.state,
      null,
      input.createdByEmployeeId,
      now,
      now,
    );
    this.audit.record({
      orgId: input.orgId,
      entityType: "scheduled_post",
      entityId: id,
      actorType: input.createdByEmployeeId ? "employee" : "system",
      actorId: input.createdByEmployeeId,
      action: "scheduled",
      payload: { socialAccountId: input.socialAccountId, scheduledFor, state: input.state },
    });
    return id;
  }

  setScheduledPostState(input: SetScheduledPostStateInput): void {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      update scheduled_posts set state = ?, updated_at = ?
      where id = ? and org_id = ?
    `).run(input.state, now, input.scheduledPostId, input.orgId);
    if (result.changes === 0) throw new Error("Scheduled post was not found.");
    this.audit.record({
      orgId: input.orgId,
      entityType: "scheduled_post",
      entityId: input.scheduledPostId,
      actorType: "employee",
      actorId: null,
      action: `state_${input.state}`,
      payload: { state: input.state },
    });
  }

  createAccount(input: CreateSocialAccountInput): string {
    const id = createId("soc");
    const now = new Date().toISOString();
    if (input.authorizedEmployeeId) {
      const employee = this.db.prepare("select id from employees where id = ? and org_id = ?")
        .get(input.authorizedEmployeeId, input.orgId);
      if (!employee) throw new Error("Authorized employee was not found.");
    }
    this.db.prepare(`
      insert into social_accounts(id, org_id, platform, handle, display_name, authorized_employee_id, created_at)
      values (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.orgId,
      input.platform,
      input.handle.trim(),
      input.displayName.trim(),
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
        JSON.stringify({ actions: ["login", "draft", "approve"] }),
        now,
      );
    }
    this.audit.record({
      orgId: input.orgId,
      entityType: "social_account",
      entityId: id,
      actorType: "system",
      actorId: null,
      action: "created",
      payload: { platform: input.platform, handle: input.handle.trim() },
    });
    return id;
  }

  launchLoginWindow(accountId: string): void {
    const account = this.db.prepare("select * from social_accounts where id = ?")
      .get(accountId) as { id: string; org_id: string; platform: SocialPlatform; handle: string } | undefined;
    if (!account) throw new Error("Social account was not found.");
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
      actorType: "system",
      actorId: null,
      action: "login_window_opened",
      payload: { platform: account.platform },
    });
  }

  private attachNavigationPolicy(win: BrowserWindow, platform: SocialPlatform): void {
    const allowed = ALLOWED_HOSTS[platform];
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event, url) => {
      const host = new URL(url).hostname.toLowerCase();
      if (!allowed.some((entry) => host === entry || host.endsWith(`.${entry}`))) {
        event.preventDefault();
      }
    });
  }
}
