import { useMemo, useState, type FormEvent } from "react";
import { Avatar, Button, Field, Icon, IconButton, Pill } from "../shared/ui";
import { TopbarActions } from "../shared/TopbarActions";
import { Dialog } from "../shared/Dialog";
import {
  SOCIAL_PLATFORM,
  type EmployeeRecord,
  type ApprovalState,
  type ScheduledPostRecord,
  type SocialAccountRecord,
  type SocialPlatform,
} from "../../../shared/domain";
import { APPROVAL_STATE } from "../../../shared/domain";
import { SocialCalendar } from "./social/SocialCalendar";
import { SocialActivity } from "./social/SocialActivity";
import { PlatformIcon } from "./social/PlatformIcon";
import type { PageProps } from "./types";
import { activeOrgId, requireActiveEmployee } from "./types";

function value(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

function optional(form: FormData, key: string): string | null {
  return value(form, key) || null;
}

export function SocialPage({ snapshot, actions }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const employee = requireActiveEmployee(snapshot);
  const accounts = useMemo(() => snapshot.socialAccounts.filter((account) => account.orgId === orgId), [snapshot.socialAccounts, orgId]);
  const scheduledPosts = useMemo(() => snapshot.scheduledPosts.filter((post) => post.orgId === orgId), [snapshot.scheduledPosts, orgId]);
  const approvalStateById = useMemo(() => {
    const states = new Map<string, ApprovalState>();
    for (const approval of snapshot.approvals) {
      if (approval.orgId === orgId) states.set(approval.id, approval.state);
    }
    return states;
  }, [snapshot.approvals, orgId]);
  const employees = snapshot.employees.filter((item) => item.orgId === orgId);
  const socialGrants = useMemo(() => snapshot.socialAccountGrants.filter((grant) => grant.orgId === orgId), [snapshot.socialAccountGrants, orgId]);
  const socialAudit = useMemo(() => snapshot.socialAuditRecords.filter((record) => record.orgId === orgId), [snapshot.socialAuditRecords, orgId]);
  const browserActions = useMemo(() => snapshot.browserActions.filter((action) => action.orgId === orgId), [snapshot.browserActions, orgId]);

  const [connectOpen, setConnectOpen] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);

  const scheduled = scheduledPosts.filter((post) => post.state === "scheduled");
  const drafts = scheduledPosts.filter((post) => post.state === "draft");
  const history = scheduledPosts.filter((post) => post.state === "published" || post.state === "cancelled");
  const operator = accounts.find((account) => account.authorizedEmployeeId)?.authorizedEmployeeId ?? null;
  const operatorName = operator ? employees.find((item) => item.id === operator)?.displayName ?? null : null;

  const connect = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void actions.run(() => window.agentCompany.createSocialAccount({
      orgId,
      platform: value(form, "platform") as SocialPlatform,
      handle: value(form, "handle"),
      displayName: value(form, "displayName"),
      createdByEmployeeId: employee.id,
      authorizedEmployeeId: optional(form, "authorizedEmployeeId"),
    })).then((result) => { if (result) setConnectOpen(false); });
  };

  const draft = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void actions.run(() => window.agentCompany.createScheduledPost({
      orgId,
      socialAccountId: value(form, "socialAccountId"),
      bodyMd: value(form, "bodyMd"),
      scheduledFor: value(form, "scheduledFor"),
      createdByEmployeeId: employee.id,
    })).then((result) => { if (result) setDraftOpen(false); });
  };

  const updatePostState = (post: ScheduledPostRecord, state: "draft" | "scheduled" | "published" | "cancelled") =>
    void actions.run(() => window.agentCompany.setScheduledPostState({ orgId, scheduledPostId: post.id, state, employeeId: employee.id }));

  return (
    <div className="page" style={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%", padding: "28px 32px 0" }}>
      <TopbarActions>
        <Button onClick={() => setConnectOpen(true)}><Icon name="plus" size={13} /> Connect account</Button>
        <Button tone="primary" onClick={() => setDraftOpen(true)} disabled={accounts.length === 0}>
          <Icon name="sparkle" size={13} /> Draft post
        </Button>
      </TopbarActions>
      <h1 className="page-h1">Social</h1>
      <p className="page-sub">
        {accounts.length} {accounts.length === 1 ? "account" : "accounts"} · {scheduled.length} scheduled
        {operatorName ? ` · managed by ${operatorName}` : ""}
      </p>

      <div className="pane-scroll" style={{ paddingBottom: 40 }}>
      {accounts.length > 0 && (
        <>
          <div className="section-label" style={{ marginBottom: 10 }}>Accounts</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginBottom: 28 }}>
            {accounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                authorizedName={account.authorizedEmployeeId ? employees.find((item) => item.id === account.authorizedEmployeeId)?.displayName ?? null : null}
                canSignIn={account.authorizedEmployeeId === employee.id}
                onSignIn={() => void actions.run(() => window.agentCompany.launchSocialLogin({ orgId, socialAccountId: account.id, employeeId: employee.id }))}
              />
            ))}
          </div>
        </>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: 12, alignItems: "start" }}>
        <div>
          {scheduled.length > 0 && <div className="section-label" style={{ marginBottom: 10 }}>Scheduled</div>}
          {scheduled.map((post) => (
            <PostRow
              key={post.id}
              post={post}
              account={requireAccount(accounts, post.socialAccountId)}
              authorName={authorName(post, employees)}
              approvalState={approvalState(post, approvalStateById)}
              onCancel={() => updatePostState(post, "cancelled")}
              onPublish={() => updatePostState(post, "published")}
            />
          ))}
          {drafts.length > 0 && <div className="section-label" style={{ margin: "24px 0 10px" }}>Drafts</div>}
          {drafts.map((post) => (
            <PostRow
              key={post.id}
              post={post}
              account={requireAccount(accounts, post.socialAccountId)}
              authorName={authorName(post, employees)}
              approvalState={approvalState(post, approvalStateById)}
              onCancel={() => updatePostState(post, "cancelled")}
              onPublish={() => updatePostState(post, "scheduled")}
            />
          ))}
          {history.length > 0 && <div className="section-label" style={{ margin: "24px 0 10px" }}>History</div>}
          {history.map((post) => (
            <PostRow
              key={post.id}
              post={post}
              account={requireAccount(accounts, post.socialAccountId)}
              authorName={authorName(post, employees)}
              approvalState={approvalState(post, approvalStateById)}
              onCancel={() => updatePostState(post, "cancelled")}
              onPublish={() => updatePostState(post, "published")}
            />
          ))}
        </div>

        <SocialCalendar posts={scheduledPosts} accounts={accounts} />
      </div>

      <SocialActivity
        accounts={accounts}
        grants={socialGrants}
        auditRecords={socialAudit}
        browserActions={browserActions}
        employees={employees}
      />
      </div>

      <Dialog title="Connect social account" open={connectOpen} submitLabel="Connect" onClose={() => setConnectOpen(false)} onSubmit={connect}>
        <Field label="Platform">
          <select className="input" name="platform" defaultValue={SOCIAL_PLATFORM.X}>
            <option value={SOCIAL_PLATFORM.X}>X</option>
            <option value={SOCIAL_PLATFORM.LINKEDIN}>LinkedIn</option>
            <option value={SOCIAL_PLATFORM.YOUTUBE}>YouTube</option>
            <option value={SOCIAL_PLATFORM.INSTAGRAM}>Instagram</option>
          </select>
        </Field>
        <Field label="Handle"><input className="input" name="handle" required /></Field>
        <Field label="Display name"><input className="input" name="displayName" required /></Field>
        <Field label="Authorized employee">
          <select className="input" name="authorizedEmployeeId" defaultValue={employee.id}>
            <option value="">Unassigned</option>
            {employees.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}
          </select>
        </Field>
      </Dialog>

      <Dialog title="Draft post" open={draftOpen} submitLabel="Save" onClose={() => setDraftOpen(false)} onSubmit={draft}>
        <Field label="Account">
          <select className="input" name="socialAccountId" required defaultValue={accounts[0]?.id ?? ""}>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>{account.platform.toUpperCase()} · {account.handle}</option>
            ))}
          </select>
        </Field>
        <Field label="Body"><textarea className="input" name="bodyMd" required /></Field>
        <Field label="Scheduled for"><input className="input" name="scheduledFor" type="datetime-local" required /></Field>
      </Dialog>
    </div>
  );
}

function AccountCard({
  account,
  authorizedName,
  canSignIn,
  onSignIn,
}: {
  account: SocialAccountRecord;
  authorizedName: string | null;
  canSignIn: boolean;
  onSignIn: () => void;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 14,
        background: "var(--panel)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minWidth: 0,
      }}
    >
      <div className="row" style={{ gap: 10, minWidth: 0 }}>
        <PlatformIcon platform={account.platform} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 540, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{account.handle}</div>
          <div style={{ fontSize: 11, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{account.displayName}</div>
        </div>
      </div>
      {authorizedName && (
        <div className="row" style={{ fontSize: 11, color: "var(--text-3)", gap: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, background: "var(--green)" }} /> Authorized to {authorizedName}
        </div>
      )}
      {canSignIn && (
        <Button size="small" onClick={onSignIn}>Sign in</Button>
      )}
    </div>
  );
}

function PostRow({
  post,
  account,
  authorName,
  approvalState,
  onCancel,
  onPublish,
}: {
  post: ScheduledPostRecord;
  account: SocialAccountRecord;
  authorName: string;
  approvalState: ApprovalState | null;
  onCancel: () => void;
  onPublish: () => void;
}) {
  const isDraft = post.state === "draft";
  const canPublish = post.state === "scheduled" && approvalState === APPROVAL_STATE.APPROVED;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "36px minmax(0, 1fr) auto",
        gap: 14,
        padding: 14,
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "var(--panel)",
        marginBottom: 8,
      }}
    >
      <PlatformIcon platform={account.platform} size={18} />
      <div style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 8, marginBottom: 6 }}>
          {isDraft ? (
            <Pill>Draft</Pill>
          ) : (
            <span className="num mono" style={{ fontSize: 12, color: "var(--text-2)", fontWeight: 540 }}>
              {formatSchedule(post.scheduledFor)}
            </span>
          )}
          {approvalState === APPROVAL_STATE.PENDING && <Pill tone="amber" dot>Awaiting approval</Pill>}
          {approvalState === APPROVAL_STATE.APPROVED && <Pill tone="green" dot>Approved</Pill>}
          {approvalState === APPROVAL_STATE.DECLINED && <Pill tone="red">Declined</Pill>}
          {post.state === "published" && <Pill tone="green" dot>Published</Pill>}
          {post.state === "cancelled" && <Pill tone="red">Cancelled</Pill>}
        </div>
        <div style={{ fontSize: 13, color: "var(--text-1)", lineHeight: 1.5, marginBottom: 8, whiteSpace: "pre-wrap" }}>{post.bodyMd}</div>
        <div className="row" style={{ gap: 6 }}>
          <Avatar name={authorName} size="sm" bot={authorName !== "System"} />
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>By {authorName}</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {post.state === "scheduled" && <Button size="small" tone="primary" disabled={!canPublish} onClick={onPublish}>Publish</Button>}
        {post.state === "draft" && <Button size="small" tone="primary" onClick={onPublish}>Schedule</Button>}
        {post.state !== "cancelled" && post.state !== "published" && (
          <Button size="small" tone="ghost" onClick={onCancel}>Cancel</Button>
        )}
        <IconButton icon="more" label="More" />
      </div>
    </div>
  );
}

function approvalState(post: ScheduledPostRecord, states: Map<string, ApprovalState>): ApprovalState | null {
  if (!post.approvalId) return null;
  const state = states.get(post.approvalId);
  if (!state) throw new Error("Scheduled post references missing approval.");
  return state;
}

function requireAccount(accounts: SocialAccountRecord[], id: string): SocialAccountRecord {
  const account = accounts.find((item) => item.id === id);
  if (!account) throw new Error("Scheduled post references missing account.");
  return account;
}

function authorName(post: ScheduledPostRecord, employees: EmployeeRecord[]): string {
  if (!post.createdByEmployeeId) return "System";
  return employees.find((item) => item.id === post.createdByEmployeeId)?.displayName ?? "System";
}

function formatSchedule(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
