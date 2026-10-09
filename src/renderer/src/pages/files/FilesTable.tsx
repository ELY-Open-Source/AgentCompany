import { Avatar, IconButton, Pill } from "../../shared/ui";
import { MenuRow, Popover } from "../../shared/Popover";
import type {
  AgentRecord,
  EmployeeRecord,
  FileAccessGrantRecord,
  FileObjectRecord,
} from "../../../../shared/domain";
import { formatBytes, formatRelative } from "../types";
import { FileIcon, ScanPill } from "./FileVisuals";
import { fileGrantCount, isAgentOwner, resolveOwnerName, shortChecksum, shortObjectRef } from "./file-helpers";
import { t } from "../../i18n/i18n";

const ROW_COLUMNS = "minmax(0, 2.7fr) minmax(70px, 0.7fr) minmax(0, 1.2fr) minmax(94px, 0.8fr) minmax(88px, 0.8fr) 56px";

export function FilesTable({
  files,
  grants,
  employees,
  agents,
  onOpen,
  onTogglePin,
}: {
  files: FileObjectRecord[];
  grants: FileAccessGrantRecord[];
  employees: EmployeeRecord[];
  agents: AgentRecord[];
  onOpen: (file: FileObjectRecord) => void;
  onTogglePin: (file: FileObjectRecord) => void;
}) {
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div className="table-row head" style={{ gridTemplateColumns: ROW_COLUMNS }}>
        <div>{t("Name")}</div><div>{t("Size")}</div><div>{t("Owner")}</div><div>{t("Access")}</div><div>{t("Modified")}</div><div />
      </div>
      {files.map((file, index) => (
        <FileRow
          key={file.id}
          file={file}
          owner={resolveOwnerName(file, employees, agents)}
          grantCount={fileGrantCount(file.id, grants)}
          last={index === files.length - 1}
          onOpen={() => onOpen(file)}
          onTogglePin={() => onTogglePin(file)}
        />
      ))}
    </div>
  );
}

function FileRow({
  file,
  owner,
  grantCount,
  last,
  onOpen,
  onTogglePin,
}: {
  file: FileObjectRecord;
  owner: string;
  grantCount: number;
  last: boolean;
  onOpen: () => void;
  onTogglePin: () => void;
}) {
  const canOpen = file.scanState === "approved";
  return (
    <div
      className={`table-row ${canOpen ? "clickable" : ""}`.trim()}
      role={canOpen ? "button" : undefined}
      tabIndex={canOpen ? 0 : undefined}
      onClick={canOpen ? onOpen : undefined}
      onKeyDown={canOpen ? (event) => { if (event.key === "Enter") onOpen(); } : undefined}
      style={{ gridTemplateColumns: ROW_COLUMNS, borderBottom: last ? "none" : "1px solid var(--border-soft)" }}
    >
      <div className="row" style={{ gap: 10, minWidth: 0 }}>
        <FileIcon kind={file.kind} />
        <div style={{ display: "grid", gap: 3, minWidth: 0 }}>
          <span style={{ fontWeight: 480, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</span>
          <span className="mono" style={{ color: "var(--text-3)", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            sha:{shortChecksum(file.sha256)} · obj:{shortObjectRef(file.storagePath)}
          </span>
        </div>
        {file.pinned && <Pill tone="violet" dot>{t("Pinned")}</Pill>}
      </div>
      <div className="num mono" style={{ color: "var(--text-3)", fontSize: 12 }}>{formatBytes(file.sizeBytes)}</div>
      <div className="row" style={{ gap: 8, minWidth: 0 }}>
        <Avatar name={owner} size="sm" bot={isAgentOwner(file)} />
        <span style={{ color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{owner}</span>
      </div>
      <div className="row" style={{ gap: 6, minWidth: 0 }}>
        <ScanPill file={file} />
        <span className="mono" style={{ color: "var(--text-3)", fontSize: 12 }}>{grantCount}</span>
      </div>
      <div style={{ color: "var(--text-3)", fontSize: 12 }}>{formatRelative(file.updatedAt ?? file.createdAt)}</div>
      <div style={{ textAlign: "right" }} onClick={(event) => event.stopPropagation()}>
        <Popover trigger={({ toggle }) => <IconButton icon="more" label={t("Actions for {name}", { name: file.name })} onClick={toggle} />}>
          {(close) => (
            <>
              {canOpen && <MenuRow onClick={() => { onOpen(); close(); }}>{t("Open")}</MenuRow>}
              <MenuRow onClick={() => { onTogglePin(); close(); }}>{file.pinned ? t("Unpin") : t("Pin")}</MenuRow>
            </>
          )}
        </Popover>
      </div>
    </div>
  );
}
