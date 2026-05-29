import { Avatar, Icon, Pill } from "../../shared/ui";
import type {
  AgentRecord,
  EmployeeRecord,
  FileAccessGrantRecord,
  FileObjectRecord,
} from "../../../../shared/domain";
import { formatRelative } from "../types";
import { FileIcon, ScanLabelStrip } from "./FileVisuals";
import { fileGrantCount, isAgentOwner, resolveOwnerName, shortChecksum, shortObjectRef } from "./file-helpers";

export function FilesGrid({
  files,
  grants,
  employees,
  agents,
  onTogglePin,
}: {
  files: FileObjectRecord[];
  grants: FileAccessGrantRecord[];
  employees: EmployeeRecord[];
  agents: AgentRecord[];
  onTogglePin: (file: FileObjectRecord) => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
      {files.map((file) => (
        <PinnedCard
          key={file.id}
          file={file}
          ownerName={resolveOwnerName(file, employees, agents)}
          grantCount={fileGrantCount(file.id, grants)}
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
  onUnpin,
}: {
  file: FileObjectRecord;
  ownerName: string;
  grantCount: number;
  onUnpin: () => void;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "var(--panel)",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minWidth: 0,
      }}
    >
      <div className="row" style={{ gap: 10 }}>
        <FileIcon kind={file.kind} big />
        <button
          type="button"
          aria-label={file.pinned ? "Unpin" : "Pin"}
          onClick={onUnpin}
          style={{ marginLeft: "auto", padding: 4, border: 0, background: "transparent", color: file.pinned ? "var(--accent)" : "var(--text-4)", cursor: "pointer" }}
        >
          <Icon name="pin" size={14} />
        </button>
      </div>
      <div style={{ fontSize: 13, fontWeight: 540, letterSpacing: "-0.005em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {file.name}
      </div>
      <div className="mono" style={{ color: "var(--text-3)", fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        sha:{shortChecksum(file.sha256)} · obj:{shortObjectRef(file.storagePath)}
      </div>
      <div className="row" style={{ gap: 6 }}>
        <Pill tone={file.scanState === "approved" ? "green" : "red"}>{file.scanState === "approved" ? "Clean" : "Blocked"}</Pill>
        <span className="mono" style={{ color: "var(--text-3)", fontSize: 11 }}>{grantCount}</span>
      </div>
      <ScanLabelStrip file={file} />
      <div className="row" style={{ gap: 8, marginTop: "auto", minWidth: 0 }}>
        <Avatar name={ownerName} size="sm" bot={isAgentOwner(file)} />
        <span style={{ fontSize: 11, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {formatRelative(file.updatedAt ?? file.createdAt)} · {ownerName.split(" ")[0]}
        </span>
      </div>
    </div>
  );
}
