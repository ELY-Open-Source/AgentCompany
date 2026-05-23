import { useState, type FormEvent } from "react";
import { Button, Field, Icon, Pill } from "../../shared/ui";
import { Dialog } from "../../shared/Dialog";
import type { MigrationReportRecord, RollbackSnapshotRecord } from "../../../../shared/domain";
import type { SnapshotActions } from "../../app/useSnapshot";
import { formatRelative } from "../types";

interface ParsedReport {
  tableCounts: Record<string, number>;
  tableChecksums: Record<string, string>;
  idMaps: Record<string, string[]>;
  failures: Array<{ table: string; reason: string }>;
  rollbackPack?: { sourceDatabasePath: string; capturedAt: string; restoreStrategy: string };
}

export function MigrationPanel({
  orgId,
  employeeId,
  reports,
  rollbackSnapshots,
  actions,
}: {
  orgId: string;
  employeeId: string;
  reports: MigrationReportRecord[];
  rollbackSnapshots: RollbackSnapshotRecord[];
  actions: SnapshotActions;
}) {
  const [open, setOpen] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void actions.run(() => window.agentCompany.createMigrationReport({
      orgId,
      sourceDatabasePath: String(form.get("sourceDatabasePath") ?? "").trim(),
    })).then((result) => { if (result) setOpen(false); });
  };

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-h1">Migration</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>{reports.length} migration {reports.length === 1 ? "report" : "reports"}.</p>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <Button tone="primary" onClick={() => setOpen(true)}><Icon name="plus" size={13} /> Report</Button>
        </div>
      </div>
      {reports.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          {reports.map((report, index) => (
            <ReportRow
              key={report.id}
              orgId={orgId}
              employeeId={employeeId}
              report={report}
              actions={actions}
              last={index === reports.length - 1}
            />
          ))}
        </div>
      )}
      <section className="card" style={{ marginTop: 16, padding: 0, overflow: "hidden" }}>
        <div className="row" style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-soft)" }}>
          <Icon name="refresh" size={14} color="var(--text-3)" />
          <div style={{ fontSize: 13, fontWeight: 600 }}>Rollback snapshots</div>
        </div>
        {rollbackSnapshots.length > 0 ? rollbackSnapshots.map((snapshot, index) => (
          <RollbackRow
            key={snapshot.id}
            orgId={orgId}
            employeeId={employeeId}
            snapshot={snapshot}
            actions={actions}
            last={index === rollbackSnapshots.length - 1}
          />
        )) : <div style={{ padding: 16 }}><Pill>0 rollback snapshots</Pill></div>}
      </section>
      <Dialog title="Migration report" open={open} submitLabel="Create" onClose={() => setOpen(false)} onSubmit={submit}>
        <Field label="Source database path"><input className="input" name="sourceDatabasePath" required /></Field>
      </Dialog>
    </div>
  );
}

function ReportRow({
  orgId,
  employeeId,
  report,
  actions,
  last,
}: {
  orgId: string;
  employeeId: string;
  report: MigrationReportRecord;
  actions: SnapshotActions;
  last: boolean;
}) {
  const body = parseReport(report.reportJson);
  const idCount = Object.values(body.idMaps).reduce((sum, ids) => sum + ids.length, 0);
  return (
    <div
      className="table-row"
      style={{ gridTemplateColumns: "minmax(0, 1.35fr) minmax(0, 1fr) 120px 88px 96px", borderBottom: last ? "none" : "1px solid var(--border-soft)" }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 540, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={report.sourceRef}>{report.sourceRef}</div>
        <div style={{ fontSize: 11, color: "var(--text-3)" }}>{formatRelative(report.createdAt)}</div>
      </div>
      <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
        {Object.entries(body.tableCounts).map(([table, count]) => (
          <Pill key={table}>{table}: {count}</Pill>
        ))}
      </div>
      <Pill>{Object.keys(body.tableChecksums).length} checksums</Pill>
      <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
        <Pill>{idCount} ids</Pill>
        {body.failures.length > 0 ? <Pill tone="amber">{body.failures.length} failures</Pill> : null}
      </div>
      <Button
        size="small"
        disabled={!body.rollbackPack}
        onClick={() => void actions.run(() => window.agentCompany.createRollbackSnapshot({ orgId, migrationReportId: report.id, createdByEmployeeId: employeeId }))}
      >
        Snapshot
      </Button>
    </div>
  );
}

function RollbackRow({
  orgId,
  employeeId,
  snapshot,
  actions,
  last,
}: {
  orgId: string;
  employeeId: string;
  snapshot: RollbackSnapshotRecord;
  actions: SnapshotActions;
  last: boolean;
}) {
  const manifest = JSON.parse(snapshot.workspaceManifestJson) as { workspaces: unknown[]; files: unknown[] };
  return (
    <div
      className="table-row"
      style={{ gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, .8fr) 96px 96px 72px", borderBottom: last ? "none" : "1px solid var(--border-soft)" }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 540, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={snapshot.sourceDatabasePath}>{snapshot.sourceDatabasePath}</div>
        <div style={{ fontSize: 11, color: "var(--text-3)" }}>{formatRelative(snapshot.createdAt)}</div>
      </div>
      <Pill>{snapshot.sourceDatabaseSha256.slice(0, 12)}</Pill>
      <Pill>{manifest.workspaces.length} workspaces</Pill>
      <Pill>{manifest.files.length} files</Pill>
      <Button
        size="small"
        disabled={snapshot.active}
        onClick={() => void actions.run(() => window.agentCompany.setRollbackSnapshotActive({ orgId, snapshotId: snapshot.id, active: true, employeeId }))}
      >
        {snapshot.active ? "active" : "Set"}
      </Button>
    </div>
  );
}

function parseReport(reportJson: string): ParsedReport {
  const parsed = JSON.parse(reportJson) as ParsedReport;
  if (!parsed.tableCounts || !parsed.tableChecksums || !parsed.idMaps || !Array.isArray(parsed.failures)) {
    throw new Error("Migration report is invalid.");
  }
  return parsed;
}
