import { Children, type FormEvent, type ReactNode } from "react";
import { Button, Icon, Pill } from "../../shared/ui";
import type {
  AgentRecord,
  AuditReplayRunRecord,
  ChatSpaceRecord,
  ChatThreadRecord,
  ComplianceExportRecord,
  EmployeeRecord,
  FileObjectRecord,
  LegalHoldRecord,
  RetentionFreezeRecord,
} from "../../../../shared/domain";
import type { SnapshotActions } from "../../app/useSnapshot";
import { formatRelative } from "../types";

export function CompliancePanel({
  orgId,
  employeeId,
  employees,
  agents,
  chatSpaces,
  chatThreads,
  files,
  exports,
  legalHolds,
  retentionFreezes,
  auditReplayRuns,
  actions,
}: {
  orgId: string;
  employeeId: string;
  employees: EmployeeRecord[];
  agents: AgentRecord[];
  chatSpaces: ChatSpaceRecord[];
  chatThreads: ChatThreadRecord[];
  files: FileObjectRecord[];
  exports: ComplianceExportRecord[];
  legalHolds: LegalHoldRecord[];
  retentionFreezes: RetentionFreezeRecord[];
  auditReplayRuns: AuditReplayRunRecord[];
  actions: SnapshotActions;
}) {
  const submitExport = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const [subjectType, subjectId] = splitPair(String(form.get("subject") ?? ""));
    void actions.run(() => window.agentCompany.createComplianceExport({
      orgId,
      subjectType: subjectType as "employee" | "agent",
      subjectId,
      exportType: String(form.get("exportType")) as "gdpr_export" | "gdpr_delete",
      requestedByEmployeeId: employeeId,
    }));
  };

  const submitHold = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const [entityType, entityId] = splitPair(String(form.get("entity") ?? ""));
    const reason = String(form.get("reason") ?? "").trim();
    void actions.run(() => window.agentCompany.createLegalHold({
      orgId,
      entityType: entityType as "organization" | "employee" | "agent" | "chat_thread" | "file_object",
      entityId,
      reason,
      createdByEmployeeId: employeeId,
    })).then((result) => { if (result) event.currentTarget.reset(); });
  };

  const submitFreeze = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const [scopeType, scopeId] = splitPair(String(form.get("scope") ?? ""));
    const reason = String(form.get("reason") ?? "").trim();
    void actions.run(() => window.agentCompany.createRetentionFreeze({
      orgId,
      scopeType: scopeType as "organization" | "chat_space" | "file_object",
      scopeId,
      reason,
      createdByEmployeeId: employeeId,
    })).then((result) => { if (result) event.currentTarget.reset(); });
  };

  const submitReplay = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void actions.run(() => window.agentCompany.createAuditReplay({
      orgId,
      threadId: String(form.get("threadId") ?? ""),
      createdByEmployeeId: employeeId,
    }));
  };

  return (
    <div className="page">
      <h1 className="page-h1">Compliance</h1>
      <p className="page-sub">GDPR exports, legal holds, and retention freezes.</p>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 16 }}>
        <section className="card">
          <SectionTitle icon="docs" title="Export" />
          <form onSubmit={submitExport} style={{ display: "grid", gap: 10 }}>
            <LabeledSelect label="Type" name="exportType">
              <option value="gdpr_export">GDPR export</option>
              <option value="gdpr_delete">GDPR delete</option>
            </LabeledSelect>
            <LabeledSelect label="Subject" name="subject">
              {employees.map((employee) => <option key={employee.id} value={`employee:${employee.id}`}>Employee · {employee.displayName}</option>)}
              {agents.map((agent) => <option key={agent.id} value={`agent:${agent.id}`}>Agent · {agent.name}</option>)}
            </LabeledSelect>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <Button tone="primary" size="small" type="submit"><Icon name="upload" size={12} /> Create</Button>
            </div>
          </form>
        </section>

        <section className="card">
          <SectionTitle icon="shield" title="Legal hold" />
          <form onSubmit={submitHold} style={{ display: "grid", gap: 10 }}>
            <LabeledSelect label="Target" name="entity">
              <option value={`organization:${orgId}`}>Organization</option>
              {employees.map((employee) => <option key={employee.id} value={`employee:${employee.id}`}>Employee · {employee.displayName}</option>)}
              {agents.map((agent) => <option key={agent.id} value={`agent:${agent.id}`}>Agent · {agent.name}</option>)}
              {chatThreads.map((thread) => <option key={thread.id} value={`chat_thread:${thread.id}`}>Thread · {thread.title}</option>)}
              {files.map((file) => <option key={file.id} value={`file_object:${file.id}`}>File · {file.name}</option>)}
            </LabeledSelect>
            <LabeledInput label="Reason" name="reason" />
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <Button tone="primary" size="small" type="submit"><Icon name="plus" size={12} /> Hold</Button>
            </div>
          </form>
        </section>

        <section className="card">
          <SectionTitle icon="pause" title="Retention freeze" />
          <form onSubmit={submitFreeze} style={{ display: "grid", gap: 10 }}>
            <LabeledSelect label="Scope" name="scope">
              <option value={`organization:${orgId}`}>Organization</option>
              {chatSpaces.map((space) => <option key={space.id} value={`chat_space:${space.id}`}>Space · {space.name}</option>)}
              {files.map((file) => <option key={file.id} value={`file_object:${file.id}`}>File · {file.name}</option>)}
            </LabeledSelect>
            <LabeledInput label="Reason" name="reason" />
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <Button tone="primary" size="small" type="submit"><Icon name="pause" size={12} /> Freeze</Button>
            </div>
          </form>
        </section>

        <section className="card">
          <SectionTitle icon="refresh" title="Thread replay" />
          <form onSubmit={submitReplay} style={{ display: "grid", gap: 10 }}>
            <LabeledSelect label="Thread" name="threadId">
              {chatThreads.map((thread) => <option key={thread.id} value={thread.id}>{thread.title}</option>)}
            </LabeledSelect>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <Button tone="primary" size="small" type="submit" disabled={chatThreads.length === 0}><Icon name="refresh" size={12} /> Run</Button>
            </div>
          </form>
        </section>

        <section className="card">
          <SectionTitle icon="inbox" title="Export history" />
          <RecordList emptyLabel="0 exports">
            {exports.map((item) => (
              <RecordRow
                key={item.id}
                title={`${item.exportType.replaceAll("_", " ")} · ${item.subjectType}`}
                meta={`${item.state} · ${formatRelative(item.createdAt)} · ${item.payloadJson.length} bytes`}
              />
            ))}
          </RecordList>
        </section>
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <SectionTitle icon="list" title="Replay runs" />
        <RecordList emptyLabel="0 replay runs">
          {auditReplayRuns.map((run) => (
            <RecordRow
              key={run.id}
              title={threadTitle(chatThreads, run.threadId)}
              meta={`${run.eventCount} events · ${run.eventDigest.slice(0, 12)} · ${formatRelative(run.createdAt)}`}
            />
          ))}
        </RecordList>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <SectionTitle icon="approve" title="Active controls" />
        <RecordList emptyLabel="0 active controls">
          {legalHolds.map((hold) => (
            <RecordRow
              key={hold.id}
              title={`Legal hold · ${hold.entityType}`}
              meta={`${hold.reason} · ${formatRelative(hold.createdAt)}`}
              active={hold.active}
              actionLabel={hold.active ? "Release" : "Activate"}
              onAction={() => void actions.run(() => window.agentCompany.setLegalHoldState({ orgId, legalHoldId: hold.id, active: !hold.active, employeeId }))}
            />
          ))}
          {retentionFreezes.map((freeze) => (
            <RecordRow
              key={freeze.id}
              title={`Retention freeze · ${freeze.scopeType}`}
              meta={`${freeze.reason} · ${formatRelative(freeze.createdAt)}`}
              active={freeze.active}
              actionLabel={freeze.active ? "Release" : "Activate"}
              onAction={() => void actions.run(() => window.agentCompany.setRetentionFreezeState({ orgId, retentionFreezeId: freeze.id, active: !freeze.active, employeeId }))}
            />
          ))}
        </RecordList>
      </section>
    </div>
  );
}

function SectionTitle({ icon, title }: { icon: "approve" | "docs" | "inbox" | "list" | "pause" | "refresh" | "shield"; title: string }) {
  return (
    <div className="row" style={{ marginBottom: 12 }}>
      <Icon name={icon} size={14} color="var(--text-3)" />
      <div style={{ fontSize: 13, fontWeight: 600 }}>{title}</div>
    </div>
  );
}

function LabeledSelect({ label, name, children }: { label: string; name: string; children: ReactNode }) {
  return (
    <label className="field" style={{ margin: 0 }}>
      <span>{label}</span>
      <select className="input" name={name} required>{children}</select>
    </label>
  );
}

function LabeledInput({ label, name }: { label: string; name: string }) {
  return (
    <label className="field" style={{ margin: 0 }}>
      <span>{label}</span>
      <input className="input" name={name} required />
    </label>
  );
}

function RecordList({ emptyLabel, children }: { emptyLabel: string; children: ReactNode }) {
  const items = Children.toArray(children).filter(Boolean);
  return items.length > 0 ? <div style={{ display: "grid", gap: 8 }}>{items}</div> : <Pill>{emptyLabel}</Pill>;
}

function RecordRow({
  title,
  meta,
  active,
  actionLabel,
  onAction,
}: {
  title: string;
  meta: string;
  active?: boolean;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="row" style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 8, alignItems: "center" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 540, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
        <div style={{ fontSize: 11, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{meta}</div>
      </div>
      {active !== undefined && <Pill tone={active ? "red" : undefined}>{active ? "active" : "released"}</Pill>}
      {onAction && actionLabel && <Button size="small" onClick={onAction}>{actionLabel}</Button>}
    </div>
  );
}

function splitPair(value: string): [string, string] {
  const index = value.indexOf(":");
  if (index < 1) throw new Error("Compliance selector value is invalid.");
  return [value.slice(0, index), value.slice(index + 1)];
}

function threadTitle(threads: ChatThreadRecord[], threadId: string): string {
  const thread = threads.find((item) => item.id === threadId);
  if (!thread) throw new Error("Audit replay thread is missing from snapshot.");
  return thread.title;
}
