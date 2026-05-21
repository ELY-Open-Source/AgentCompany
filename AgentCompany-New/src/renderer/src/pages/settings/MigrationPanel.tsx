import { useState, type FormEvent } from "react";
import { Button, Field, Icon, Pill } from "../../shared/ui";
import { Dialog } from "../../shared/Dialog";
import type { MigrationReportRecord } from "../../../../shared/domain";
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
  reports,
  actions,
}: {
  orgId: string;
  reports: MigrationReportRecord[];
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
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {reports.length === 0 ? (
          <div style={{ padding: 18, color: "var(--text-3)" }}>No migration reports yet.</div>
        ) : reports.map((report, index) => (
          <ReportRow key={report.id} report={report} last={index === reports.length - 1} />
        ))}
      </div>
      <Dialog title="Migration report" open={open} submitLabel="Create" onClose={() => setOpen(false)} onSubmit={submit}>
        <Field label="Source database path"><input className="input" name="sourceDatabasePath" required /></Field>
      </Dialog>
    </div>
  );
}

function ReportRow({ report, last }: { report: MigrationReportRecord; last: boolean }) {
  const body = parseReport(report.reportJson);
  const idCount = Object.values(body.idMaps).reduce((sum, ids) => sum + ids.length, 0);
  return (
    <div
      className="table-row"
      style={{ gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)", borderBottom: last ? "none" : "1px solid var(--border-soft)" }}
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
