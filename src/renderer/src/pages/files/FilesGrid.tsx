import { Avatar, Icon } from "../../shared/ui";
import type {
  AgentRecord,
  EmployeeRecord,
  FileAccessGrantRecord,
  FileObjectRecord,
} from "../../../../shared/domain";
import { formatRelative } from "../types";
import { FileIcon, ScanLabelStrip, ScanPill } from "./FileVisuals";
import { fileGrantCount, isAgentOwner, resolveOwnerName, shortChecksum, shortObjectRef } from "./file-helpers";
import { t } from "../../i18n/i18n";

export function FilesGrid({
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
    <div className="inventory">
      {files.map((file) => (
        <PinnedCard
          key={file.id}
          file={file}
          ownerName={resolveOwnerName(file, employees, agents)}
          grantCount={fileGrantCount(file.id, grants)}
          onOpen={() => onOpen(file)}
          onUnpin={() => onTogglePin(file)}
        />
      ))}
    </div>
  );
}

export function PinnedCard({
  file,
  ownerName,
  grantCount,
  onOpen,
  onUnpin,
}: {
  file: FileObjectRecord;
  ownerName: string;
  grantCount: number;
  onOpen: () => void;
  onUnpin: () => void;
}) {
  const canOpen = file.scanState === "approved";
  return (
    <div
      data-object-id={file.id}
      className={`inventory-slot ${canOpen ? "clickable-card" : ""}`.trim()}
      role={canOpen ? "button" : undefined}
      tabIndex={canOpen ? 0 : undefined}
      onClick={canOpen ? onOpen : undefined}
      onKeyDown={canOpen ? (event) => { if (event.key === "Enter") onOpen(); } : undefined}
      style={{ cursor: canOpen ? "pointer" : "default" }}
    >
      <div className="row" style={{ gap: 10 }}>
        <FileIcon kind={file.kind} big />
        <button
          type="button"
          aria-label={file.pinned ? t("Unpin") : t("Pin")}
          onClick={(event) => { event.stopPropagation(); onUnpin(); }}
          style={{ marginLeft: "auto", padding: 4, border: 0, background: "transparent", color: file.pinned ? "var(--accent)" : "var(--text-4)", cursor: "pointer" }}
        >
          <Icon name="pin" />
        </button>
      </div>
      <div style={{ fontSize: 14, fontWeight: 540, letterSpacing: "-0.005em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {file.name}
      </div>
      <div className="mono" style={{ color: "var(--text-3)", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        sha:{shortChecksum(file.sha256)} · obj:{shortObjectRef(file.storagePath)}
      </div>
      <div className="row" style={{ gap: 6 }}>
        <ScanPill file={file} />
        <span className="mono" style={{ color: "var(--text-3)", fontSize: 12 }}>{grantCount}</span>
      </div>
      <ScanLabelStrip file={file} />
      <div className="row" style={{ gap: 8, marginTop: "auto", minWidth: 0 }}>
        <Avatar name={ownerName} size="sm" bot={isAgentOwner(file)} />
        <span style={{ fontSize: 12, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {formatRelative(file.updatedAt ?? file.createdAt)} · {ownerName.split(" ")[0]}
        </span>
      </div>
    </div>
  );
}
