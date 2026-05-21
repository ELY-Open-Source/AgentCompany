import { useState, type FormEvent } from "react";
import { Avatar, Button, Field, Icon } from "../shared/ui";
import { Dialog } from "../shared/Dialog";
import { SOCIAL_PLATFORM, type SocialAccountRecord, type SocialPlatform } from "../../../shared/domain";
import type { PageProps } from "./types";
import { activeOrgId } from "./types";

function value(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

export function SocialPage({ snapshot, actions }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const [open, setOpen] = useState(false);
  const accounts = snapshot.socialAccounts.filter((item) => item.orgId === orgId);
  const employees = snapshot.employees.filter((item) => item.orgId === orgId);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void actions.run(() => window.agentCompany.createSocialAccount({
      orgId,
      platform: value(form, "platform") as SocialPlatform,
      handle: value(form, "handle"),
      displayName: value(form, "displayName"),
      authorizedEmployeeId: value(form, "authorizedEmployeeId") || null,
    })).then(() => setOpen(false));
  };

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-h1">Social</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>{accounts.length} accounts</p>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <Button tone="primary" onClick={() => setOpen(true)}><Icon name="plus" /> Connect account</Button>
        </div>
      </div>
      <div className="section-label">Accounts</div>
      <div className="grid-4" style={{ marginBottom: 28 }}>
        {accounts.length === 0 ? (
          <div className="card" style={{ color: "var(--text-3)" }}>No social accounts</div>
        ) : accounts.map((account) => (
          <AccountCard
            key={account.id}
            account={account}
            employeeName={authorizedEmployeeName(account.authorizedEmployeeId, employees)}
            onLogin={() => void actions.run(() => window.agentCompany.launchSocialLogin({ socialAccountId: account.id }))}
          />
        ))}
      </div>
      <Dialog title="Connect social account" open={open} submitLabel="Connect" onClose={() => setOpen(false)} onSubmit={submit}>
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
          <select className="input" name="authorizedEmployeeId">
            <option value="">Unassigned</option>
            {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.displayName}</option>)}
          </select>
        </Field>
      </Dialog>
    </div>
  );
}

function AccountCard({
  account,
  employeeName,
  onLogin,
}: {
  account: SocialAccountRecord;
  employeeName: string | null;
  onLogin: () => void;
}) {
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="row">
        <PlatformIcon platform={account.platform} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 540 }}>{account.handle}</div>
          <div style={{ color: "var(--text-3)", fontSize: 11 }}>{account.displayName}</div>
        </div>
      </div>
      {employeeName && (
        <div className="row" style={{ color: "var(--text-3)", fontSize: 11 }}>
          <Avatar name={employeeName} size="sm" />
          <span>{employeeName}</span>
        </div>
      )}
      <Button size="small" onClick={onLogin}>Sign in</Button>
    </div>
  );
}

function PlatformIcon({ platform }: { platform: SocialPlatform }) {
  const labels: Record<SocialPlatform, string> = {
    x: "X",
    linkedin: "in",
    youtube: "▶",
    instagram: "◎",
  };
  const colors: Record<SocialPlatform, string> = {
    x: "#0a0a0b",
    linkedin: "#0a66c2",
    youtube: "#ff0000",
    instagram: "#e1306c",
  };
  return (
    <div style={{ width: 30, height: 30, borderRadius: 7, background: colors[platform], color: "#fff", display: "grid", placeItems: "center", fontWeight: 700 }}>
      {labels[platform]}
    </div>
  );
}

function authorizedEmployeeName(
  employeeId: string | null,
  employees: Array<{ id: string; displayName: string }>,
): string | null {
  if (!employeeId) return null;
  const employee = employees.find((item) => item.id === employeeId);
  if (!employee) throw new Error("Authorized employee is missing.");
  return employee.displayName;
}
